// Requeue legacy ebooks that were produced before the premium-ebook-master
// gates existed (or that currently fail any gate) back through Sequential
// Safe Mode. Sets `re_render_reason`, bumps `re_render_count`, resets
// `pdf_status` and `canonical_status` so the orchestrator picks them up.
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeQcGates, legacyRequeueReason } from "../_shared/qc-gates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const passcode = req.headers.get("x-admin-passcode") ??
    (await req.clone().json().then((b) => b?.passcode).catch(() => null));
  if (passcode !== PASSCODE) {
    return json({ error: "unauthorized" }, 401);
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = !!body?.dry_run;
  } catch { /* ignore */ }

  // Pull every ebook that already reached rendering territory. We don't
  // touch drafts still in idea/outline stages.
  const { data: ebooks, error } = await supabase
    .from("ebooks")
    .select(
      "id,title,pdf_qc,cover_qc,reader_experience_qc,pdf_score,cover_score,reader_experience_score,reader_experience_status,reader_experience_fix_count,listing_status,qc_ready_for_storefront,re_render_count",
    )
    .not("cover_url", "is", null);
  if (error) return json({ error: error.message }, 500);

  const requeue: { id: string; title: string; reason: string }[] = [];
  for (const e of (ebooks ?? []) as Record<string, unknown>[]) {
    const report = computeQcGates(e);
    if (report.ready_for_storefront) continue;
    const reason = legacyRequeueReason(report) ?? "Legacy re-QC: gates incomplete";
    requeue.push({
      id: e.id as string,
      title: (e.title as string) ?? "(untitled)",
      reason,
    });
  }

  if (dryRun) {
    return json({ dry_run: true, count: requeue.length, items: requeue });
  }

  const now = new Date().toISOString();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const item of requeue) {
    // Fetch current re_render_count so we can bump it.
    const { data: cur } = await supabase
      .from("ebooks")
      .select("re_render_count")
      .eq("id", item.id)
      .maybeSingle();
    const count = ((cur as { re_render_count?: number } | null)?.re_render_count ?? 0) + 1;
    const { error: upErr } = await supabase
      .from("ebooks")
      .update({
        re_render_reason: item.reason,
        re_render_count: count,
        re_render_last_at: now,
        qc_ready_for_storefront: false,
        canonical_status: "needs_action",
        pdf_status: "idle",
        listing_status: "queued_for_reqc",
      })
      .eq("id", item.id);
    results.push({ id: item.id, ok: !upErr, error: upErr?.message });
  }

  return json({
    requeued: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    items: requeue,
    results,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
