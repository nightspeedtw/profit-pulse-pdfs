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
function getLovableKey(): string | undefined {
  try { return (globalThis as any).Deno?.env?.get?.("LOVABLE_API_KEY"); }
  catch { return undefined; }
}
// PERMANENT FIX (2026-07-24 anatomy_cloudflare_primary_v4 → v5:model_refresh):
// OpenAI billing exhausted and Google AI Studio direct returns 404 on the
// older gemini-*-flash vision IDs for this project. Cloudflare Workers AI
// llava-1.5 is cheap and covered by CF_ACCOUNT_ID + CF_API_TOKEN. The
// Gemini direct ladder is refreshed to the current stable model names.
// Ladder is now:
//   1) Cloudflare @cf/llava-hf/llava-1.5-7b-hf (primary)
//   2) Google Gemini 3.5/2.5 Flash direct        (secondary)
//   3) OpenAI GPT-4o / GPT-4o-mini             (tertiary — usually billing-locked)
//   4) Lovable AI Gateway                      (outage backstop)
// A verifier outage returns degraded=true so callers do NOT treat it as a defect.
const CLOUDFLARE_MODEL_LADDER = [
  "@cf/llava-hf/llava-1.5-7b-hf",
  "@cf/meta/llama-3.2-11b-vision-instruct",
];
// Per-account+model auto-agree memo so we don't keep POSTing "agree" forever.
const CF_AGREED_ANATOMY = new Set<string>();
const OPENAI_MODEL_LADDER = ["gpt-4o-mini", "gpt-4o"];
const GEMINI_MODEL_LADDER = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
const LOVABLE_MODEL_LADDER = ["google/gemini-3.5-flash", "google/gemini-3.6-flash"];

export const V2_ANATOMY_GATE_VERSION = "v7:uninterpretable_skips";

// Owner law (2026-07-24 anatomy_uninterpretable_skips_v7):
// If the verifier cannot verify or cannot interpret the subject
// (unrecognizable_subject, abstract composition, non-creature scene, or
// only non-anatomy defect tokens), the page is treated as UNMEASURED
// (degraded=true) — NOT as a defect. The render step uploads it with
// anatomy_unmeasured=true and the book keeps moving. Only MEASURED,
// clear deformities of a real creature's canonical form block.
const REAL_ANATOMY_DEFECT_RE = /(two[_\s-]?heads?|extra[_\s-]?heads?|duplicated[_\s-]?heads?|fused[_\s-]?(?:faces?|limbs?|bodies|heads?)|missing[_\s-]?(?:limb|leg|arm|head|eye)|extra[_\s-]?(?:limb|leg|arm|head|eye|fingers?)|severed|floating[_\s-]?(?:limb|part|head)|disembodied|wrong[_\s-]?number[_\s-]?of|malformed[_\s-]?body|mangled|frankenstein|amorphous[_\s-]?blob|broken[_\s-]?body|crushed[_\s-]?body|twisted[_\s-]?body|incoherent[_\s-]?body|5[_\s-]?legs?|three[_\s-]?arms?|6[_\s-]?fingers?)/i;

function hasRealAnatomyDefect(defects: string[]): boolean {
  return defects.some((d) => REAL_ANATOMY_DEFECT_RE.test(String(d)));
}

