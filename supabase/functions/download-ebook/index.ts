// Validate a download grant token, return a short-lived signed PDF URL.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "ebook-pdfs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");

    const { data: grant, error } = await supabase
      .from("download_grants")
      .select("id, ebook_id, expires_at, download_count, max_downloads, order_id")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    if (!grant) throw new Error("Invalid download token");
    if (new Date(grant.expires_at as string) < new Date()) throw new Error("Download link expired");
    if ((grant.download_count as number) >= (grant.max_downloads as number)) throw new Error("Download limit reached");

    const { data: e } = await supabase.from("ebooks").select("id, title, pdf_url").eq("id", grant.ebook_id).maybeSingle();
    if (!e?.pdf_url) throw new Error("Ebook PDF not found");

    // Derive storage path from pdf_url
    // pdf_url could be a full signed URL or a storage path; try to extract "<bucket>/path"
    let signedUrl = e.pdf_url as string;
    try {
      const u = new URL(signedUrl);
      const marker = `/storage/v1/object/`;
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        const after = u.pathname.slice(idx + marker.length); // "sign/<bucket>/<path>" or "public/<bucket>/<path>"
        const parts = after.split("/");
        // parts[0] = sign|public|authenticated ; parts[1] = bucket ; rest = path
        if (parts.length >= 3 && parts[1] === BUCKET) {
          const path = parts.slice(2).join("/");
          const { data: sd, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, {
            download: `${(e.title ?? "ebook").replace(/[^a-z0-9-_ ]/gi, "").trim() || "ebook"}.pdf`,
          });
          if (se) throw se;
          signedUrl = sd.signedUrl;
        }
      }
    } catch (_) {
      // fall back to whatever was stored
    }

    await supabase
      .from("download_grants")
      .update({
        download_count: (grant.download_count as number) + 1,
        last_downloaded_at: new Date().toISOString(),
      })
      .eq("id", grant.id);

    return new Response(JSON.stringify({ url: signedUrl, title: e.title, remaining: (grant.max_downloads as number) - (grant.download_count as number) - 1 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
