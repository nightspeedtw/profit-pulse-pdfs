// AI-critic QC for the photoreal book thumbnail.
// Uses Gemini 2.5 Pro (vision) via Lovable AI Gateway to score 10 axes.

import { parseModelJson } from "./model-json.ts";
import "./gateway-guard.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface PhotorealQc {
  passed: boolean;
  scores: Record<string, number>;
  reasons: string[];
  repair_hints: string[]; // keys usable by REPAIR_HINTS in photoreal-mockup.ts
}

const THRESHOLDS: Record<string, number> = {
  reference_grade_realism_score: 92,
  book_size_score: 90,
  white_bg_product_photo_score: 95,
  cover_typography_score: 90,
  title_baked_in_score: 95,
  topic_illustration_score: 85,
  spine_page_depth_score: 90,
  shadow_lighting_score: 90,
  store_click_appeal_score: 90,
  text_integrity_score: 92,
  book_geometry_score: 88,
  final_store_thumbnail_score: 92,
};

export async function qcPhotorealThumbnail(
  imgBytes: Uint8Array,
  expectedTitle: string,
): Promise<PhotorealQc> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const b64 = base64Encode(imgBytes);

  const rubric = `You are a strict ecommerce art director judging a book product thumbnail.
Return ONLY JSON matching this schema (no prose):
{
  "reference_grade_realism_score": 0-100,
  "book_size_score": 0-100,
  "white_bg_product_photo_score": 0-100,
  "cover_typography_score": 0-100,
  "title_baked_in_score": 0-100,
  "topic_illustration_score": 0-100,
  "spine_page_depth_score": 0-100,
  "shadow_lighting_score": 0-100,
  "store_click_appeal_score": 0-100,
  "text_integrity_score": 0-100,
  "book_geometry_score": 0-100,
  "final_store_thumbnail_score": 0-100,
  "reasons": [ "..." ],
  "detected_title": "the exact title text you can read on the cover",
  "repair_hints": [ "too_small" | "dark_bg" | "distorted_text" | "flat" | "no_shadow" | "distorted_geometry" | "clipped_text" ]
}
Rules:
- Expected title on the cover: "${expectedTitle.replace(/"/g, "'")}". If the visible title does not match this string, title_baked_in_score must be <= 40 and add "distorted_text" to repair_hints.
- text_integrity_score: check that EVERY word (title, subtitle, badge, footer chips) is fully visible with no letters clipped at any edge. If any letter is cut off or a word is truncated, this must be <= 50 and add "clipped_text".
- book_geometry_score: cover aspect ratio must be ~1:1.5, corners square, spine 6-8% of width, no warping/stretching/fisheye. If the book looks stretched, elongated, warped, or the corners are not square, this must be <= 50 and add "distorted_geometry".
- If the book occupies < 78% of frame height, book_size_score <= 60 and add "too_small".
- If background is dark or not off-white studio, white_bg_product_photo_score <= 40 and add "dark_bg".
- If the book looks flat / vector / template with no visible spine or page thickness, spine_page_depth_score <= 50 and add "flat".
- If there is no soft realistic shadow beneath the book, shadow_lighting_score <= 60 and add "no_shadow".
- final_store_thumbnail_score is the honest overall score.`;

  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: rubric },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`qc gateway ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  if (typeof raw === "string") {
    const r = parseModelJson<Record<string, unknown>>(raw);
    parsed = r.ok ? r.value : {};
  } else {
    parsed = raw ?? {};
  }


  const scores: Record<string, number> = {};
  const reasons: string[] = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 10) : [];
  const repair_hints: string[] = Array.isArray(parsed.repair_hints) ? parsed.repair_hints.slice(0, 5) : [];

  let passed = true;
  for (const k of Object.keys(THRESHOLDS)) {
    const v = Number(parsed[k] ?? 0);
    scores[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
    if (scores[k] < THRESHOLDS[k]) {
      passed = false;
      reasons.push(`${k} ${scores[k]} < ${THRESHOLDS[k]}`);
    }
  }
  scores["_detected_title_matches"] = String(parsed.detected_title ?? "").toLowerCase().includes(
    expectedTitle.split(/\s+/)[0].toLowerCase(),
  ) ? 100 : 0;
  return { passed, scores, reasons, repair_hints };
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