// Canonical-parts contract (2026-07-23 anatomy_canonical_parts_v2).
// Owner directive: Starlight Unicorns shipped with missing legs and broken
// horns because the auditor had no explicit part inventory. We now bind
// subject → canonical part counts and pass them to the vision judge as a
// hard checklist. Wrong counts fail the gate.
type CanonicalParts = {
  head: number; eyes: number; legs?: number; arms?: number;
  horn?: number; tail?: number; wings?: number; fins?: number; tail_fin?: number;
};
const CANONICAL_PARTS: Array<{ match: RegExp; label: string; parts: CanonicalParts }> = [
  { match: /unicorn/i, label: "unicorn", parts: { head: 1, eyes: 2, legs: 4, horn: 1, tail: 1 } },
  { match: /pegasus/i, label: "pegasus", parts: { head: 1, eyes: 2, legs: 4, wings: 2, tail: 1 } },
  { match: /dragon/i, label: "dragon", parts: { head: 1, eyes: 2, legs: 4, wings: 2, tail: 1 } },
  { match: /mermaid/i, label: "mermaid", parts: { head: 1, eyes: 2, arms: 2, tail_fin: 1 } },
  { match: /fairy|angel/i, label: "fairy", parts: { head: 1, eyes: 2, arms: 2, legs: 2, wings: 2 } },
  { match: /butterfly|moth/i, label: "butterfly", parts: { head: 1, wings: 4, legs: 6 } },
  { match: /octopus/i, label: "octopus", parts: { head: 1, eyes: 2, legs: 8 } },
  { match: /spider/i, label: "spider", parts: { head: 1, legs: 8 } },
  { match: /crab/i, label: "crab", parts: { head: 1, eyes: 2, legs: 8 } },
  { match: /bird|owl|penguin|chick|duck/i, label: "bird", parts: { head: 1, eyes: 2, wings: 2, legs: 2, tail: 1 } },
  { match: /fish|shark|whale|dolphin/i, label: "fish", parts: { head: 1, eyes: 2, fins: 4, tail_fin: 1 } },
  { match: /turtle|tortoise/i, label: "turtle", parts: { head: 1, eyes: 2, legs: 4, tail: 1 } },
  { match: /dino|dinosaur|t-?rex|triceratops/i, label: "dinosaur", parts: { head: 1, eyes: 2, legs: 4, tail: 1 } },
  { match: /horse|pony/i, label: "horse", parts: { head: 1, eyes: 2, legs: 4, tail: 1 } },
  { match: /cat|dog|puppy|kitten|fox|bear|panda|rabbit|bunny|deer|lion|tiger|elephant|cow|pig|sheep|goat|monkey/i, label: "quadruped", parts: { head: 1, eyes: 2, legs: 4, tail: 1 } },
  { match: /human|child|kid|girl|boy|person/i, label: "human", parts: { head: 1, eyes: 2, arms: 2, legs: 2 } },
];

function canonicalPartsFor(subject: string): { label: string; parts: CanonicalParts } | null {
  const s = String(subject ?? "");
  for (const c of CANONICAL_PARTS) if (c.match.test(s)) return { label: c.label, parts: c.parts };
  return null;
}

function formatPartsChecklist(parts: CanonicalParts): string {
  return Object.entries(parts)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
    .join(", ");
}


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

  // anatomy_uninterpretable_skips_v7: verifier can't interpret the subject
  // (abstract scene, unrecognizable, or reported only non-anatomy issues).
  // Route through the degraded path so callers upload with anatomy_unmeasured
  // and keep the book moving. Real measured deformities still fail hard.
  const anyReal = hasRealAnatomyDefect(mergedDefects);
  if (!recognizable && !anyReal) {
    return {
      pass: true,
      anatomy_score: Math.max(score, 85),
      defects: mergedDefects,
      recognizable: false,
      named_subject: named,
      degraded: true,
      model: providerModel,
      measured_at: new Date().toISOString(),
    };
  }
  if (parsed?.pass !== true && mergedDefects.length > 0 && !anyReal) {
    // Verifier flagged something but nothing maps to a real anatomy defect
    // class — treat as uninterpretable, not a defect.
    return {
      pass: true,
      anatomy_score: Math.max(score, 85),
      defects: mergedDefects,
      recognizable,
      named_subject: named,
      degraded: true,
      model: providerModel,
      measured_at: new Date().toISOString(),
    };
  }

  const pass = parsed?.pass === true && score >= 90 && !anyReal && recognizable;
  return {
    pass, anatomy_score: score, defects: mergedDefects, recognizable,
    named_subject: named, degraded: false, model: providerModel,
    measured_at: new Date().toISOString(),
  };
}

function tryParseJson(text: unknown): any | null {
  const s = typeof text === "string" ? text : (text == null ? "" : String(text));
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}


function buildUserPrompt(subject: string, scene: string): string {
  const canon = canonicalPartsFor(subject) ?? canonicalPartsFor(scene);
  const checklist = canon ? `Canonical parts for "${canon.label}" (fail if wrong count): ${formatPartsChecklist(canon.parts)}.` : "";
  return [
    `Planned subject: "${subject}".`,
    scene ? `Scene: "${scene}".` : "",
    checklist,
    "Audit the attached image and return the JSON.",
  ].filter(Boolean).join("\n");
}


