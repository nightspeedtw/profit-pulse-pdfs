// Verified-typography guard for OWNER LAW
// `coloring_cover_verified_typography_v2`.
//
// After Tier-1 (Ideogram) produces an image with baked-in title/subtitle/age
// badge, this module OCRs the raster with Gemini Vision and asserts the
// detected text matches EXACTLY the three approved strings. Any extra word,
// missing word, or misspelled word ⇒ discard. This is what prevents the
// "beautiful but wrong text" failure mode.
//
// Fails safe: on transport/parse error, verdict is `{pass:false, degraded:true}`
// so the caller can retry (or fall to Tier 2). We NEVER return pass=true when
// we could not actually verify — that would allow unverified AI text to ship,
// which is what the owner explicitly forbade.

// @ts-nocheck  Deno edge runtime

const DENO_ENV = (globalThis as any)?.Deno?.env;
const GEMINI_KEY = DENO_ENV?.get?.("GEMINI_API_KEY");
const LOVABLE_API_KEY = DENO_ENV?.get?.("LOVABLE_API_KEY");
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface CoverTextExpectations {
  title: string;
  subtitle: string;
  ageBadge: string;
}

export interface CoverTextVerdict {
  pass: boolean;
  degraded: boolean;
  reason: string;
  transcribed_raw: string;
  transcribed_tokens: string[];
  approved_tokens: string[];
  /** Subset that MUST render (derived from title). */
  required_tokens: string[];
  /** Subset that is nice-to-have (subtitle/badge) — missing → warning, not fail. */
  optional_tokens: string[];
  missing: string[];
  missing_required: string[];
  missing_optional: string[];
  extra: string[];
  misspelled: string[];
  /** Number of distinct age-badge occurrences ("Ages 4-6") in the raw text.
   *  >1 means the model baked one AND we overlaid one — duplicate defect. */
  age_badge_count: number;
  duplicate_age_badge: boolean;
  attempted_at: string;
}

// -------- Normalization --------

/**
 * Collapse a string into comparable word tokens: lowercase, strip punctuation,
 * collapse whitespace, drop pure-symbol tokens. "Ages 4-6" → ["ages","4","6"].
 */
export function tokenize(s: string): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// Very small ignore set — approved chrome that may appear even in Tier-1 art
// via the SecretPDF Kids logo footer if the model bakes it in.
const CHROME_TOKENS = new Set(["secretpdf", "kids", "the", "a", "an"]);

// OWNER LAW `cover_no_age_badge_v7` (2026-07-21):
//   V2 covers no longer bake an "Ages X-Y" mark — the age is shown on the
//   storefront chip/product page instead. Any baked chip/ribbon/banner word
//   (including "ages"/"age") is now a hard reject. Callers that still want
//   to permit an age mark must pass a non-empty expectations.ageBadge, in
//   which case tokenize() will place the age tokens in the optional set and
//   they'll be exempt from this ban.
const HARD_BANNED_COVER_TOKENS = new Set([
  "sale", "new", "free", "best", "bonus", "hot", "top", "premium", "off",
  "coloring", "book", "books",
  "page", "pages", "chapter", "vol", "volume",
  "look", "inside", "preview", "sample",
  "publisher", "publishing", "presents", "author", "by",
  "ages", "age",
]);

/**
 * Compare approved vs detected token bags. `misspelled` catches near-matches
 * (edit distance ≤ 1 on ≥4-char tokens) which are still failures — Ideogram
 * commonly drops a letter.
 */
