// submit-sample-lead — public endpoint called from the FreeSamplePreviewModal.
// Validates input, generates/returns the cached sample PDF, records the lead,
// and returns the download + bundle URLs so the modal renders success inline.
// Verify_jwt is off (public).
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

declare const Deno: any;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (x: any, s = 200) =>
  new Response(JSON.stringify(x), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  first_name: z.string().trim().min(1).max(50).optional().nullable(),
  book_id: z.string().uuid(),
});

async function ipHash(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + ":secretpdf-sample-v1");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return j({ error: "invalid_input", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const { email, first_name, book_id } = parsed.data;

    const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // Rate limit: same email+book within 60s → return existing.
    const { data: recent } = await db
      .from("sample_leads")
      .select("id, sample_pdf_url, created_at")
      .eq("email", email)
      .eq("book_id", book_id)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      .limit(1)
      .maybeSingle();

    // Load book info (title, slug, category, price).
    const { data: book } = await db
      .from("ebooks_kids")
      .select("id, title, slug, category, age_band, price, listing_status")
      .eq("id", book_id)
      .maybeSingle();
    if (!book) return j({ error: "book_not_found" }, 404);

    // Ensure sample PDF is available. Call generate-sample-pdf.
    let samplePdfUrl: string | null = null;
    try {
      const r = await fetch(`${SB_URL}/functions/v1/generate-sample-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SB_KEY}`,
          apikey: SB_KEY,
        },
        body: JSON.stringify({ book_id }),
        signal: AbortSignal.timeout(30_000),
      });
      const jr = await r.json().catch(() => ({}));
      if (r.ok && jr?.sample_pdf_url) samplePdfUrl = jr.sample_pdf_url as string;
    } catch { /* fall through */ }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      "0.0.0.0";
    const userAgent = req.headers.get("user-agent")?.slice(0, 250) ?? null;

    // Bundle URL — same-category storefront filter (frontend hook does this
    // deterministically; here we return a category anchor so the modal can
    // deep-link to a filtered listing.)
    const bundleOfferUrl = book.category
      ? `/kids/coloring/category/${encodeURIComponent(String(book.category))}`
      : `/kids`;
    const fullProductCtaUrl = book.slug ? `/kids/coloring/${book.slug}` : `/kids`;

    if (recent) {
      return j({
        ok: true,
        deduped: true,
        sample_pdf_url: samplePdfUrl ?? recent.sample_pdf_url,
        bundle_offer_url: bundleOfferUrl,
        full_product_cta_url: fullProductCtaUrl,
      });
    }

    const ipH = await ipHash(clientIp);

    const { error: insErr } = await db.from("sample_leads").insert({
      email,
      first_name: first_name ?? null,
      book_id,
      product_slug: book.slug ?? null,
      product_category: book.category ? String(book.category) : null,
      lead_source: "free_sample",
      sample_pdf_url: samplePdfUrl,
      drip_stage: 0,
      drip_next_at: new Date().toISOString(), // welcome ready to send immediately
      ip_hash: ipH,
      user_agent: userAgent,
    });

    if (insErr) {
      console.error("[submit-sample-lead] insert failed", insErr);
      // Still return the sample so the user isn't blocked.
    }

    return j({
      ok: true,
      sample_pdf_url: samplePdfUrl,
      bundle_offer_url: bundleOfferUrl,
      full_product_cta_url: fullProductCtaUrl,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
