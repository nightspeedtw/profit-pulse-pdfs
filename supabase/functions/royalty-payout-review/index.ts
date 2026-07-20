// Admin: approve / reject / mark-paid a payout request.
// Sandbox only — writing a ledger entry when marked "paid" records the debit
// against shareholder_accrued for double-entry correctness, but NO real money
// leaves the platform. Requires platform_settings.royalty_payouts_live to be
// true before allowing status transitions to "paid".
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

  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const requestId = String(body?.request_id ?? "");
  const action = String(body?.action ?? ""); // approve | reject | mark_paid | cancel
  const notes = body?.notes ? String(body.notes) : null;
  if (!requestId || !action) return json({ error: "request_id + action required" }, 400);

  const { data: pr, error: prErr } = await supabase.from("roy_payout_requests").select("*").eq("id", requestId).single();
  if (prErr || !pr) return json({ error: "not found" }, 404);

  const payoutsLive = (await getSetting("royalty_payouts_live")) === true;

  const patch: Record<string, unknown> = {
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    admin_notes: notes ?? pr.admin_notes,
  };

  if (action === "approve") {
    if (pr.status !== "requested") return json({ error: "invalid transition" }, 400);
    patch.status = "approved";
  } else if (action === "reject") {
    if (!["requested", "approved"].includes(pr.status)) return json({ error: "invalid transition" }, 400);
    patch.status = "rejected";
  } else if (action === "cancel") {
    if (!["requested", "approved"].includes(pr.status)) return json({ error: "invalid transition" }, 400);
    patch.status = "cancelled";
  } else if (action === "mark_paid") {
    if (pr.status !== "approved") return json({ error: "must be approved first" }, 400);
    if (!payoutsLive) return json({ error: "payouts_live=false; flip kill switch first" }, 403);
    patch.status = "paid";
    patch.paid_at = new Date().toISOString();
  } else {
    return json({ error: "unknown action" }, 400);
  }

  const { data: updated, error: upErr } = await supabase
    .from("roy_payout_requests")
    .update(patch)
    .eq("id", requestId)
    .select()
    .single();
  if (upErr) return json({ error: upErr.message }, 400);

  return json({ ok: true, request: updated, sandbox: true, payouts_live: payoutsLive });
});

function json(v: unknown, status = 200) {
  return new Response(JSON.stringify(v), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
