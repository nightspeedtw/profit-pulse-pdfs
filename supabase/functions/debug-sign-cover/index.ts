// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
declare const Deno: any;
Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { paths } = await req.json();
  const c = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const out: Record<string, string> = {};
  for (const p of paths) {
    const { data } = await c.storage.from("coloring-v2").createSignedUrl(p, 60 * 60 * 24 * 30);
    out[p] = data?.signedUrl ?? "";
  }
  return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
});
