// story-batch-v2-preflight
// Runs all preflight checks and returns a machine-readable report.
// If ALL pass, marks the batch ready for portfolio planning.
// If ANY fail, sets batch to `blocked` with a specific reason — never fakes
// pass, never simulates providers.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  adminClient,
  AGE_BAND_CONTRACT,
  AgeBand,
  projectBatchCostCents,
  readBudget,
  STORY_BATCH_V2_TAG,
} from "../_shared/story-batch-v2.ts";

interface Check {
  key: string;
  ok: boolean;
  detail?: string;
}

async function checkDirectTextProvider(): Promise<Check> {
  const gemini = Deno.env.get("GEMINI_API_KEY");
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (gemini && gemini.length > 10) return { key: "direct_text_provider", ok: true, detail: "GEMINI_API_KEY present" };
  if (openai && openai.length > 10) return { key: "direct_text_provider", ok: true, detail: "OPENAI_API_KEY present" };
  return { key: "direct_text_provider", ok: false, detail: "missing GEMINI_API_KEY or OPENAI_API_KEY" };
}

async function checkLovableKey(): Promise<Check> {
  const { assertGatewayAllowed } = await import("../_shared/gateway-guard.ts");
  try {
    assertGatewayAllowed("story-batch-v2-preflight.checkLovableKey");
  } catch {
    return { key: "lovable_gateway", ok: true, detail: "bypassed by BYPASS_LOVABLE_GATEWAY" };
  }
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { key: "lovable_gateway", ok: false, detail: "missing" };
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
      }),
    });
    if (r.status === 402) return { key: "lovable_gateway", ok: false, detail: "credits_exhausted (402)" };
    if (r.status === 429) return { key: "lovable_gateway", ok: false, detail: "rate_limited (429)" };
    if (!r.ok) return { key: "lovable_gateway", ok: false, detail: `status ${r.status}` };
    return { key: "lovable_gateway", ok: true };
  } catch (e) {
    return { key: "lovable_gateway", ok: false, detail: String(e) };
  }
}

async function checkOpenAI(): Promise<Check> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { key: "openai_api_key", ok: false, detail: "missing — required for gpt-image-2 covers/interiors" };
  return { key: "openai_api_key", ok: true, detail: "present (balance not queried; call-time enforced)" };
}

async function checkStorage(): Promise<Check> {
  const supa = adminClient();
  try {
    const { data, error } = await supa.storage.getBucket("story-batch-v2");
    if (error || !data) return { key: "storage_bucket", ok: false, detail: error?.message ?? "missing" };
    return { key: "storage_bucket", ok: true };
  } catch (e) {
    return { key: "storage_bucket", ok: false, detail: String(e) };
  }
}

async function checkTables(): Promise<Check> {
  const supa = adminClient();
  const need = [
    "story_batch_v2_batches",
    "story_batch_v2_books",
    "story_batch_v2_cost_ledger",
    "story_batch_v2_assets",
    "story_batch_v2_qc_findings",
  ];
  for (const t of need) {
    const { error } = await supa.from(t).select("id").limit(1);
    if (error) return { key: "tables", ok: false, detail: `${t}: ${error.message}` };
  }
  return { key: "tables", ok: true };
}

async function checkMatterPagesSkill(): Promise<Check> {
  const supa = adminClient();
  const { data } = await supa
    .from("pipeline_skills")
    .select("id, name")
    .eq("name", "matter_pages_design_v2")
    .maybeSingle();
  if (!data) return { key: "matter_pages_design_v2", ok: false, detail: "pipeline_skills row missing" };
  return { key: "matter_pages_design_v2", ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = adminClient();
  let batchId: string | null = null;

  try {
    const { batch_id } = await req.json().catch(() => ({}));
    batchId = batch_id ?? null;
    if (!batchId) {
      // Create a fresh batch record for this preflight.
      const { data: newBatch, error } = await supa
        .from("story_batch_v2_batches")
        .insert({ status: "preflight", label: `batch-50-en-${new Date().toISOString().slice(0, 10)}` })
        .select()
        .single();
      if (error) throw error;
      batchId = newBatch.id;
    } else {
      await supa.from("story_batch_v2_batches").update({ status: "preflight" }).eq("id", batchId);
    }

    const { data: batch } = await supa
      .from("story_batch_v2_batches")
      .select("*")
      .eq("id", batchId!)
      .single();

    const checks: Check[] = [];
    checks.push(await checkTables());
    checks.push(await checkStorage());
    checks.push(await checkDirectTextProvider());
    checks.push(await checkLovableKey());
    checks.push(await checkOpenAI());
    checks.push(await checkMatterPagesSkill());

    // Budget projection
    const targets = batch.targets_by_age as Record<AgeBand, number>;
    const projected = projectBatchCostCents(targets);
    const budget = batch.budget_usd_cents as number;
    const budgetCheck: Check = {
      key: "projected_cost_within_ceiling",
      ok: projected <= budget,
      detail: `projected=$${(projected / 100).toFixed(2)} ceiling=$${(budget / 100).toFixed(2)}`,
    };
    checks.push(budgetCheck);

    // Portfolio sanity
    const total = Object.values(targets).reduce((a, b) => a + b, 0);
    checks.push({
      key: "portfolio_totals",
      ok: total === batch.target_total,
      detail: `sum=${total} target=${batch.target_total}`,
    });
    for (const [age, n] of Object.entries(targets)) {
      if (!(age in AGE_BAND_CONTRACT)) {
        checks.push({ key: `age_band_${age}`, ok: false, detail: "unknown age band" });
      } else if (typeof n !== "number" || n < 0) {
        checks.push({ key: `age_band_${age}`, ok: false, detail: "invalid count" });
      }
    }

    const allOk = checks.every((c) => c.ok);
    const state = await readBudget(batchId!);

    const report = {
      batch_id: batchId,
      checks,
      projected_cost_cents: projected,
      budget_state: state,
      ready: allOk,
      generated_at: new Date().toISOString(),
    };

    await supa
      .from("story_batch_v2_batches")
      .update({
        status: allOk ? "queued" : "blocked",
        blocker_reason: allOk ? null : checks.filter((c) => !c.ok).map((c) => `${c.key}:${c.detail ?? ""}`).join("; "),
        projected_cost_cents: projected,
        preflight_report: report,
      })
      .eq("id", batchId!);

    console.log(`${STORY_BATCH_V2_TAG} preflight batch=${batchId} ready=${allOk}`);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${STORY_BATCH_V2_TAG} preflight fatal:`, msg);
    if (batchId) {
      await supa
        .from("story_batch_v2_batches")
        .update({ status: "blocked", blocker_reason: `preflight_error: ${msg}` })
        .eq("id", batchId);
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
