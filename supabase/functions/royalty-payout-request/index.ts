// Customer-initiated payout request. Validates KYC + available balance +
// minimum payout. Payouts are hard-blocked from live money movement in V1
// (sandbox flag stays true regardless of platform kill switch).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function getSetting(key: string): Promise<unknown> {
  const { data } = await supabase.from("platform_settings").select("value_json").eq("key", key).maybeSingle();
  return (data as any)?.value_json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const amountCents = Math.floor(Number(body?.amount_cents ?? 0));
  const method = String(body?.method ?? "pending");
  const destination = body?.destination ?? {};
  if (!amountCents || amountCents <= 0) return json({ error: "amount_cents required" }, 400);

  const kycRequired = (await getSetting("royalty_kyc_required")) !== false;
  const minUsd = Number((await getSetting("royalty_min_payout_usd")) ?? 50);
  const minCents = Math.floor(minUsd * 100);

  if (kycRequired) {
    const { data: kyc } = await supabase
      .from("roy_kyc_submissions")
      .select("status")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .maybeSingle();
    if (!kyc) return json({ error: "kyc_required" }, 403);
  }

  if (amountCents < minCents) return json({ error: "below_minimum", min_cents: minCents }, 400);

  const { data: avail } = await supabase.rpc("roy_available_cents", { p_user: user.id });
  const availableCents = Number(avail ?? 0);
  if (amountCents > availableCents) return json({ error: "insufficient_balance", available_cents: availableCents }, 400);

  const { data: row, error } = await supabase.from("roy_payout_requests").insert({
    user_id: user.id,
    amount_cents: amountCents,
    method,
    destination,
    status: "requested",
    is_sandbox: true,
  }).select().single();
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, request: row, sandbox: true });
});

function json(v: unknown, status = 200) {
  return new Response(JSON.stringify(v), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