export function diffTokens(
  approved: string[],
  detected: string[],
): { missing: string[]; extra: string[]; misspelled: string[] } {
  const approvedSet = new Set(approved);
  const detectedSet = new Set(detected);
  const missing: string[] = [];
  const extra: string[] = [];
  const misspelled: string[] = [];

  for (const a of approved) {
    if (detectedSet.has(a)) continue;
    // near-match? edit distance ≤ 1 for tokens ≥4, ≤ 2 for tokens ≥6
    // (catches Ideogram's common transposition typos like friends→freinds).
    let near: string | null = null;
    if (a.length >= 4) {
      const maxDist = a.length >= 6 ? 2 : 1;
      for (const d of detected) {
        if (Math.abs(d.length - a.length) > maxDist) continue;
        if (levenshtein(a, d) <= maxDist && !approvedSet.has(d)) { near = d; break; }
      }
    }
    if (near) misspelled.push(`${a}→${near}`);
    else missing.push(a);
  }
  for (const d of detected) {
    if (approvedSet.has(d)) continue;
    if (CHROME_TOKENS.has(d)) continue;
    // If this token was flagged as a misspelling of an approved one, skip it
    // (already counted). Otherwise it's an extra hallucinated word.
    if (misspelled.some((m) => m.endsWith(`→${d}`))) continue;
    extra.push(d);
  }
  return { missing, extra, misspelled };
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

// -------- Whole-cover extras: duplicate age-badge detection --------

/**
 * Owner order (external-audit finding #1): whole-cover OCR must reject
 * covers that show a duplicate "Ages X-Y" badge — this happens when
 * Ideogram bakes one AND our overlay adds a second one, OR when Ideogram
 * itself paints two badges. Count distinct age-range strings in the raw
 * OCR output (case-insensitive, tolerant of "Ages 4-6" / "Ages 4 to 6" /
 * "AGES 4—6"). Also count standalone "Ages" occurrences as a fallback.
 */
export function countAgeBadges(raw: string): number {
  if (!raw) return 0;
  const s = raw.toLowerCase().normalize("NFKD");
  // matches "ages 4-6", "ages 4 – 6", "ages 4 to 6", "ages 13-17"
  const range = /\bages?\s*\d{1,2}\s*(?:-|–|—|to)\s*\d{1,2}\b/g;
  const rangeHits = (s.match(range) ?? []).length;
  if (rangeHits > 0) return rangeHits;
  // fallback: bare "ages" word occurrences (still a duplicate if >1)
  const bare = /\bages?\b/g;
  return (s.match(bare) ?? []).length;
}

// -------- Vision transcription --------


function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function mimeFromBytes(bytes: Uint8Array): string {
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return "image/jpeg";
  if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47) return "image/png";
  return "image/png";
}

const TRANSCRIPTION_PROMPT = [
  "You are a strict OCR transcriber for a children's book cover.",
  "Read ALL visible text on the cover — title, subtitle, badges, captions, logos, watermarks, page numbers, taglines, publisher names.",
  "Transcribe VERBATIM. Do not correct spelling. Do not add words. Do not omit words.",
  "Preserve punctuation and numbers exactly as painted.",
  "Output STRICT JSON: {\"detected_text\": string, \"clusters\": string[]}.",
  "detected_text = every glyph joined with ' | ' between distinct text regions.",
  "clusters = array of separate text regions in reading order (title, subtitle, badge, etc).",
].join(" ");

