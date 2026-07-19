// Cover vision guards — permanent rule enforcement for kids covers.
//
// TWO gates, applied AFTER luminance check and BEFORE returning ok from a
// non-fallback cover-ladder rung:
//
//   1. transcribeGlyphs(bytes)
//      Reads the raster with Gemini vision. Any detected letters/words/
//      numbers ⇒ the AI art has baked-in text (typography must come from
//      the SVG title layer ONLY). Rung is treated as dead-equivalent
//      (silent advance, does NOT consume retire budget).
//
//   2. verifyCategoryHero(bytes, {allowed_subjects, forbidden_subjects,
//                                 category_name})
//      Cover hero must match the category's declared subjects. E.g. a
//      "Sea Animals" cover with a human girl hero ⇒ wrong subject ⇒
//      silent advance to the next rung.
//
// Both guards fail SAFE: on any transport/parse error we return
// `{ ok: true, degraded: true }` so a transient Gemini outage cannot
// block the ladder — the SVG-synthetic-fallback rung remains
// dead-impossible terminal either way.
//
// Never lower thresholds. Never bypass the guard when a key is present.

// @ts-nocheck  Deno edge runtime

import { gradeCategoryPresence, type DetectedSubject } from "./category-presence-grader.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface GlyphVerdict {
  ok: boolean;                 // true = no glyphs (or degraded)
  has_glyphs: boolean;         // best-effort model call answer
  detected_text: string | null;
  confidence: number;          // 0..1
  degraded: boolean;           // true = guard could not run cleanly
  reason: string;
}

export interface HeroVerdict {
  ok: boolean;                 // true = matches or degraded
  matches: boolean;
  detected_subjects: string[];
  forbidden_hit: string | null;
  degraded: boolean;
  reason: string;
  // AMENDMENT coloring_rulebook_v1 (2026-07-19): presence+prominence grading.
  // Populated when the amended verifier ran; null on degraded/legacy paths.
  presence?: {
    foreground_category_count: number;
    prominent_category_count: number;
    total_category_count: number;
    child_present: boolean;
  } | null;
}

const VISION_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GATEWAY_VISION_MODELS = ["google/gemini-3-flash-preview", "google/gemini-3.1-flash-lite"];

function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function mimeFromBytes(bytes: Uint8Array): string {
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return "image/jpeg";
  if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47) return "image/png";
  return "image/png";
}