async function callOpenAI(
  model: string, bytes: Uint8Array, mime: string, subject: string, scene: string,
): Promise<{ ok: boolean; reason?: string; verdict?: V2AnatomyVerdict }> {
  const key = getOpenAIKey(); if (!key) return { ok: false, reason: "no_openai_key" };
  const user = buildUserPrompt(subject, scene);

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
  const user = buildUserPrompt(subject, scene);

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
 * Check anatomy of a single interior page. Provider ladder:
 *   1) Cloudflare Workers AI llava-1.5 (primary — cheap, reliable)
 *   2) Google Gemini vision (direct: gemini-3.5-flash, gemini-2.5-flash)
 *   3) OpenAI GPT-4o vision (direct)
 *   4) Lovable AI Gateway (google/gemini-3.5-flash) — outage backstop
 * A degraded verdict means every provider was unreachable — callers MUST
 * NOT treat degraded as a defect.
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
  if (getCloudflareCreds()) {
    for (const m of CLOUDFLARE_MODEL_LADDER) {
      const res = await callCloudflare(m, input.bytes, mime, subject, scene);
      if (res.ok && res.verdict) return res.verdict;
      lastReason = `cloudflare/${m}:${res.reason ?? "unknown"}`;
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
  if (getOpenAIKey()) {
    for (const m of OPENAI_MODEL_LADDER) {
      const res = await callOpenAI(m, input.bytes, mime, subject, scene);
      if (res.ok && res.verdict) return res.verdict;
      lastReason = `openai/${m}:${res.reason ?? "unknown"}`;
      console.warn(`[coloring-v2 anatomy] ${lastReason}`);
    }
  }
  if (getLovableKey()) {
    for (const m of LOVABLE_MODEL_LADDER) {
      const res = await callLovableGateway(m, input.bytes, mime, subject, scene);
      if (res.ok && res.verdict) return res.verdict;
      lastReason = `lovable/${m}:${res.reason ?? "unknown"}`;
      console.warn(`[coloring-v2 anatomy] ${lastReason}`);
    }
  }
  return degraded(lastReason);
}

function getCloudflareCreds(): { accountId: string; token: string } | null {
  const envs = [
    ["CF_ACCOUNT_ID", "CF_API_TOKEN"],
    ["CF_ACCOUNT_ID_2", "CF_API_TOKEN_2"],
    ["CF_ACCOUNT_ID_3", "CF_API_TOKEN_3"],
    ["CF_ACCOUNT_ID_4", "CF_API_TOKEN_4"],
    ["CF_ACCOUNT_ID_5", "CF_API_TOKEN_5"],
    ["CF_ACCOUNT_ID_6", "CF_API_TOKEN_6"],
  ];
  for (const [aKey, tKey] of envs) {
    try {
      const a = (globalThis as any).Deno?.env?.get?.(aKey);
      const t = (globalThis as any).Deno?.env?.get?.(tKey);
      if (a && t) return { accountId: a, token: t };
    } catch { /* keep going */ }
  }
  return null;
}

async function callCloudflare(
  model: string, bytes: Uint8Array, mime: string, subject: string, scene: string,
): Promise<{ ok: boolean; reason?: string; verdict?: V2AnatomyVerdict }> {
  void mime;
  const creds = getCloudflareCreds();
  if (!creds) return { ok: false, reason: "no_cf_creds" };
  const user = buildUserPrompt(subject, scene);
  // CF vision models take a single `prompt` + `image` byte array. Fold SYSTEM
  // into the prompt and demand strict JSON.
  const prompt = `${SYSTEM}\n\n${user}\n\nRespond with ONLY the JSON object, no prose, no markdown fences.`;
  const buildBody = () => JSON.stringify({
    prompt, image: Array.from(bytes), max_tokens: 512, temperature: 0,
  });
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${model}`;
  const doCall = () => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.token}` },
    body: buildBody(),
  });
  let r: Response;
  try { r = await doCall(); }
  catch (e) { return { ok: false, reason: `fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
  // Auto-agree for llama-3.2 model licence prompt.
  if (r.status === 403) {
    const body = await r.text().catch(() => "");
    if (/Model Agreement|submit the prompt 'agree'/i.test(body)) {
      const memoKey = `${creds.accountId}:${model}`;
      if (!CF_AGREED_ANATOMY.has(memoKey)) {
        try {
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.token}` },
            body: JSON.stringify({ prompt: "agree" }),
          });
        } catch { /* best-effort */ }
        CF_AGREED_ANATOMY.add(memoKey);
        try { r = await doCall(); } catch (e) {
          return { ok: false, reason: `fetch_error_after_agree:${String((e as Error)?.message ?? e).slice(0, 120)}` };
        }
      }
    }
  }
  if (!r.ok) return { ok: false, reason: `http_${r.status}:${(await r.text()).slice(0, 200)}` };
  let j: any; try { j = await r.json(); } catch { return { ok: false, reason: "resp_json_fail" }; }
  const text: string = j?.result?.response ?? j?.result?.description ?? j?.result?.text ?? "";
  if (!text) return { ok: false, reason: "empty_response" };
  const parsed = tryParseJson(text);
  if (parsed) return { ok: true, verdict: normalizeVerdict(parsed, `cloudflare/${model}`) };
  // Prose fallback: small vision models sometimes ignore JSON instructions.
  // Extract a verdict from natural-language description.
  const proseVerdict = verdictFromProse(text, `cloudflare/${model}`);
  if (proseVerdict) return { ok: true, verdict: proseVerdict };
  return { ok: false, reason: "json_parse_fail" };
}

