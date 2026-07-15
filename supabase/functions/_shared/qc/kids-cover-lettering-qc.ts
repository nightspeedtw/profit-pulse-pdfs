// Vision-QC for kids-cover HAND-LETTERED TITLE mode.
//
// The AI illustration is expected to render the book title AS hand-lettered
// artwork integrated into the scene. This QC calls a vision model and asks it
// to (a) transcribe every piece of text visible in the image and (b) score
// whether the lettering looks stylized/integrated (not a plain font stamp)
// and whether it will survive the 100x160 thumbnail test.
//
// If the transcribed text does not contain the exact expected title
// (case-insensitive, ignoring punctuation), the cover FAILS and the pipeline
// regenerates. After N failed attempts the caller falls back to compositing
// a styled SVG text overlay — we never ship a misspelled cover.

import { verifyTitleFuzzy, TITLE_SIMILARITY_THRESHOLD } from "../covers/title-mastery.ts";
import { parseModelJson } from "../model-json.ts";


export interface CoverLetteringQcResult {
  passed: boolean;
  score: number;                 // 0-100 overall
  title_present: boolean;
  title_spelled_correctly: boolean;
  lettering_stylized: boolean;
  thumbnail_readable: boolean;
  detected_title_text: string;
  similarity: number;            // 0..1 Levenshtein similarity vs expected
  threshold: number;
  reasons: string[];
  raw?: unknown;
}

export async function qcCoverLettering(input: {
  expectedTitle: string;
  imageBytes: Uint8Array;
}): Promise<CoverLetteringQcResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return {
      passed: false, score: 0,
      title_present: false, title_spelled_correctly: false,
      lettering_stylized: false, thumbnail_readable: false,
      detected_title_text: "",
      similarity: 0, threshold: TITLE_SIMILARITY_THRESHOLD,
      reasons: ["missing_lovable_api_key"],
    };
  }
  // base64 the image for image_url data URL
  let b64 = ""; const c = 0x8000;
  for (let i = 0; i < input.imageBytes.length; i += c) {
    b64 += String.fromCharCode(...input.imageBytes.subarray(i, i + c));
  }
  const dataUrl = `data:image/png;base64,${btoa(b64)}`;

  const system = `You are a strict cover QC reviewer for children's picture book covers. You will be shown ONE cover image. Look at any text/lettering that appears ON the cover and answer in JSON only.

Return exactly this shape:
{
  "detected_title_text": "<verbatim, glyph-by-glyph, whatever letters/words you can read as the main title>",
  "title_spelled_correctly": true|false,
  "lettering_stylized": true|false,
  "thumbnail_readable": true|false,
  "score": 0-100,
  "notes": "short reason"
}

Rules for the fields:
- detected_title_text: transcribe the main hand-lettered / display title exactly as it appears — do NOT auto-correct spelling. If a letter is mangled or missing, transcribe what is actually drawn.
- title_spelled_correctly: does the main title read EXACTLY as the expected title provided by the user (case-insensitive), with no missing/duplicated/mangled letters?
- lettering_stylized: is the title drawn as hand-lettered/painted/chunky artwork integrated into the illustration (true) — OR is it a plain generic system font stamped on top / thin geometric type / a rigid straight line of type (false)?
- thumbnail_readable: at 100x160px would the title still be legible against its background? Consider outline/shadow/banner armor and contrast.
- score: 0-100 overall commercial-quality gate.`;

  const user = `EXPECTED TITLE: "${input.expectedTitle}"

Grade the cover image below.`;

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: system + "\nRespond with valid JSON only. No markdown fences." },
      { role: "user", content: [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: dataUrl } },
      ] },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
  };

  let parsed: {
    detected_title_text?: string;
    title_spelled_correctly?: boolean;
    lettering_stylized?: boolean;
    thumbnail_readable?: boolean;
    score?: number;
    notes?: string;
  } = {};
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`vision qc ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    const text: string = j.choices?.[0]?.message?.content ?? "{}";
    const parseResult = parseModelJson<Record<string, unknown>>(text);
    if (!parseResult.ok) throw new Error(`cover_lettering_vision_bad_json: ${parseResult.diagnostics.errors.slice(-1)[0] ?? "unknown"}`);
    parsed = parseResult.value;
  } catch (e) {
    return {
      passed: false, score: 0,
      title_present: false, title_spelled_correctly: false,
      lettering_stylized: false, thumbnail_readable: false,
      detected_title_text: "",
      similarity: 0, threshold: TITLE_SIMILARITY_THRESHOLD,
      reasons: [`vision_qc_failed:${(e as Error).message.slice(0, 120)}`],
    };
  }

  const detected = String(parsed.detected_title_text ?? "").trim();
  // Fuzzy verification (Levenshtein similarity ≥ threshold) — tolerates 1-2
  // glyph artifacts on long titles while catching real misspellings.
  const fuzzy = verifyTitleFuzzy(input.expectedTitle, detected);
  const spelledOk = fuzzy.pass;
  const stylized = parsed.lettering_stylized === true;
  const thumbOk = parsed.thumbnail_readable === true;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));

  // ALWAYS log expected vs transcribed so we learn which route wins.
  console.log(`[cover-title-qc] expected="${input.expectedTitle}" transcribed="${detected}" similarity=${fuzzy.similarity} pass=${spelledOk}`);

  const reasons: string[] = [];
  if (!detected) reasons.push("title_not_detected");
  if (!spelledOk) reasons.push(`title_misspelled(similarity=${fuzzy.similarity} < ${fuzzy.threshold}, detected="${detected.slice(0, 60)}")`);
  if (!stylized) reasons.push("lettering_not_stylized");
  if (!thumbOk) reasons.push("thumbnail_unreadable");

  const passed = spelledOk && stylized && thumbOk && score >= 82;

  return {
    passed,
    score,
    title_present: !!detected,
    title_spelled_correctly: spelledOk,
    lettering_stylized: stylized,
    thumbnail_readable: thumbOk,
    detected_title_text: detected,
    similarity: fuzzy.similarity,
    threshold: fuzzy.threshold,
    reasons,
    raw: parsed,
  };
}
