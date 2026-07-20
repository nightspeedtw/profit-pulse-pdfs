// marketing-autopilot-tick — single orchestrator entry point that fans out
// to marketing-calendar-sync, marketing-campaign-runner, and
// marketing-bundle-composer. Respects the marketing_autopilot_v2_enabled
// feature flag and the marketing_settings.emergency_stop kill switch.
//
// Trigger: cron every 15 min OR admin "Run now" button.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

async function callInternal(name: string, body: unknown) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const force = !!body.force;

  const startedAt = new Date().toISOString();

  // Feature flag gate.
  const { data: flag } = await db
    .from("platform_settings")
    .select("value_json")
    .eq("key", "marketing_autopilot_v2_enabled")
    .maybeSingle();
  const enabled = flag?.value_json === true || flag?.value_json === "true";
  if (!enabled && !force) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "marketing_autopilot_v2_disabled", started_at: startedAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Kill switch.
  const { data: mset } = await db
    .from("marketing_settings")
    .select("emergency_stop")
    .limit(1)
    .maybeSingle();
  if (mset?.emergency_stop && !force) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "emergency_stop", started_at: startedAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const calendar = await callInternal("marketing-calendar-sync", {});
  const runner = await callInternal("marketing-campaign-runner", {});
  const bundles = await callInternal("marketing-bundle-composer", {});

  return new Response(
    JSON.stringify({
      ok: true,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      calendar,
      runner,
      bundles,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
