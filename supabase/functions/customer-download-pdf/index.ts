// Customer-facing PDF download.
// Verifies a customer email against issued download grants (created at
// checkout) and returns signed download URLs for every ebook purchased.
//
// POST { email: "buyer@example.com" }
// → { ok: true, items: [{ ebook_id, title, download_url, expires_at }] }
import { corsHeaders, admin } from "../_shared/ai.ts";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 h

function pathFromPdfUrl(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null;
  try {
    const u = new URL(pdfUrl);
    const markers = [
      "/storage/v1/object/sign/ebook-pdfs/",
      "/storage/v1/object/authenticated/ebook-pdfs/",
      "/storage/v1/object/public/ebook-pdfs/",
    ];
    for (const m of markers) {
      const i = u.pathname.indexOf(m);
      if (i >= 0) return decodeURIComponent(u.pathname.slice(i + m.length));
    }
  } catch { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email } = await req.json();
    if (!email) throw new Error("email is required");
    const cleanEmail = String(email).trim().toLowerCase();

    const db = admin();

    // Grants are the source of truth for purchased access (issued by the
    // payments webhook at checkout completion).
    const { data: grants, error: grantsError } = await db
      .from("download_grants")
      .select("ebook_id, expires_at, buyer_email")
      .ilike("buyer_email", cleanEmail);
    if (grantsError) throw grantsError;

    const activeGrants = (grants ?? []).filter(
      (g) => !g.expires_at || new Date(g.expires_at).getTime() > Date.now(),
    );
    if (activeGrants.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "No purchase found for that email." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ebookIds = Array.from(new Set(activeGrants.map((g) => g.ebook_id)));
    const { data: ebooks, error } = await db
      .from("ebooks")
      .select("id,title,pdf_url,listing_status")
      .in("id", ebookIds);
    if (error) throw error;

    const items: Array<{
      ebook_id: string;
      title: string;
      download_url: string | null;
      expires_at: string | null;
      error?: string;
    }> = [];

    for (const e of ebooks ?? []) {
      // Gate on listing_status='live' OR a valid (non-expired) download grant —
      // the grant itself already proves purchase, so this just guards against
      // serving a PDF that was pulled from the storefront after purchase.
      const hasValidGrant = activeGrants.some((g) => g.ebook_id === e.id);
      if (e.listing_status !== "live" && !hasValidGrant) {
        items.push({
          ebook_id: e.id, title: e.title, download_url: null, expires_at: null,
          error: "This item is no longer available for download.",
        });
        continue;
      }
      const path = pathFromPdfUrl(e.pdf_url);
      if (!path) {
        items.push({
          ebook_id: e.id, title: e.title, download_url: null, expires_at: null,
          error: "PDF not ready yet — please check back shortly.",
        });
        continue;
      }
      const { data: signed, error: signErr } = await db.storage
        .from("ebook-pdfs")
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
          download: `${e.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60)}.pdf`,
        });
      if (signErr || !signed) {
        items.push({
          ebook_id: e.id, title: e.title, download_url: null, expires_at: null,
          error: signErr?.message ?? "Could not generate download link.",
        });
        continue;
      }
      items.push({
        ebook_id: e.id,
        title: e.title,
        download_url: signed.signedUrl,
        expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, items }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
