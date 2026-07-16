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

import { speciesAnatomyChecklistJson, getSpeciesAnatomy, isFantasyCategoryKey } from "./species-anatomy.ts";
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
  // Owner law (2026-07-16, cover audit): the same call must also answer
  // "name the primary subject you see; is it clearly recognizable as the
  // planned subject?" Amorphous blobs that pass anatomy (deformity-only)
  // must still fail category recognizability and force regeneration.
  named_subject?: string | null;
  recognizable?: boolean;
  category_match?: boolean;
}

// v5 — anatomy_deformity_only_v2 + subject_recognizability. Two questions,
// one call: (1) is the creature deformed? (2) is it recognizably the planned
// subject rather than an amorphous blob? Category/subject fit remains a
// SEPARATE gate; recognizability is not "does it belong in this category"
// but "can a parent see WHAT this shape is supposed to be".
export const ANATOMY_VERIFIER_VERSION = "v5:deformity_only+recognizable";

export interface AnatomyInputPage {
  page: number;
  subject: string;
  bytes: Uint8Array;
  mime: string; // "image/png" | "image/jpeg"
  /** Category the page ships in — enables fantasy tolerance per owner law. */
  category_key?: string;
  /** Optional scene/setting hint (e.g. "underwater reef") for context. */
  scene?: string;
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

// Owner law: anatomy_imagination_vs_deformity — separate real defects from
// intentional cuteness or canonical fantasy. Do NOT penalise stylization.
// Owner law: anatomy_deformity_only_v2 (supersedes anatomy_imagination_vs_deformity).
// The anatomy gate asks ONE question. Category / theme / subject fit is a
// SEPARATE gate (allowed_subjects) — do not police it here.
export const ANATOMY_RUBRIC_SYSTEM_TEXT =
  "You are the DEFORMITY + RECOGNIZABILITY auditor for a printable children's coloring-book. " +
  "Answer TWO questions about each image:\n" +
  "  Q1 (deformity): Would a parent see this creature as broken, injured, disabled, or " +
  "malformed — rather than merely stylized or fantastical?\n" +
  "  Q2 (recognizability): Name the primary subject you actually see. Is it clearly " +
  "recognizable as the planned subject (see checklist.subject), or is it an amorphous " +
  "blob / potato-shape / egg-with-a-face / anything a parent could not identify?\n" +
  "\n" +
  "FAIL Q1 only for real deformity of the depicted creature's OWN canonical form:\n" +
  "  - wrong COUNT of that creature's standard parts (a 4-legged being drawn with 5 legs, " +
  "a human hand with 6 fingers, 3 arms on a human, 3 eyes on one head)\n" +
  "  - fused / missing / extra / severed / floating / disembodied limbs or features\n" +
  "  - broken, incoherent, or Frankenstein-stitched bodies\n" +
  "  - grotesque injured-looking proportions (crushed, twisted, mangled)\n" +
  "\n" +
  "PASS Q1 for everything else. Explicitly PASS Q1:\n" +
  "  - cuteness & stylization: eyelashes on any animal, big sparkly eyes, smiles, blush, " +
  "bows / hats / clothing / props, cartoon simplification, line-art style\n" +
  "  - ALL imaginary beings in ANY category — mythical creatures, legends, fantasy, humans, " +
  "gods / deities, divine beasts, spirits, hybrids\n" +
  "  - canonical mythical / divine forms (judge generously against the creature's own canon): " +
  "unicorn (1 forehead horn), pegasus, mermaid, dragon, phoenix, fairy, naga, garuda, " +
  "kinnari, erawan / airavata (multi-headed elephant, canonically up to 33 heads), " +
  "nine-tailed fox (up to 9 tails), kirin, multi-armed deities\n" +
  "  - hybrid beings that are intentionally the plan's subject (centaur, sphinx, harpy)\n" +
  "\n" +
  "FAIL Q2 (recognizable=false, category_match=false) when the image is:\n" +
  "  - an amorphous blob, potato-shape, or lump with a face pasted on\n" +
  "  - an egg / oval / rock 'with a face' that does not read as the planned subject\n" +
  "  - a shape that reads as a different kind of creature entirely (planned=dinosaur but " +
  "you see a blob)\n" +
  "  - unrecognizable line-art that a parent cannot name\n" +
  "PASS Q2 when the image is clearly the planned subject even if stylized.\n" +
  "\n" +
  "The checklist supplied per image (body_parts, proportion_rules, common_ai_failure_modes, " +
  "fantasy flag, category_key, subject) is a helpful reference — use it to know the creature's " +
  "canon — but the pass/fail decision is the two questions above.\n" +
  "\n" +
  "Return STRICT JSON: " +
  `{"verdicts":[{"index":number,"pass":boolean,"anatomy_score":number(0..100),` +
  `"defects":string[],"named_subject":string,"recognizable":boolean,` +
  `"category_match":boolean}]}. ` +
  "Score 90+ for anatomy_score whenever no real deformity is present. Never list " +
  "stylization, cuteness, or canonical mythical features in defects. If recognizable=false, " +
  "add \"unrecognizable_subject\" (or \"blob_shape\", \"egg_with_face\") to defects so the " +
  "page is regenerated. Do not include prose.";

// Kept for backwards-compat with any external import.
const SYSTEM_TEXT = ANATOMY_RUBRIC_SYSTEM_TEXT;

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

