// Coloring V2 anatomy gate — direct Gemini vision call (bypass-safe).
//
// Permanent defect-class fix (2026-07-22, coloring_v2_anatomy_gate_v1):
// The V2 render + QC lanes had NO anatomy verifier. Deformed animals
// (two heads, fused limbs, floating parts) were shipping into the final
// PDF. This module runs a compact deformity+recognizability audit on raw
// interior bytes AT the render step (before upload) and again at QC as a
// safety net.
//
// Uses direct Google AI Studio (generativelanguage.googleapis.com) so it
// works under BYPASS_LOVABLE_GATEWAY=1. Ladder = 2 cheap flash models.
// A verifier outage returns `degraded=true` (never pass=false with 0 score)
// so callers can distinguish real defects from provider errors.
// @ts-nocheck

declare const Deno: any;

function getGeminiKey(): string | undefined {
  try { return (globalThis as any).Deno?.env?.get?.("GEMINI_API_KEY"); }
  catch { return undefined; }
}
function getOpenAIKey(): string | undefined {
  try { return (globalThis as any).Deno?.env?.get?.("OPENAI_API_KEY"); }
  catch { return undefined; }
}
// PERMANENT FIX (2026-07-22 anatomy_gate_openai_primary_v3):
// Google AI Studio free tier returns 404 on all gemini-*-flash vision
// models for this project. Switch primary verifier to OpenAI GPT-4o vision
// (OPENAI_API_KEY is provisioned). Keep Gemini as fallback for the day the
// Google quota is restored — ladder tries OpenAI first, then Gemini.
const OPENAI_MODEL_LADDER = ["gpt-4o-mini", "gpt-4o"];
const GEMINI_MODEL_LADDER = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

export const V2_ANATOMY_GATE_VERSION = "v1:coloring_v2_anatomy_gate";

export interface V2AnatomyVerdict {
  pass: boolean;
  anatomy_score: number;   // 0..100, 0 iff degraded
  defects: string[];        // named defect classes
  recognizable: boolean;
  named_subject: string | null;
  degraded: boolean;        // true = verifier outage, do not treat as defect
  model?: string;
  measured_at: string;
}

const SYSTEM = [
  "You are the DEFORMITY + RECOGNIZABILITY auditor for a children's coloring-book page.",
  "Answer TWO questions about the black-line-art image:",
  "  Q1 (deformity): Would a parent see this creature/character as broken, injured, or malformed",
  "  — rather than merely stylized or fantastical?",
  "  Q2 (recognizability): Is it clearly recognizable as the planned subject, or an amorphous blob",
  "  / potato-shape / egg-with-a-face that a parent could not name?",
  "",
  "FAIL Q1 only for REAL deformity of the depicted creature's own canonical form:",
  "  - wrong COUNT of standard parts (2 heads on one body, 5 legs on a quadruped, 6 fingers on a human hand, 3 eyes on one face)",
  "  - fused, missing, extra, severed, floating, or disembodied limbs / features",
  "  - broken, incoherent, or Frankenstein-stitched bodies",
  "  - grotesque injured-looking proportions (crushed, twisted, mangled)",
  "PASS Q1 for cuteness, stylization, cartoon simplification, big eyes, clothing, canonical mythical forms (unicorn horn, mermaid tail, multi-headed mythic beast if it IS the planned subject).",
  "",
  "FAIL Q2 for amorphous blobs, potato-shapes, unrecognizable line-art.",
  "PASS Q2 when the image is clearly the planned subject even if stylized.",
  "",
  'Return STRICT JSON: {"pass":bool,"anatomy_score":0-100,"defects":[string],"recognizable":bool,"named_subject":string}.',
  "Score 90+ whenever no real deformity is present. Never list stylization or cuteness in defects.",
  "If recognizable is false, add \"unrecognizable_subject\" to defects.",
  "No prose.",
].join("\n");

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function degraded(reason: string): V2AnatomyVerdict {
  return {
    pass: false,
    anatomy_score: 0,
    defects: [`v2_anatomy_verifier_degraded:${reason}`],
    recognizable: false,
    named_subject: null,
    degraded: true,
    measured_at: new Date().toISOString(),
  };
}

function normalizeVerdict(parsed: any, providerModel: string): V2AnatomyVerdict {
  const score = Number.isFinite(parsed?.anatomy_score) ? Math.max(0, Math.min(100, Math.round(parsed.anatomy_score))) : 0;
  const defects = Array.isArray(parsed?.defects) ? parsed.defects.map(String).slice(0, 12) : [];
  const recognizable = parsed?.recognizable !== false;
  const named = typeof parsed?.named_subject === "string" ? parsed.named_subject.slice(0, 80) : null;
  const mergedDefects = [...defects];
  if (!recognizable) mergedDefects.push(`unrecognizable_subject:${named ?? "unknown"}`);
  const pass = parsed?.pass === true && score >= 90 && mergedDefects.length === 0 && recognizable;
  return {
    pass, anatomy_score: score, defects: mergedDefects, recognizable,
    named_subject: named, degraded: false, model: providerModel,
    measured_at: new Date().toISOString(),
  };
}

function tryParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callOpenAI(
  model: string, bytes: Uint8Array, mime: string, subject: string, scene: string,
): Promise<{ ok: boolean; reason?: string; verdict?: V2AnatomyVerdict }> {
  const key = getOpenAIKey(); if (!key) return { ok: false, reason: "no_openai_key" };
  const user = [
    `Planned subject: "${subject}".`,
    scene ? `Scene: "${scene}".` : "",
    "Audit the attached image and return the JSON.",
  ].filter(Boolean).join("\n");
  const dataUrl = `data:${mime};base64,${bytesToB64(bytes)}`;
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: dataUrl } },
      ]},
    ],
  };
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: `fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  if (!r.ok) return { ok: false, reason: `http_${r.status}:${(await r.text()).slice(0, 200)}` };
  let j: any; try { j = await r.json(); } catch { return { ok: false, reason: "resp_json_fail" }; }
  const text = j?.choices?.[0]?.message?.content ?? "";
  const parsed = tryParseJson(text);
  if (!parsed) return { ok: false, reason: "json_parse_fail" };
  return { ok: true, verdict: normalizeVerdict(parsed, `openai/${model}`) };
}

async function callGemini(
  model: string, bytes: Uint8Array, mime: string, subject: string, scene: string,
): Promise<{ ok: boolean; reason?: string; verdict?: V2AnatomyVerdict }> {
  const GEMINI_KEY = getGeminiKey(); if (!GEMINI_KEY) return { ok: false, reason: "no_gemini_key" };
  const user = [
    `Planned subject: "${subject}".`,
    scene ? `Scene: "${scene}".` : "",
    "Audit the attached image and return the JSON.",
  ].filter(Boolean).join("\n");
  const body = {
    contents: [{ role: "user", parts: [{ text: user }, { inlineData: { mimeType: mime, data: bytesToB64(bytes) } }] }],
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { responseMimeType: "application/json" },
  };
  let r: Response;
  try {
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
  } catch (e) {
    return { ok: false, reason: `fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  if (!r.ok) return { ok: false, reason: `http_${r.status}:${(await r.text()).slice(0, 200)}` };
  let j: any; try { j = await r.json(); } catch { return { ok: false, reason: "resp_json_fail" }; }
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  const parsed = tryParseJson(text);
  if (!parsed) return { ok: false, reason: "json_parse_fail" };
  return { ok: true, verdict: normalizeVerdict(parsed, `google/${model}`) };
}

/**
 * Check anatomy of a single interior page. OpenAI GPT-4o vision primary,
 * Gemini fallback. A degraded verdict means both providers were
 * unreachable — callers MUST NOT treat degraded as a defect.
 */
export async function checkPageAnatomy(input: {
  bytes: Uint8Array;
  mime: string;
  subject: string;
  scene?: string;
}): Promise<V2AnatomyVerdict> {
  const mime = input.mime || "image/jpeg";
  const subject = input.subject || "the subject";
  const scene = input.scene ?? "";
  let lastReason = "no_models_tried";
  if (getOpenAIKey()) {
    for (const m of OPENAI_MODEL_LADDER) {
      const res = await callOpenAI(m, input.bytes, mime, subject, scene);
      if (res.ok && res.verdict) return res.verdict;
      lastReason = `openai/${m}:${res.reason ?? "unknown"}`;
      console.warn(`[coloring-v2 anatomy] ${lastReason}`);
    }
  }
  if (getGeminiKey()) {
    for (const m of GEMINI_MODEL_LADDER) {
      const res = await callGemini(m, input.bytes, mime, subject, scene);
      if (res.ok && res.verdict) return res.verdict;
      lastReason = `google/${m}:${res.reason ?? "unknown"}`;
      console.warn(`[coloring-v2 anatomy] ${lastReason}`);
    }
  }
  return degraded(lastReason);
}

/** Derive an additive negative-prompt clause from a failed verdict. */
export function defectsToNegativeClause(defects: string[]): string {
  const map: Record<string, string> = {
    two_heads: "two heads",
    extra_head: "extra head, duplicated head",
    fused: "fused limbs, fused faces",
    severed: "severed limb, disconnected body parts",
    floating: "floating limbs, floating body parts",
    disembodied: "disembodied body parts",
    extra_limb: "extra limbs",
    missing_limb: "missing limbs",
    wrong_count: "wrong number of legs, wrong number of fins, wrong number of arms",
    mangled: "mangled anatomy",
    twisted: "twisted body",
    frankenstein: "frankenstein composition, stitched body",
    deformed: "deformed body",
    malformed: "malformed anatomy",
    unrecognizable_subject: "amorphous blob, potato shape, unrecognizable creature",
    blob_shape: "amorphous blob, potato shape",
  };
  const hits = new Set<string>();
  for (const d of defects) {
    const s = String(d).toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (s.includes(k)) hits.add(v);
    }
  }
  return Array.from(hits).join(", ");
}