async function geminiVisionJson<T>(
  bytes: Uint8Array,
  prompt: string,
  timeoutMs = 15_000,
): Promise<T | null> {
  if (!GEMINI_KEY || GEMINI_KEY.length < 10) return null;
  if (!bytes || bytes.length < 1024) return null;
  const deadline = Date.now() + timeoutMs;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mimeFromBytes(bytes), data: b64FromBytes(bytes) } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  let r: Response | null = null;
  let lastErr = "";
  for (const model of VISION_MODELS) {
    const remaining = Math.max(1, deadline - Date.now());
    if (remaining <= 50) throw new Error(`vision_timeout_${timeoutMs}ms`);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(`vision_timeout_${timeoutMs}ms`), remaining);
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal },
    ).finally(() => clearTimeout(timer));
    if (r.ok) break;
    lastErr = `vision ${model} ${r.status}: ${(await r.text()).slice(0, 180)}`;
    r = null;
  }
  if (!r) throw new Error(lastErr || "vision_models_unavailable");
  const j = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some responses wrap in ```json fences — strip and retry.
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try { return JSON.parse(stripped) as T; } catch { return null; }
  }
}

async function gatewayVisionJson<T>(
  bytes: Uint8Array,
  prompt: string,
  timeoutMs = 15_000,
): Promise<T | null> {
  if (!LOVABLE_API_KEY || LOVABLE_API_KEY.length < 10) return null;
  if (!bytes || bytes.length < 1024) return null;
  const dataUrl = `data:${mimeFromBytes(bytes)};base64,${b64FromBytes(bytes)}`;
  let lastErr = "";
  for (const model of GATEWAY_VISION_MODELS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(`gateway_vision_timeout_${timeoutMs}ms`), timeoutMs);
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
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
          response_format: { type: "json_object" },
        }),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = `${model}:fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}`;
      continue;
    }
    clearTimeout(timer);
    if (!r.ok) {
      lastErr = `${model}:http_${r.status}:${(await r.text()).slice(0, 180)}`;
      continue;
    }
    const j = await r.json().catch(() => null) as any;
    const text = j?.choices?.[0]?.message?.content ?? "";
    if (!text) { lastErr = `${model}:empty_content`; continue; }
    try { return JSON.parse(text) as T; }
    catch {
      const stripped = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try { return JSON.parse(stripped) as T; }
      catch { lastErr = `${model}:json_parse_fail`; }
    }
  }
  throw new Error(lastErr || "gateway_vision_models_unavailable");
}

async function visionJson<T>(bytes: Uint8Array, prompt: string, timeoutMs: number): Promise<T | null> {
  try {
    const viaGateway = await gatewayVisionJson<T>(bytes, prompt, timeoutMs);
    if (viaGateway) return viaGateway;
  } catch (e) {
    console.warn(`[cover-vision] gateway vision failed: ${(e as Error).message}`);
  }
  return await geminiVisionJson<T>(bytes, prompt, timeoutMs);
}

/**
 * Read the cover raster and detect ANY letters/words/numbers/typography.
 * Any glyph = ladder rung failure (art must be textless — typography is
 * added as a separate SVG layer downstream).
 */
export async function transcribeGlyphs(bytes: Uint8Array, timeoutMs = 15_000): Promise<GlyphVerdict> {
  const prompt = [
    "You are a strict OCR verifier for a children's book cover.",
    "Output STRICT JSON: {\"has_glyphs\": boolean, \"detected_text\": string, \"confidence\": number}.",
    "has_glyphs=true if the image contains ANY letters, words, numbers, captions,",
    "signage, book titles, subtitles, badges with text, watermarks, logos with letters,",
    "handwriting, typography, or calligraphy. Even a single legible character counts.",
    "Ignore purely decorative marks that are NOT recognizable letters or digits.",
    "detected_text = verbatim transcription of EVERY visible glyph, including repeated titles, badges, logos, footers, watermarks, and stray partial words (or empty string if none). Separate distinct text clusters with |.",
    "confidence = 0..1 of the has_glyphs judgment.",
  ].join(" ");
  try {
    const j = await visionJson<{ has_glyphs: boolean; detected_text: string; confidence: number }>(bytes, prompt, timeoutMs);
    if (!j) {
      return { ok: true, has_glyphs: false, detected_text: null, confidence: 0, degraded: true, reason: "no_gemini_key_or_empty_response" };
    }
    const has = !!j.has_glyphs;
    return {
      ok: !has,
      has_glyphs: has,
      detected_text: (j.detected_text ?? "").slice(0, 400),
      confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)),
      degraded: false,
      reason: has ? `baked_text:${(j.detected_text ?? "").slice(0, 80)}` : "textless",
    };
  } catch (e) {
    return { ok: true, has_glyphs: false, detected_text: null, confidence: 0, degraded: true, reason: `guard_error:${(e as Error).message.slice(0, 120)}` };
  }
}

/**
 * AMENDMENT coloring_rulebook_v1 (2026-07-19): the cover-hero check
 * grades PRESENCE and DOMINANCE of category subjects, not exclusion of
 * humans. A human child alongside prominent sea animals PASSES; a
 * child-only cover on a Sea Animals book FAILS.
 *
 * Pass rule (see category-presence-grader): at least one category
 * subject is truly foregrounded AND the total prominent (foreground +
 * midground) count of category subjects is ≥ 2 (or the foregrounded
 * count alone is ≥ 2). Humans are neutral — never a defect on their
 * own, never counted toward the category quota.
 *
 * Degraded (transport/parse failure) = fail-safe true.
 */
function buildPresencePrompt(opts: {
  category_name: string;
  allowed_subjects: string[];
  forbidden_subjects: string[];
}): string {
  return [
    "You are a subject classifier for a children's coloring-book cover.",
    `The book's category is: "${opts.category_name}".`,
    `On-category subjects for this book are: ${JSON.stringify(opts.allowed_subjects)}.`,
    opts.forbidden_subjects.length ? `Forbidden (do not treat as category matches): ${JSON.stringify(opts.forbidden_subjects)}.` : "",
    "Human children (kids, babies, toddlers) are ALLOWED as appeal companions on the cover — they are NEVER a defect. They just do not count toward the category subject quota.",
    "Enumerate EVERY visible primary subject in the composition (up to 8). For each, return: name (concrete noun phrase, e.g. 'orange clownfish', 'sea turtle', 'human girl'); prominence (one of \"foreground\", \"midground\", \"background\"); is_human_child (true iff a human aged ~0-12); category_match (true iff the subject is semantically covered by the on-category list — humans are NOT category matches unless the category itself is people).",
    "Also return forbidden_hit: a CONCRETE creature/object you literally see that clearly belongs to the forbidden list, or null. Never echo an abstract category label ('exotic species', 'modern city') — return null unless you can name the specific offending thing.",
    "Output STRICT JSON: {\"subjects\":[{\"name\":string,\"prominence\":\"foreground\"|\"midground\"|\"background\",\"is_human_child\":boolean,\"category_match\":boolean}],\"forbidden_hit\":string|null}.",
  ].filter(Boolean).join(" ");
}

