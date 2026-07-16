// Anatomy vision verifier — measured, not constants.
// Owner mandate: every interior page must be judged against the species
// checklist BEFORE upload-accept. Pages without a stored anatomy verdict
// are considered UNMEASURED and MUST NOT be scored 95 by default at
// assemble-time — the assemble gate refuses them.
//
// PERMANENT CLASS FIX (2026-07-16, verifier_model_deprecated):
// The verifier now walks a MODEL LADDER via the Lovable AI Gateway
// (chat-completions, image_url input) so a single model deprecation
// (e.g. gemini-2.5-flash 404 "no longer available") no longer nukes the
// whole queue. The ladder is data-driven — read from
// generation_settings.coloring_autopilot.anatomy_verifier_models —
// so the next deprecation is a config change, not a code change.
//
// Semantics for outages:
//   - transient HTTP error / bad JSON on a single model → try next model in ladder
//   - ALL models in ladder failed → return degraded verdict for every input page
//   - callers MUST treat degraded verdicts as UNMEASURED (do not fail the
//     page, do not increment repair attempts, do not delete storage;
//     halt via anatomy-verifier-guard when the lane counter trips).

import { speciesAnatomyChecklistJson } from "./species-anatomy.ts";
import {
  ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT,
  markVerifierHealthy,
  noteVerifierFailure,
} from "./anatomy-verifier-guard.ts";

export interface AnatomyPageVerdict {
  page: number;
  subject: string;
  species_key: string;
  pass: boolean;
  anatomy_score: number;     // 0..100 measured; 0 ONLY when degraded=false
  defects: string[];         // named failure classes
  degraded: boolean;         // vision unavailable / parse fail — TREAT AS UNMEASURED
  model?: string;
  measured_at: string;       // ISO
  measured_version: string;  // ties verdict to this verifier version
}

export const ANATOMY_VERIFIER_VERSION = "v2:model_ladder_gateway";

export interface AnatomyInputPage {
  page: number;
  subject: string;
  bytes: Uint8Array;
  mime: string; // "image/png" | "image/jpeg"
}

const LOVABLE_API_KEY = (globalThis as any).Deno?.env?.get?.("LOVABLE_API_KEY") ?? "";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).btoa(s);
}

function degradedVerdict(p: AnatomyInputPage, reason: string): AnatomyPageVerdict {
  const spec = speciesAnatomyChecklistJson(p.subject);
  return {
    page: p.page,
    subject: p.subject,
    species_key: spec.species_key,
    pass: false,
    anatomy_score: 0,
    defects: [`anatomy_verifier_degraded:${reason}`],
    degraded: true,
    measured_at: new Date().toISOString(),
    measured_version: ANATOMY_VERIFIER_VERSION,
  };
}

const SYSTEM_TEXT =
  "You are an anatomy auditor for a printable children's coloring-book. " +
  "For EACH indexed image, compare the depicted subject against its species checklist " +
  "(body_parts, proportion_rules, common_ai_failure_modes). " +
  "A page PASSES only if every body_part is present with the correct count/shape/attachment, " +
  "proportions are within the rules, and none of the common_ai_failure_modes are visible. " +
  "Line-art style, cartoon stylization, and simplification are acceptable — only anatomical " +
  "correctness is judged here. " +
  "Return STRICT JSON: " +
  `{"verdicts":[{"index":number,"pass":boolean,"anatomy_score":number(0..100),` +
  `"defects":string[]}]}. ` +
  "Score 90+ only when no defects are present. Do not include prose.";

interface OneModelResult {
  ok: boolean;
  reason?: string;
  parsed?: {
    verdicts?: Array<{ index: number; pass: boolean; anatomy_score: number; defects?: string[] }>;
  };
  model: string;
}

async function callOneModel(
  model: string,
  batch: AnatomyInputPage[],
  checklists: unknown,
): Promise<OneModelResult> {
  if (!LOVABLE_API_KEY) return { ok: false, reason: "no_lovable_api_key", model };
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `Checklists (index-aligned with images that follow):\n${JSON.stringify(checklists)}` },
  ];
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    content.push({ type: "text", text: `--- image index ${i} (page ${p.page}, subject: ${p.subject}) ---` });
    content.push({
      type: "image_url",
      image_url: { url: `data:${p.mime};base64,${bytesToBase64(p.bytes)}` },
    });
  }

  let r: Response;
  try {
    r = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_TEXT },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: `fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}`, model };
  }
  if (!r.ok) {
    const t = (await r.text()).slice(0, 200);
    return { ok: false, reason: `http_${r.status}:${t}`, model };
  }
  let raw: any;
  try {
    raw = await r.json();
  } catch (e) {
    return { ok: false, reason: `resp_json_fail:${String((e as Error)?.message ?? e).slice(0, 80)}`, model };
  }
  const text = raw?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.verdicts)) {
      return { ok: false, reason: "no_verdicts_array", model };
    }
    return { ok: true, parsed, model };
  } catch {
    return { ok: false, reason: "json_parse_fail", model };
  }
}

