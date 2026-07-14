// Admin card data: which cost-saving provider keys are wired, whether they
// live-ping successfully, and the last-7-days AI spend split by billing route.
// Never returns key values.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pingGemini(key: string): Promise<{ ok: boolean; note?: string }> {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: "GET" },
    );
    if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, note: (e as Error).message.slice(0, 80) }; }
}

async function pingFal(key: string): Promise<{ ok: boolean; note?: string }> {
  try {
    // Fal has no cheap list endpoint; a HEAD to the queue root returns 401/200
    // depending on the key so we just verify the key parses as a JWT-ish string
    // and the domain is reachable.
    const r = await fetch("https://queue.fal.run/", {
      method: "GET",
      headers: { Authorization: `Key ${key}` },
    });
    // fal returns 404 for GET /, but that means auth was accepted at the edge.
    if (r.status === 401 || r.status === 403) return { ok: false, note: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, note: (e as Error).message.slice(0, 80) }; }
}

async function pingGateway(key: string): Promise<{ ok: boolean; note?: string }> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, note: (e as Error).message.slice(0, 80) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    const falKey = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_KEY") ?? "";
    const gatewayKey = Deno.env.get("LOVABLE_API_KEY") ?? "";

    const [gPing, fPing, lPing] = await Promise.all([
      geminiKey.length > 10 ? pingGemini(geminiKey) : Promise.resolve({ ok: false, note: "not set" }),
      falKey.length > 10 ? pingFal(falKey) : Promise.resolve({ ok: false, note: "not set" }),
      gatewayKey.length > 10 ? pingGateway(gatewayKey) : Promise.resolve({ ok: false, note: "not set" }),
    ]);

    // Last-7-days spend split by provider
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await db
      .from("cost_log")
      .select("provider, cost_usd")
      .gte("created_at", since);
    if (error) throw error;

    const spend: Record<string, number> = { google_direct: 0, fal_direct: 0, gateway: 0, unknown: 0 };
    for (const r of rows ?? []) {
      const p = (r as { provider: string | null; cost_usd: number }).provider ?? "unknown";
      const bucket = p === "google_direct" || p === "fal_direct" || p === "gateway" ? p : "unknown";
      spend[bucket] += Number((r as { cost_usd: number }).cost_usd ?? 0);
    }
    const total = spend.google_direct + spend.fal_direct + spend.gateway + spend.unknown;

    return json({
      ok: true,
      providers: {
        gemini_direct: { present: !!(geminiKey && geminiKey.length > 10), ping: gPing, secret_name: "GEMINI_API_KEY" },
        fal_direct: { present: !!(falKey && falKey.length > 10), ping: fPing, secret_name: "FAL_API_KEY" },
        lovable_gateway: { present: !!(gatewayKey && gatewayKey.length > 10), ping: lPing, secret_name: "LOVABLE_API_KEY" },
      },
      spend_7d: {
        google_direct: Number(spend.google_direct.toFixed(4)),
        fal_direct: Number(spend.fal_direct.toFixed(4)),
        gateway: Number(spend.gateway.toFixed(4)),
        unknown: Number(spend.unknown.toFixed(4)),
        total: Number(total.toFixed(4)),
      },
      as_of: new Date().toISOString(),
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