interface PresenceResponse {
  subjects?: Array<{ name?: string; prominence?: string; is_human_child?: boolean; category_match?: boolean }>;
  forbidden_hit?: string | null;
}

function normalizePresence(
  raw: PresenceResponse | null,
  forbidden: string[],
  categoryName: string,
): {
  detected_subjects: string[];
  forbidden_hit: string | null;
  verdict: ReturnType<typeof gradeCategoryPresence>;
} {
  const subjectsIn: DetectedSubject[] = Array.isArray(raw?.subjects) ? raw!.subjects!.slice(0, 8).map((s) => ({
    name: String(s?.name ?? "").slice(0, 60),
    prominence: (s?.prominence === "foreground" || s?.prominence === "midground" || s?.prominence === "background") ? s.prominence : "background",
    is_human_child: !!s?.is_human_child,
    category_match: !!s?.category_match,
  })) : [];
  const detected_subjects = subjectsIn.map((s) => s.name).filter(Boolean).slice(0, 6);
  const rawHit = String(raw?.forbidden_hit ?? "").trim();
  const isAbstractHit = rawHit.length > 0 && forbidden.some((f) => f.trim().toLowerCase() === rawHit.toLowerCase());
  const forbidden_hit = rawHit.length > 0 && !isAbstractHit ? rawHit : null;
  const verdict = gradeCategoryPresence({ detected: subjectsIn, category_name: categoryName });
  return { detected_subjects, forbidden_hit, verdict };
}

export async function verifyCategoryHero(
  bytes: Uint8Array,
  opts: {
    category_name: string;
    allowed_subjects: string[];
    forbidden_subjects?: string[];
  },
  timeoutMs = 15_000,
): Promise<HeroVerdict> {
  const allowed = (opts.allowed_subjects ?? []).filter(Boolean);
  const forbidden = (opts.forbidden_subjects ?? []).filter(Boolean);
  if (allowed.length === 0) {
    return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_allowed_subjects_defined", presence: null };
  }
  const prompt = buildPresencePrompt({ category_name: opts.category_name, allowed_subjects: allowed, forbidden_subjects: forbidden });
  try {
    const j = await visionJson<PresenceResponse>(bytes, prompt, timeoutMs);
    if (!j) {
      return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_gemini_key_or_empty_response", presence: null };
    }
    const { detected_subjects, forbidden_hit, verdict } = normalizePresence(j, forbidden, opts.category_name);
    return {
      ok: verdict.ok,
      matches: verdict.ok,
      detected_subjects,
      forbidden_hit,
      degraded: false,
      reason: verdict.ok
        ? `${verdict.reason}${forbidden_hit ? `;non_blocking_forbidden=${forbidden_hit}` : ""}`
        : (forbidden_hit ? `forbidden_hit:${forbidden_hit};${verdict.reason}` : verdict.reason),
      presence: {
        foreground_category_count: verdict.foreground_category_count,
        prominent_category_count: verdict.prominent_category_count,
        total_category_count: verdict.total_category_count,
        child_present: verdict.child_present,
      },
    };
  } catch (e) {
    return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: `guard_error:${(e as Error).message.slice(0, 120)}`, presence: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// URL-based variants (OOM defense: cover-function-worker-oom-v1 split).
// Pass an https-reachable signed URL directly to the gateway vision model
// instead of base64-encoding a 2MB PNG into the request body. Removes
// ~2-6MB of held base64 per vision call in the verify half of the split.
// Gateway/OpenRouter fetches the URL server-side. Gemini direct needs
// inlineData so we don't fall back to it here — verify handles gateway
// failure by requeueing under the ceiling.
// ═══════════════════════════════════════════════════════════════════════

async function gatewayVisionJsonByUrl<T>(url: string, prompt: string, timeoutMs = 15_000): Promise<T | null> {
  if (!LOVABLE_API_KEY || LOVABLE_API_KEY.length < 10) return null;
  if (!url || !/^https?:\/\//.test(url)) return null;
  let lastErr = "";
  for (const model of GATEWAY_VISION_MODELS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(`gateway_vision_url_timeout_${timeoutMs}ms`), timeoutMs);
    let r: Response;
    try {
      r = await fetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url } },
          ]}],
          response_format: { type: "json_object" },
        }),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = `${model}:fetch_error:${String((e as Error)?.message ?? e).slice(0, 120)}`;
      continue;
    }
    clearTimeout(timer);
    if (!r.ok) { lastErr = `${model}:http_${r.status}:${(await r.text()).slice(0, 180)}`; continue; }
    const j = await r.json().catch(() => null) as any;
    const text = j?.choices?.[0]?.message?.content ?? "";
    if (!text) { lastErr = `${model}:empty_content`; continue; }
    try { return JSON.parse(text) as T; }
    catch {
      const stripped = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try { return JSON.parse(stripped) as T; } catch { lastErr = `${model}:json_parse_fail`; }
    }
  }
  throw new Error(lastErr || "gateway_vision_url_unavailable");
}