  const checklists = batch.map((p, i) => {
    const spec = getSpeciesAnatomy(p.subject);
    const fantasyOk = !!spec.fantasy || isFantasyCategoryKey(p.category_key);
    return {
      index: i,
      page: p.page,
      subject: p.subject,
      category_key: p.category_key ?? null,
      scene: p.scene ?? null,
      fantasy: !!spec.fantasy,
      fantasy_ok: fantasyOk,
      checklist: speciesAnatomyChecklistJson(p.subject),
    };
  });

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

  const byIndex = new Map<number, {
    pass: boolean;
    anatomy_score: number;
    defects: string[];
    named_subject: string | null;
    recognizable: boolean;
    category_match: boolean;
  }>();
  for (const v of winner.parsed.verdicts ?? []) {
    if (typeof v.index === "number") {
      const recognizable = v.recognizable !== false; // undefined = pass-safe when model omits
      const categoryMatch = v.category_match !== false;
      byIndex.set(v.index, {
        pass: !!v.pass,
        anatomy_score: Number.isFinite(v.anatomy_score) ? Math.max(0, Math.min(100, Math.round(v.anatomy_score))) : 0,
        defects: Array.isArray(v.defects) ? v.defects.map(String).slice(0, 12) : [],
        named_subject: typeof v.named_subject === "string" ? v.named_subject.slice(0, 80) : null,
        recognizable,
        category_match: categoryMatch,
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
    // Owner law: unrecognizable subject = category_match FAIL and page must
    // regenerate. Merge into defects so the assemble gate + repair ladder
    // treat it the same as an anatomy defect.
    const mergedDefects = [...v.defects];
    if (!v.recognizable) mergedDefects.push(`unrecognizable_subject:${v.named_subject ?? "unknown"}`);
    if (!v.category_match) mergedDefects.push(`category_match_fail:${v.named_subject ?? "unknown"}_vs_${p.subject}`);
    out.push({
      page: p.page,
      subject: p.subject,
      species_key: spec.species_key,
      pass: v.pass && v.anatomy_score >= 90 && mergedDefects.length === 0 && v.recognizable && v.category_match,
      anatomy_score: v.anatomy_score,
      defects: mergedDefects,
      degraded: false,
      model: winner.model,
      measured_at: new Date().toISOString(),
      measured_version: ANATOMY_VERIFIER_VERSION,
      named_subject: v.named_subject,
      recognizable: v.recognizable,
      category_match: v.category_match,
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
