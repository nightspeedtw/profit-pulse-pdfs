// Anatomy vision verifier — measured, not constants.
// Owner mandate: every interior page must be judged against the species
// checklist BEFORE upload-accept. Pages without a stored anatomy verdict
// are considered UNMEASURED and MUST NOT be scored 95 by default at
// assemble-time — the assemble gate refuses them.
//
// Cost control: 6-8 pages per Gemini vision call, returns strict JSON.

import { speciesAnatomyChecklistJson } from "./species-anatomy.ts";

export interface AnatomyPageVerdict {
  page: number;
  subject: string;
  species_key: string;
  pass: boolean;
  anatomy_score: number;     // 0..100 measured
  defects: string[];         // named failure classes
  degraded: boolean;         // vision unavailable / parse fail — TREAT AS UNMEASURED
  model?: string;
  measured_at: string;       // ISO
  measured_version: string;  // ties verdict to this verifier version
}

export const ANATOMY_VERIFIER_VERSION = "v1:species_checklist_gemini";

export interface AnatomyInputPage {
  page: number;
  subject: string;
  bytes: Uint8Array;
  mime: string; // "image/png" | "image/jpeg"
}

const GEMINI_KEY = (globalThis as any).Deno?.env?.get?.("GEMINI_API_KEY") ?? "";

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

interface GeminiResp {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Verify a batch of pages against their species checklists.
 * Returns one verdict per input page (index-aligned).
 */
export async function verifyAnatomyBatch(
  batch: AnatomyInputPage[],
  opts: { model?: string } = {},
): Promise<AnatomyPageVerdict[]> {
  if (batch.length === 0) return [];
  const model = opts.model ?? "gemini-2.5-flash";
  if (!GEMINI_KEY) return batch.map((p) => degradedVerdict(p, "no_gemini_key"));

  // Build the prompt: index each image and its checklist.
  const checklists = batch.map((p, i) => ({
    index: i,
    page: p.page,
    subject: p.subject,
    checklist: speciesAnatomyChecklistJson(p.subject),
  }));

  const systemText =
    "You are an anatomy auditor for a printable children's coloring-book. " +
    "For EACH indexed image, compare the depicted subject against its species checklist " +
    "(body_parts, proportion_rules, common_ai_failure_modes). " +
    "A page PASSES only if every body_part is present with the correct count/shape/attachment, " +
    "proportions are within the rules, and none of the common_ai_failure_modes are visible. " +
    "Line-art style, cartoon stylization, and simplification are acceptable — only anatomical " +
    "correctness is judged here. " +
    "Return STRICT JSON with the schema: " +
    `{"verdicts":[{"index":number,"pass":boolean,"anatomy_score":number(0..100),` +
    `"defects":string[]}]}. ` +
    "Score 90+ only when no defects are present. Do not include prose.";

  const parts: Array<Record<string, unknown>> = [
    { text: systemText },
    { text: `Checklists (index-aligned with images that follow):\n${JSON.stringify(checklists)}` },
  ];
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    parts.push({ text: `--- image index ${i} (page ${p.page}, subject: ${p.subject}) ---` });
    parts.push({ inlineData: { mimeType: p.mime, data: bytesToBase64(p.bytes) } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  let raw: GeminiResp;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) {
      const t = (await r.text()).slice(0, 200);
      return batch.map((p) => degradedVerdict(p, `http_${r.status}:${t}`));
    }
    raw = await r.json() as GeminiResp;
  } catch (e) {
    return batch.map((p) => degradedVerdict(p, `fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}`));
  }

  const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { verdicts?: Array<{ index: number; pass: boolean; anatomy_score: number; defects?: string[] }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return batch.map((p) => degradedVerdict(p, "json_parse_fail"));
  }

  const out: AnatomyPageVerdict[] = [];
  const byIndex = new Map<number, { pass: boolean; anatomy_score: number; defects: string[] }>();
  for (const v of parsed.verdicts ?? []) {
    if (typeof v.index === "number") {
      byIndex.set(v.index, {
        pass: !!v.pass,
        anatomy_score: Number.isFinite(v.anatomy_score) ? Math.max(0, Math.min(100, Math.round(v.anatomy_score))) : 0,
        defects: Array.isArray(v.defects) ? v.defects.map(String).slice(0, 12) : [],
      });
    }
  }
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    const spec = speciesAnatomyChecklistJson(p.subject);
    const v = byIndex.get(i);
    if (!v) {
      out.push(degradedVerdict(p, "no_verdict_for_index"));
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
      model,
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