export async function transcribeGlyphsByUrl(url: string, timeoutMs = 15_000): Promise<GlyphVerdict> {
  const prompt = [
    "You are a strict OCR verifier for a children's book cover.",
    "Output STRICT JSON: {\"has_glyphs\": boolean, \"detected_text\": string, \"confidence\": number}.",
    "has_glyphs=true if the image contains ANY letters, words, numbers, captions, badges, watermarks, logos with letters, handwriting, or typography.",
    "detected_text = verbatim transcription of EVERY visible glyph, distinct clusters separated by |.",
    "confidence = 0..1.",
  ].join(" ");
  try {
    const j = await gatewayVisionJsonByUrl<{ has_glyphs: boolean; detected_text: string; confidence: number }>(url, prompt, timeoutMs);
    if (!j) return { ok: true, has_glyphs: false, detected_text: null, confidence: 0, degraded: true, reason: "gateway_unavailable_url_variant" };
    const has = !!j.has_glyphs;
    return { ok: !has, has_glyphs: has, detected_text: (j.detected_text ?? "").slice(0, 400), confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)), degraded: false, reason: has ? `baked_text:${(j.detected_text ?? "").slice(0, 80)}` : "textless" };
  } catch (e) {
    return { ok: true, has_glyphs: false, detected_text: null, confidence: 0, degraded: true, reason: `guard_error:${(e as Error).message.slice(0, 120)}` };
  }
}

export async function verifyCategoryHeroByUrl(
  url: string,
  opts: { category_name: string; allowed_subjects: string[]; forbidden_subjects?: string[]; },
  timeoutMs = 15_000,
): Promise<HeroVerdict> {
  const allowed = (opts.allowed_subjects ?? []).filter(Boolean);
  const forbidden = (opts.forbidden_subjects ?? []).filter(Boolean);
  if (allowed.length === 0) return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_allowed_subjects_defined" };
  const prompt = [
    "You are a subject classifier for a children's coloring-book cover.",
    `Category: "${opts.category_name}".`,
    `Hero MUST be one of: ${JSON.stringify(allowed)}.`,
    forbidden.length ? `MUST NOT show any of: ${JSON.stringify(forbidden)}.` : "",
    "Output STRICT JSON: {\"detected_subjects\": string[], \"matches_allowed\": boolean, \"forbidden_hit\": string|null, \"reason\": string}.",
    "forbidden_hit = CONCRETE creature/object name only, or null.",
  ].filter(Boolean).join(" ");
  try {
    const j = await gatewayVisionJsonByUrl<{ detected_subjects: string[]; matches_allowed: boolean; forbidden_hit: string | null; reason: string }>(url, prompt, timeoutMs);
    if (!j) return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "gateway_unavailable_url_variant" };
    const detected = Array.isArray(j.detected_subjects) ? j.detected_subjects.slice(0, 6) : [];
    const rawHit = (j.forbidden_hit ?? "").trim();
    const isAbstractHit = rawHit.length > 0 && forbidden.some((f) => f.trim().toLowerCase() === rawHit.toLowerCase());
    const concreteHit = rawHit.length > 0 && !isAbstractHit ? rawHit : null;
    const matches = !!j.matches_allowed;
    return { ok: matches, matches, detected_subjects: detected, forbidden_hit: concreteHit, degraded: false, reason: matches ? `hero_ok:${detected.join("|").slice(0, 80)}` : (concreteHit ? `forbidden_hit:${concreteHit}` : `wrong_subject:detected=${detected.join("|").slice(0, 80)}`) };
  } catch (e) {
    return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: `guard_error:${(e as Error).message.slice(0, 120)}` };
  }
}
