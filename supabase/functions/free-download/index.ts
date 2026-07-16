// Free download — returns a short-lived signed PDF URL for any listed ebook,
// bypassing payment entirely. Intended for the "free access" mode.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";

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
        .select("id, title, pdf_url, listing_status")
        .eq("id", ebook_id)
        .maybeSingle();
      if (ke) throw ke;
      if (!k) throw new Error("Ebook not found");
      // PAYMENT BYPASS (owner directive during batch-learning rounds):
      // any kids book with a pdf_url is downloadable for testing, regardless
      // of listing_status. Commerce floor unchanged — a missing PDF still
      // returns "PDF not available".
      e = { id: k.id, title: k.title, pdf_url: k.pdf_url, listed_at: k.pdf_url ? new Date().toISOString() : null } as any;
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
