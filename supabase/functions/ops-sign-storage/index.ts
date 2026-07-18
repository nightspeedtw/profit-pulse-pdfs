import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { bucket, path, expires = 60 * 60 * 24 * 365 } = await req.json();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const s = await db.storage.from(bucket).createSignedUrl(path, expires);
  return new Response(JSON.stringify(s.data ?? { error: s.error?.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