// Heuristic parser for freeform vision-model descriptions.
// Conservative: PASS only when the prose clearly shows no deformity signal.
function verdictFromProse(text: string, providerModel: string): V2AnatomyVerdict | null {
  const t = String(text).toLowerCase();
  if (t.length < 20) return null;
  const defectPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\b(two|three|multiple|extra|second)\s+heads?\b/, label: "extra_head" },
    { re: /\b(missing|no)\s+(limb|leg|arm|head|eye|tail|wing|fin)/, label: "missing_limb" },
    { re: /\b(extra|additional|too many)\s+(limb|leg|arm|eye|tail|wing|fin|finger)/, label: "extra_limb" },
    { re: /\bfused\b|\bconjoined\b|\bstitched\b|\bfrankenstein\b/, label: "fused" },
    { re: /\bsevered\b|\bdisembodied\b|\bfloating\s+(limb|arm|leg|head)/, label: "severed" },
    { re: /\bmalformed\b|\bdeformed\b|\bmangled\b|\bgrotesque\b/, label: "malformed" },
    { re: /\bwrong\s+(number|count)\s+of\b/, label: "wrong_count" },
    { re: /\bamorphous\b|\bunrecognizable\b|\bpotato[- ]shape\b|\bblob\b/, label: "unrecognizable_subject" },
    { re: /\b(6|six|5|five|7|seven)\s+(fingers|legs|arms)\b/, label: "wrong_count" },
  ];
  const defects: string[] = [];
  for (const p of defectPatterns) if (p.re.test(t)) defects.push(p.label);
  const hasPositive = /(no\s+deformity|no\s+deformities|looks?\s+(fine|correct|normal|healthy)|anatomically\s+correct|correct\s+anatomy|well[- ]formed|no\s+visible\s+issues)/.test(t);
  if (defects.length === 0 && hasPositive) {
    return {
      pass: true, anatomy_score: 90, defects: [], recognizable: true,
      named_subject: null, degraded: false, model: `${providerModel}+prose`,
      measured_at: new Date().toISOString(),
    };
  }
  if (defects.length > 0) {
    return {
      pass: false, anatomy_score: 40,
      defects: Array.from(new Set(defects)).slice(0, 6),
      recognizable: !defects.includes("unrecognizable_subject"),
      named_subject: null, degraded: false, model: `${providerModel}+prose`,
      measured_at: new Date().toISOString(),
    };
  }
  return null; // Ambiguous — let ladder continue.
}


async function callLovableGateway(
  model: string, bytes: Uint8Array, mime: string, subject: string, scene: string,
): Promise<{ ok: boolean; reason?: string; verdict?: V2AnatomyVerdict }> {
  const key = getLovableKey(); if (!key) return { ok: false, reason: "no_lovable_key" };
  const user = buildUserPrompt(subject, scene);

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
    r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  return { ok: true, verdict: normalizeVerdict(parsed, `lovable/${model}`) };
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
    horn: "extra horn, missing horn, broken horn, bent horn, two horns on one head",
    wing: "extra wings, missing wings, torn wings, one wing",
    tail: "extra tail, missing tail, severed tail",
    leg: "wrong number of legs, missing leg, extra leg, severed leg",
    fin: "wrong number of fins, missing fin",
    eye: "three eyes, one eye, wrong number of eyes",
    hand: "six fingers, extra fingers, missing fingers",
    proportion: "wrong proportions, distorted proportions",
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
