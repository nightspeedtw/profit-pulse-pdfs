// Free download — returns a short-lived signed PDF URL for a listed ebook in
// the "free access" library. Kids / coloring books are sold through the
// Paddle checkout and are only served here when their price is 0.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";
import { kidsFreeDownloadDecision } from "./policy.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "ebook-pdfs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id } = await req.json();
    if (!ebook_id || typeof ebook_id !== "string") throw new Error("ebook_id required");

    let { data: e, error } = await supabase
      .from("ebooks")
      .select("id, title, pdf_url, listed_at")
      .eq("id", ebook_id)
      .maybeSingle();
    if (error) throw error;
    if (!e) {
      // Fallback: kids books live in ebooks_kids
      const { data: k, error: ke } = await supabase
        .from("ebooks_kids")
        .select("id, title, pdf_url, listing_status, price_cents")
        .eq("id", ebook_id)
        .maybeSingle();
      if (ke) throw ke;
      if (!k) throw new Error("Ebook not found");
      const decision = kidsFreeDownloadDecision(k);
      if (!decision.allowed) {
        const paymentRequired = decision.reason === "payment_required";
        return new Response(
          JSON.stringify({
            error: paymentRequired ? "payment_required" : "PDF not available",
            checkout_path: paymentRequired ? `/kids/checkout/${k.id}` : undefined,
          }),
          { status: paymentRequired ? 402 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      e = { id: k.id, title: k.title, pdf_url: k.pdf_url, listed_at: new Date().toISOString() } as any;
    }
    if (!e.listed_at) throw new Error("Ebook not available");
    if (!e.pdf_url) throw new Error("PDF not available");

    let signedUrl = e.pdf_url as string;
    try {
      const u = new URL(signedUrl);
      const marker = `/storage/v1/object/`;
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        const after = u.pathname.slice(idx + marker.length);
        const parts = after.split("/");
        if (parts.length >= 3 && parts[1] === BUCKET) {
          const path = parts.slice(2).join("/");
          const { data: sd, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, {
            download: `${(e.title ?? "ebook").replace(/[^a-z0-9-_ ]/gi, "").trim() || "ebook"}.pdf`,
          });
          if (se) throw se;
          signedUrl = sd.signedUrl;
        }
      }
    } catch (_) { /* fall through */ }


    return new Response(JSON.stringify({ url: signedUrl, title: e.title }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