export interface VerifyBatchOpts {
  models?: string[];
  db?: any; // when passed, healthy/failure state is written to lane guard
}

/**
 * Verify a batch of pages against their species checklists.
 * Returns one verdict per input page (index-aligned).
 *
 * When `opts.db` is supplied, records verifier health into the lane guard:
 *   - first ok model → markVerifierHealthy (clears counter/flag)
 *   - all models failed → noteVerifierFailure (may throw AnatomyVerifierBlockedError
 *     after 3 consecutive failures — caller should catch and halt the lane)
 */
export async function verifyAnatomyBatch(
  batch: AnatomyInputPage[],
  opts: VerifyBatchOpts = {},
): Promise<AnatomyPageVerdict[]> {
  if (batch.length === 0) return [];
  const ladder = opts.models && opts.models.length > 0
    ? opts.models
    : [...ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT];

  const checklists = batch.map((p, i) => ({
    index: i,
    page: p.page,
    subject: p.subject,
    checklist: speciesAnatomyChecklistJson(p.subject),
  }));

  let lastReason = "no_models_tried";
  let winner: OneModelResult | null = null;
  for (const model of ladder) {
    const res = await callOneModel(model, batch, checklists);
    if (res.ok) { winner = res; break; }
    lastReason = `${model}:${res.reason ?? "unknown"}`;
    console.warn(`[anatomy-verify] model ${model} failed: ${res.reason}`);
  }

  if (!winner || !winner.parsed) {
    // Entire ladder failed → degraded verdicts + note lane failure.
    if (opts.db) {
      try { await noteVerifierFailure(opts.db, lastReason); } catch { /* re-throw caller's problem */ throw new (await import("./anatomy-verifier-guard.ts")).AnatomyVerifierBlockedError(3, lastReason); }
    }
    return batch.map((p) => degradedVerdict(p, lastReason));
  }

  // At least one model succeeded → verifier is healthy.
  if (opts.db) {
    try { await markVerifierHealthy(opts.db); } catch { /* best-effort */ }
  }

  const byIndex = new Map<number, { pass: boolean; anatomy_score: number; defects: string[] }>();
  for (const v of winner.parsed.verdicts ?? []) {
    if (typeof v.index === "number") {
      byIndex.set(v.index, {
        pass: !!v.pass,
        anatomy_score: Number.isFinite(v.anatomy_score) ? Math.max(0, Math.min(100, Math.round(v.anatomy_score))) : 0,
        defects: Array.isArray(v.defects) ? v.defects.map(String).slice(0, 12) : [],
      });
    }
  }

  const out: AnatomyPageVerdict[] = [];
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    const spec = speciesAnatomyChecklistJson(p.subject);
    const v = byIndex.get(i);
    if (!v) {
      // Model responded but skipped this index → treat this page as
      // unmeasured (do not condemn) — degraded=true.
      out.push(degradedVerdict(p, `${winner.model}:no_verdict_for_index`));
      continue;
    }
    out.push({
      page: p.page,
      subject: p.subject,
      species_key: spec.species_key,
      pass: v.pass && v.anatomy_score >= 90 && v.defects.length === 0,
      anatomy_score: v.anatomy_score,
      defects: v.defects,
      degraded: false,
      model: winner.model,
      measured_at: new Date().toISOString(),
      measured_version: ANATOMY_VERIFIER_VERSION,
    });
  }
  return out;
}

// ── Assemble-time helpers ─────────────────────────────────────────────
export interface AnatomyBookSummary {
  every_page_measured: boolean;
  unmeasured_pages: number[];
  min_page_score: number;
  mean_page_score: number;
  hard_fail_pages: { page: number; defects: string[] }[];
}

export function summarizeBookAnatomy(
  verdicts: AnatomyPageVerdict[],
  expectedPages: number[],
): AnatomyBookSummary {
  const byPage = new Map<number, AnatomyPageVerdict>();
  for (const v of verdicts) byPage.set(v.page, v);
  const unmeasured: number[] = [];
  const scores: number[] = [];
  const failed: { page: number; defects: string[] }[] = [];
  for (const p of expectedPages) {
    const v = byPage.get(p);
    if (!v || v.degraded) { unmeasured.push(p); continue; }
    scores.push(v.anatomy_score);
    if (!v.pass) failed.push({ page: p, defects: v.defects });
  }
  return {
    every_page_measured: unmeasured.length === 0,
    unmeasured_pages: unmeasured,
    min_page_score: scores.length ? Math.min(...scores) : 0,
    mean_page_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    hard_fail_pages: failed,
  };
}
