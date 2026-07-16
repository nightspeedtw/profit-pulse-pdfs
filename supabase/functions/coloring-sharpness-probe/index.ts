// Temporary admin-only diagnostic: score private stored coloring images by path.
// Do not call from the app. This exists to collect owner-requested evidence for
// the sharpness v6 boundary-authority migration, then can be deleted.

// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeSharpness, SHARPNESS_GATE_VERSION } from "../_shared/coloring/sharpness-gate.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const bucket = body.bucket ?? "ebook-covers";
    const paths = Array.isArray(body.paths) ? body.paths : [];
    if (!paths.length || paths.some((p: unknown) => typeof p !== "string")) {
      return json({ error: "paths[] required" }, 400);
    }
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const results = [];
    for (const path of paths) {
      const dl = await db.storage.from(bucket).download(path);
      if (dl.error || !dl.data) {
        results.push({ path, error: dl.error?.message ?? "download_failed" });
        continue;
      }
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const sharpness = await computeSharpness(bytes);
      results.push({ path, bytes: bytes.length, gate_version: SHARPNESS_GATE_VERSION, sharpness });
    }
    return json({ ok: true, results });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});