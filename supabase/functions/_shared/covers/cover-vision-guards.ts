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

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");

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
}

const VISION_MODEL = "gemini-2.5-flash";

function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function geminiVisionJson<T>(
  bytes: Uint8Array,
  prompt: string,
): Promise<T | null> {
  if (!GEMINI_KEY || GEMINI_KEY.length < 10) return null;
  if (!bytes || bytes.length < 1024) return null;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: "image/png", data: b64FromBytes(bytes) } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error(`vision ${r.status}`);
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

/**
 * Read the cover raster and detect ANY letters/words/numbers/typography.
 * Any glyph = ladder rung failure (art must be textless — typography is
 * added as a separate SVG layer downstream).
 */
export async function transcribeGlyphs(bytes: Uint8Array): Promise<GlyphVerdict> {
  const prompt = [
    "You are a strict OCR verifier for a children's book cover.",
    "Output STRICT JSON: {\"has_glyphs\": boolean, \"detected_text\": string, \"confidence\": number}.",
    "has_glyphs=true if the image contains ANY letters, words, numbers, captions,",
    "signage, book titles, subtitles, badges with text, watermarks, logos with letters,",
    "handwriting, typography, or calligraphy. Even a single legible character counts.",
    "Ignore purely decorative marks that are NOT recognizable letters or digits.",
    "detected_text = verbatim transcription (or empty string if none).",
    "confidence = 0..1 of the has_glyphs judgment.",
  ].join(" ");
  try {
    const j = await geminiVisionJson<{ has_glyphs: boolean; detected_text: string; confidence: number }>(bytes, prompt);
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
 * Verify the cover hero matches the category's allowed subjects. A "Sea
 * Animals" cover showing a human girl fails. Degraded = fail-safe true.
 */
export async function verifyCategoryHero(
  bytes: Uint8Array,
  opts: {
    category_name: string;
    allowed_subjects: string[];
    forbidden_subjects?: string[];
  },
): Promise<HeroVerdict> {
  const allowed = (opts.allowed_subjects ?? []).filter(Boolean);
  const forbidden = (opts.forbidden_subjects ?? []).filter(Boolean);
  if (allowed.length === 0) {
    return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_allowed_subjects_defined" };
  }
  const prompt = [
    "You are a subject classifier for a children's coloring-book cover.",
    `The book's category is: "${opts.category_name}".`,
    `The cover hero MUST be one of these subjects: ${JSON.stringify(allowed)}.`,
    forbidden.length ? `The cover MUST NOT show any of: ${JSON.stringify(forbidden)}.` : "",
    "Output STRICT JSON: {\"detected_subjects\": string[], \"matches_allowed\": boolean, \"forbidden_hit\": string|null, \"reason\": string}.",
    "detected_subjects = short noun phrases for the primary characters/subjects you actually see (max 6).",
    "matches_allowed = true if at least one detected subject is semantically covered by the allowed list.",
    "forbidden_hit = the first forbidden subject you actually see, or null.",
  ].filter(Boolean).join(" ");
  try {
    const j = await geminiVisionJson<{ detected_subjects: string[]; matches_allowed: boolean; forbidden_hit: string | null; reason: string }>(bytes, prompt);
    if (!j) {
      return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: "no_gemini_key_or_empty_response" };
    }
    const matches = !!j.matches_allowed && !j.forbidden_hit;
    return {
      ok: matches,
      matches,
      detected_subjects: Array.isArray(j.detected_subjects) ? j.detected_subjects.slice(0, 6) : [],
      forbidden_hit: j.forbidden_hit ?? null,
      degraded: false,
      reason: matches
        ? `hero_ok:${(j.detected_subjects ?? []).join("|").slice(0, 80)}`
        : (j.forbidden_hit
            ? `forbidden_hit:${j.forbidden_hit}`
            : `wrong_subject:detected=${(j.detected_subjects ?? []).join("|").slice(0, 80)}`),
    };
  } catch (e) {
    return { ok: true, matches: true, detected_subjects: [], forbidden_hit: null, degraded: true, reason: `guard_error:${(e as Error).message.slice(0, 120)}` };
  }
}
