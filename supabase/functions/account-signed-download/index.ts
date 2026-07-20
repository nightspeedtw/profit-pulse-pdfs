// Account signed download — verifies entitlement server-side and returns a
// short-lived signed URL. Never trusts a URL from the client. Logs every
// issuance to acct_download_events for IDOR/abuse forensics.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const grantId: string | undefined = body?.grant_id;
    const kind: string = body?.kind === "kids" ? "kids" : "adult";
    if (!grantId || typeof grantId !== "string") {
      return json({ error: "grant_id required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    let storagePath: string | null = null;
    let bucket: string | null = null;
    let productId: string | null = null;

    if (kind === "kids") {
      const { data: g } = await admin
        .from("kids_download_grants")
        .select("id, email, ebook_kids_id, expires_at, download_count, max_downloads")
        .eq("id", grantId)
        .maybeSingle();
      if (!g) return json({ error: "not_found" }, 404);
      if (g.email?.toLowerCase() !== user.email?.toLowerCase()) return json({ error: "forbidden" }, 403);
      if (new Date(g.expires_at) < new Date()) return json({ error: "expired" }, 410);
      if (g.download_count >= g.max_downloads) return json({ error: "download_limit_reached" }, 429);
      const { data: ek } = await admin
        .from("ebooks_kids").select("pdf_url").eq("id", g.ebook_kids_id).maybeSingle();
      const pdfUrl = ek?.pdf_url as string | null;
      if (!pdfUrl) return json({ error: "asset_missing" }, 404);
      const parsed = parseStorageUrl(pdfUrl);
      bucket = parsed.bucket;
      storagePath = parsed.path;
      productId = g.ebook_kids_id;
      await admin.from("kids_download_grants").update({
        download_count: g.download_count + 1,
        last_downloaded_at: new Date().toISOString(),
      }).eq("id", grantId);
    } else {
      const { data: g } = await admin
        .from("download_grants")
        .select("id, buyer_email, buyer_user_id, ebook_id, expires_at, download_count, max_downloads")
        .eq("id", grantId)
        .maybeSingle();
      if (!g) return json({ error: "not_found" }, 404);
      const ownedByUid = g.buyer_user_id && g.buyer_user_id === user.id;
      const ownedByEmail = g.buyer_email?.toLowerCase() === user.email?.toLowerCase();
      if (!ownedByUid && !ownedByEmail) return json({ error: "forbidden" }, 403);
      if (new Date(g.expires_at) < new Date()) return json({ error: "expired" }, 410);
      if (g.download_count >= g.max_downloads) return json({ error: "download_limit_reached" }, 429);
      const { data: eb } = await admin
        .from("ebooks").select("pdf_url").eq("id", g.ebook_id).maybeSingle();
      const pdfUrl = eb?.pdf_url as string | null;
      if (!pdfUrl) return json({ error: "asset_missing" }, 404);
      const parsed = parseStorageUrl(pdfUrl);
      bucket = parsed.bucket;
      storagePath = parsed.path;
      productId = g.ebook_id;
      await admin.from("download_grants").update({
        download_count: g.download_count + 1,
        last_downloaded_at: new Date().toISOString(),
      }).eq("id", grantId);
    }

    if (!bucket || !storagePath) return json({ error: "asset_missing" }, 404);
    const { data: signed, error: signErr } = await admin.storage.from(bucket).createSignedUrl(storagePath, 300);
    if (signErr || !signed) return json({ error: "sign_failed" }, 500);

    await admin.from("acct_download_events").insert({
      user_id: user.id,
      grant_id: grantId,
      product_kind: kind === "kids" ? "kids_ebook" : "ebook",
      product_id: productId,
      storage_path: `${bucket}/${storagePath}`,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
      outcome: "issued",
    });

    return json({ url: signed.signedUrl, expires_in: 300 });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function parseStorageUrl(url: string): { bucket: string; path: string } {
  // supports both full https signed URLs and storage-relative "bucket/path" strings
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(\?|$)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  const [bucket, ...rest] = url.split("/");
  return { bucket, path: rest.join("/") };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