async function gatewayTranscribe(bytes: Uint8Array, timeoutMs: number): Promise<{ detected_text: string; clusters: string[] } | null> {
  if (!LOVABLE_API_KEY) return null;
  const dataUrl = `data:${mimeFromBytes(bytes)};base64,${b64FromBytes(bytes)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("gateway_transcribe_timeout"), timeoutMs);
  try {
    const r = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: TRANSCRIPTION_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        response_format: { type: "json_object" },
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const text = j?.choices?.[0]?.message?.content ?? "";
    if (!text) return null;
    try { return JSON.parse(text); }
    catch {
      const stripped = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try { return JSON.parse(stripped); } catch { return null; }
    }
  } catch {
    clearTimeout(timer);
    return null;
  }
}

const GEMINI_VISION_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
];

async function geminiTranscribe(bytes: Uint8Array, timeoutMs: number): Promise<{ detected_text: string; clusters: string[] } | null> {
  if (!GEMINI_KEY) return null;
  for (const model of GEMINI_VISION_MODELS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort("gemini_transcribe_timeout"), timeoutMs);
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: TRANSCRIPTION_PROMPT },
                { inlineData: { mimeType: mimeFromBytes(bytes), data: b64FromBytes(bytes) } },
              ],
            }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
          signal: ac.signal,
        },
      );
      clearTimeout(timer);
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        console.warn(`[cover-transcribe] gemini ${model} http_${r.status}: ${errBody.slice(0, 200)}`);
        continue;
      }
      const j = await r.json();
      const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
      if (!text) { console.warn(`[cover-transcribe] gemini ${model} empty response`); continue; }
      try { return JSON.parse(text); }
      catch {
        const stripped = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        try { return JSON.parse(stripped); } catch { console.warn(`[cover-transcribe] gemini ${model} non-JSON: ${text.slice(0, 200)}`); continue; }
      }
    } catch (e: any) {
      clearTimeout(timer);
      console.warn(`[cover-transcribe] gemini ${model} error: ${e?.message ?? e}`);
      continue;
    }
  }
  return null;
}

export async function verifyExactCoverText(
  bytes: Uint8Array,
  expectations: CoverTextExpectations,
  opts: { timeoutMs?: number; textlessMode?: boolean } = {},
): Promise<CoverTextVerdict> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const textlessMode = opts.textlessMode === true;

  // OWNER LAW `cover_bake_only_v6` (2026-07-21):
  //   Ideogram bakes the exact TITLE and a small "Ages X-Y" mark. Every
  //   other detected glyph (subtitle, blurb, chip, ribbon, publisher, page
  //   count) is FORBIDDEN — nothing else may be composited on top either.
  //   Duplicate age marks (>1) still fail.
  const titleTokens = Array.from(new Set(tokenize(expectations.title)));
  const ageTokens = Array.from(new Set(tokenize(expectations.ageBadge)));
  const requiredTokens = textlessMode ? [] : titleTokens;
  const optionalTokens = textlessMode ? [] : ageTokens.filter((t) => !titleTokens.includes(t));
  const requiredSet = new Set(requiredTokens);
  const optionalSet = new Set(optionalTokens);
  const dedupApproved = [...requiredTokens, ...optionalTokens];

  const attempted_at = new Date().toISOString();

  const transcribed = (await gatewayTranscribe(bytes, timeoutMs)) ?? (await geminiTranscribe(bytes, timeoutMs));
  if (!transcribed) {
    return {
      pass: false, degraded: true, reason: "transcriber_unavailable",
      transcribed_raw: "", transcribed_tokens: [], approved_tokens: dedupApproved,
      required_tokens: requiredTokens, optional_tokens: optionalTokens,
      missing: dedupApproved, missing_required: requiredTokens, missing_optional: optionalTokens,
      extra: [], misspelled: [], age_badge_count: 0, duplicate_age_badge: false, attempted_at,
    };
  }
  const raw = String(transcribed.detected_text ?? "");
  const detectedTokens = Array.from(new Set(tokenize(raw)));
  const { missing, extra, misspelled } = diffTokens(dedupApproved, detectedTokens);
  const missing_required = missing.filter((t) => requiredSet.has(t));
  const missing_optional = missing.filter((t) => optionalSet.has(t));
  const misspelled_required = misspelled.filter((m) => requiredSet.has(m.split("→")[0]));
  const age_badge_count = countAgeBadges(raw);
  const duplicate_age_badge = age_badge_count > 1;
  const hard_banned_hits = detectedTokens.filter((t) => HARD_BANNED_COVER_TOKENS.has(t) && !requiredSet.has(t) && !optionalSet.has(t));
  const pass = hard_banned_hits.length === 0 && (textlessMode
    ? (detectedTokens.length === 0 || detectedTokens.every((t) => CHROME_TOKENS.has(t)))
    : (missing_required.length === 0 && extra.length === 0 && misspelled.length === 0 && !duplicate_age_badge));
  const reason = pass
    ? "exact_match"
    : hard_banned_hits.length > 0
      ? `hard_banned_tokens:${hard_banned_hits.join(",")}`
      : textlessMode
        ? `textless_violation:detected=${detectedTokens.length}`
        : `mismatch:missing_required=${missing_required.length},extra=${extra.length},misspelled_required=${misspelled_required.length},duplicate_age=${duplicate_age_badge}`;
  return {
    pass, degraded: false, reason,
    transcribed_raw: raw, transcribed_tokens: detectedTokens, approved_tokens: dedupApproved,
    required_tokens: requiredTokens, optional_tokens: optionalTokens,
    missing, missing_required, missing_optional, extra, misspelled,
    age_badge_count, duplicate_age_badge, attempted_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// URL variant (OOM defense: cover split). Passes signed URL directly to
// the gateway transcriber; no base64 body allocation. Gateway/OpenRouter
// fetches the image server-side.
// ═══════════════════════════════════════════════════════════════════════
async function gatewayTranscribeByUrl(url: string, timeoutMs: number): Promise<{ detected_text: string; clusters: string[] } | null> {
  if (!LOVABLE_API_KEY) return null;
  if (!url || !/^https?:\/\//.test(url)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("gateway_transcribe_url_timeout"), timeoutMs);
  try {
    const r = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: [
          { type: "text", text: TRANSCRIPTION_PROMPT },
          { type: "image_url", image_url: { url } },
        ]}],
        response_format: { type: "json_object" },
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const text = j?.choices?.[0]?.message?.content ?? "";
    if (!text) return null;
    try { return JSON.parse(text); }
    catch {
      const stripped = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try { return JSON.parse(stripped); } catch { return null; }
    }
  } catch { clearTimeout(timer); return null; }
}

export async function verifyExactCoverTextByUrl(
  url: string,
  expectations: CoverTextExpectations,
  opts: { timeoutMs?: number } = {},
): Promise<CoverTextVerdict> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const requiredTokens = Array.from(new Set(tokenize(expectations.title)));
  const optionalTokensRaw = [...tokenize(expectations.subtitle), ...tokenize(expectations.ageBadge)];
  const requiredSet = new Set(requiredTokens);
  const optionalTokens = Array.from(new Set(optionalTokensRaw.filter((t) => !requiredSet.has(t))));
  const dedupApproved = [...requiredTokens, ...optionalTokens];
  const attempted_at = new Date().toISOString();
  const transcribed = await gatewayTranscribeByUrl(url, timeoutMs);
  if (!transcribed) {
    return { pass: false, degraded: true, reason: "transcriber_unavailable_url_variant", transcribed_raw: "", transcribed_tokens: [], approved_tokens: dedupApproved, required_tokens: requiredTokens, optional_tokens: optionalTokens, missing: dedupApproved, missing_required: requiredTokens, missing_optional: optionalTokens, extra: [], misspelled: [], age_badge_count: 0, duplicate_age_badge: false, attempted_at };
  }
  const raw = String(transcribed.detected_text ?? "");
  const detectedTokens = Array.from(new Set(tokenize(raw)));
  const { missing, extra, misspelled } = diffTokens(dedupApproved, detectedTokens);
  const missing_required = missing.filter((t) => requiredSet.has(t));
  const missing_optional = missing.filter((t) => !requiredSet.has(t));
  const misspelled_required = misspelled.filter((m) => requiredSet.has(m.split("→")[0]));
  const age_badge_count = countAgeBadges(raw);
  const duplicate_age_badge = age_badge_count > 1;
  const hard_banned_hits = detectedTokens.filter((t) => HARD_BANNED_COVER_TOKENS.has(t) && !requiredSet.has(t) && !optionalTokens.includes(t));
  const pass = hard_banned_hits.length === 0
    && missing_required.length === 0
    && extra.length === 0
    && misspelled_required.length === 0
    && misspelled.length === 0
    && !duplicate_age_badge;
  const reason = pass
    ? "exact_match"
    : hard_banned_hits.length > 0
      ? `hard_banned_tokens:${hard_banned_hits.join(",")}`
      : `mismatch:missing_required=${missing_required.length},extra=${extra.length},misspelled=${misspelled.length},dup_age_badge=${duplicate_age_badge}`;
  return { pass, degraded: false, reason, transcribed_raw: raw, transcribed_tokens: detectedTokens, approved_tokens: dedupApproved, required_tokens: requiredTokens, optional_tokens: optionalTokens, missing, missing_required, missing_optional, extra, misspelled, age_badge_count, duplicate_age_badge, attempted_at };
}
