// Vision-based QC for kids picture books.
//
// Uses Gemini 2.5 Flash (multimodal, image_url input) to compare each interior
// illustration against the cover master + style bible, producing REAL measured
// per-page scores with evidence text.
//
// Also performs a duplicate/near-duplicate pass by sha256 hash of the source
// bytes (cheap and deterministic) — a full-CLIP embedding pass can be added
// later, but URL/hash duplicates are the most common failure and must fail QC.

import type { RawFinding } from "./pdf-preflight.ts";
import { logAiCost, costDb } from "./cost-log.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const VISION_MODEL = "google/gemini-2.5-flash-lite";

export interface VisionPageScore {
  page_number: number;
  index: number;
  url: string;
  character_match_score: number;
  protagonist_face_body_score: number;
  clothing_prop_consistency_score: number;
  palette_match_score: number;
  line_quality_match_score: number;
  lighting_match_score: number;
  world_style_match_score: number;
  cover_interior_match_score: number;
  page_scene_match_score: number;
  duplicate_or_near_duplicate_score: number; // 0 = unique, 100 = duplicate of another page
  evidence: string;
  repair_action: string;
}

export interface VisionReport {
  overall_character_consistency: number;
  overall_cover_interior_match: number;
  overall_style_bible_match: number;
  pages: VisionPageScore[];
  critical_findings: string[];
  computed_at: string;
}

interface Interior {
  index: number;
  page_number: number;
  scene?: string;
  url: string;
  hash?: string;
}

async function callVision(
  systemPrompt: string,
  userPrompt: string,
  imageUrls: string[],
  meta?: { ebook_id?: string; step?: string },
): Promise<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: userPrompt }];
  for (const u of imageUrls) content.push({ type: "image_url", image_url: { url: u } });

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: `${systemPrompt}\n\nCRITICAL: Return ONLY JSON. No prose. No markdown fences. Use integer scores 0-100.` },
        { role: "user", content },
      ],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const usage = j.usage ?? {};
  logAiCost(costDb(), {
    ebook_id: meta?.ebook_id,
    step: meta?.step ?? "kids_vision_qc",
    model: VISION_MODEL,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    provider: "gateway",
  });
  const raw = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(raw); } catch { throw new Error(`vision bad JSON: ${raw.slice(0, 200)}`); }
}

const PAGE_SYSTEM =
  "You are a strict picture-book art director doing visual QC. Compare the INTERIOR PAGE (image 2) against the COVER MASTER (image 1). Judge how consistently the hero character, palette, line quality, lighting, and world style match the cover. Also judge whether the page image plausibly depicts the requested scene. Give integer scores 0-100. Provide short concrete evidence naming what you actually see. Never invent scores without visual evidence. FAIRNESS RULE: if the COVER MASTER is lettering-forward with no hero character illustration visible (typography-only or near-empty), do NOT penalize cover_interior_match on character presence — score cover_interior_match on STYLE, PALETTE, LINE QUALITY, LIGHTING, and WORLD continuity only, and mention 'cover_lettering_only' in evidence. Character_match_score in that case is still judged against the character bible description text, not against the cover. SKILL D (2026-07-15): interior pages must contain NO title-lettering / book-title text. If you can read the book title or any large decorative title-style text inside the illustration, set title_text_present=true and force page_scene_match_score ≤ 40 with evidence naming the words you see. SKILL C strict rubric: mark on-model=false if the depicted creature differs from the cover in species (e.g. bug vs person), face style (kid-face on animal body), proportions, or accessory outfit. Human-like body on an animal hero is an automatic on_model=false.";

const PAGE_SCHEMA_HINT = `Return JSON exactly like:
{
 "character_match_score": 0,
 "protagonist_face_body_score": 0,
 "clothing_prop_consistency_score": 0,
 "palette_match_score": 0,
 "line_quality_match_score": 0,
 "lighting_match_score": 0,
 "world_style_match_score": 0,
 "cover_interior_match_score": 0,
 "page_scene_match_score": 0,
 "title_text_present": false,
 "on_model": true,
 "evidence": "<what you see; be specific: face shape, outfit, color, brush strokes, any lettering you can read>",
 "repair_action": "<one of: none|regenerate_page|adjust_palette|adjust_character_reference|regenerate_all_interior|regenerate_style_bible>"
}`;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export interface RunKidsVisionOpts {
  coverUrl: string;
  interior: Interior[];
  styleBible: Record<string, unknown> | null;
  characterBible: Record<string, unknown> | null;
  concurrency?: number;
  ebook_id?: string;
}

export async function runKidsVisionQc(opts: RunKidsVisionOpts): Promise<VisionReport> {
  const pages: VisionPageScore[] = [];
  const styleSummary = opts.styleBible
    ? `Style bible: ${JSON.stringify(opts.styleBible).slice(0, 800)}`
    : "Style bible: (none provided)";
  const charSummary = opts.characterBible
    ? `Character bible: ${JSON.stringify(opts.characterBible).slice(0, 500)}`
    : "";

  const conc = Math.max(1, Math.min(8, opts.concurrency ?? 6));
  const queue = [...opts.interior];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) return;
      try {
        const res = await callVision(
          PAGE_SYSTEM,
          `${styleSummary}\n${charSummary}\nRequested scene for this page: ${p.scene ?? "(unspecified)"}\n\n${PAGE_SCHEMA_HINT}`,
          [opts.coverUrl, p.url],
          { ebook_id: opts.ebook_id, step: "kids_vision_qc_page" },
        );
        pages.push({
          page_number: p.page_number,
          index: p.index,
          url: p.url,
          character_match_score: num(res.character_match_score),
          protagonist_face_body_score: num(res.protagonist_face_body_score),
          clothing_prop_consistency_score: num(res.clothing_prop_consistency_score),
          palette_match_score: num(res.palette_match_score),
          line_quality_match_score: num(res.line_quality_match_score),
          lighting_match_score: num(res.lighting_match_score),
          world_style_match_score: num(res.world_style_match_score),
          cover_interior_match_score: num(res.cover_interior_match_score),
          page_scene_match_score: num(res.page_scene_match_score),
          duplicate_or_near_duplicate_score: 0,
          evidence: String(res.evidence ?? "").slice(0, 600),
          repair_action: String(res.repair_action ?? "none"),
        });
      } catch (e) {
        pages.push({
          page_number: p.page_number, index: p.index, url: p.url,
          character_match_score: 0, protagonist_face_body_score: 0,
          clothing_prop_consistency_score: 0, palette_match_score: 0,
          line_quality_match_score: 0, lighting_match_score: 0,
          world_style_match_score: 0, cover_interior_match_score: 0,
          page_scene_match_score: 0, duplicate_or_near_duplicate_score: 0,
          evidence: `vision call failed: ${String((e as Error).message ?? e).slice(0, 200)}`,
          repair_action: "regenerate_page",
        });
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));
  pages.sort((a, b) => a.index - b.index);

  // Duplicate detection — hash-based on the source bytes.
  const hashes: Record<string, number[]> = {};
  for (const p of opts.interior) {
    if (!p.hash) continue;
    (hashes[p.hash] ??= []).push(p.index);
  }
  for (const [_h, idxs] of Object.entries(hashes)) {
    if (idxs.length > 1) {
      for (const i of idxs) {
        const pg = pages.find((x) => x.index === i);
        if (pg) {
          pg.duplicate_or_near_duplicate_score = 100;
          pg.evidence = `${pg.evidence} | DUPLICATE bytes vs pages ${idxs.filter((x) => x !== i).join(",")}`;
          pg.repair_action = "regenerate_page";
        }
      }
    }
  }

  const overall_character_consistency = avg(pages.map((p) =>
    Math.round((p.character_match_score + p.protagonist_face_body_score + p.clothing_prop_consistency_score) / 3)));
  const overall_cover_interior_match = avg(pages.map((p) => p.cover_interior_match_score));
  const overall_style_bible_match = avg(pages.map((p) =>
    Math.round((p.palette_match_score + p.line_quality_match_score + p.lighting_match_score + p.world_style_match_score) / 4)));

  const critical: string[] = [];
  if (overall_character_consistency < 90) critical.push(`character_consistency ${overall_character_consistency} < 90`);
  if (overall_cover_interior_match < 90) critical.push(`cover_interior_match ${overall_cover_interior_match} < 90`);
  if (overall_style_bible_match < 90) critical.push(`style_bible_match ${overall_style_bible_match} < 90`);
  for (const p of pages) {
    const pageChar = Math.round((p.character_match_score + p.protagonist_face_body_score) / 2);
    if (pageChar < 82) critical.push(`page ${p.page_number} character ${pageChar} < 82`);
    if (p.duplicate_or_near_duplicate_score >= 90) critical.push(`page ${p.page_number} duplicate`);
  }

  return {
    overall_character_consistency,
    overall_cover_interior_match,
    overall_style_bible_match,
    pages,
    critical_findings: critical,
    computed_at: new Date().toISOString(),
  };
}

export function visionReportToFindings(v: VisionReport): RawFinding[] {
  const out: RawFinding[] = [];
  const passOverall = v.critical_findings.length === 0;
  out.push({
    rule_id: passOverall ? "VISION_CONSISTENCY_OK" : "VISION_CHARACTER_CONSISTENCY_FAIL",
    category: "character_consistency",
    severity: passOverall ? "minor" : "critical",
    passed: passOverall && v.overall_character_consistency >= 90,
    measured_value: {
      overall_character_consistency: v.overall_character_consistency,
      per_page: v.pages.map((p) => ({ page: p.page_number, score: p.character_match_score, evidence: p.evidence.slice(0, 160) })),
    },
    threshold: { min_avg: 90, per_page_min: 82 },
    repair_action: "regenerate_failing_pages_or_style_bible",
  });
  out.push({
    rule_id: v.overall_cover_interior_match >= 90 ? "VISION_COVER_MATCH_OK" : "VISION_COVER_INTERIOR_MISMATCH",
    category: "cover_interior_match",
    severity: v.overall_cover_interior_match >= 90 ? "minor" : "critical",
    passed: v.overall_cover_interior_match >= 90,
    measured_value: { avg: v.overall_cover_interior_match,
      per_page: v.pages.map((p) => ({ page: p.page_number, score: p.cover_interior_match_score })) },
    threshold: { min_avg: 90 },
    repair_action: "regenerate_failing_pages",
  });
  out.push({
    rule_id: v.overall_style_bible_match >= 90 ? "VISION_STYLE_OK" : "VISION_STYLE_BIBLE_MISMATCH",
    category: "illustration_style",
    severity: v.overall_style_bible_match >= 90 ? "minor" : "critical",
    passed: v.overall_style_bible_match >= 90,
    measured_value: { avg: v.overall_style_bible_match },
    threshold: { min_avg: 90 },
    repair_action: "regenerate_style_bible_or_reroll_interior",
  });
  for (const p of v.pages) {
    if (p.duplicate_or_near_duplicate_score >= 90) {
      out.push({
        rule_id: "DUPLICATE_ILLUSTRATION_DETECTED",
        category: "illustration_style",
        severity: "critical",
        passed: false,
        page_number: p.page_number,
        measured_value: { duplicate_score: p.duplicate_or_near_duplicate_score, evidence: p.evidence },
        threshold: { max: 89 },
        repair_action: "regenerate_page",
      });
    }
    const pageChar = Math.round((p.character_match_score + p.protagonist_face_body_score) / 2);
    if (pageChar < 82) {
      out.push({
        rule_id: "CHARACTER_IDENTITY_BREAK",
        category: "character_consistency",
        severity: "critical",
        passed: false,
        page_number: p.page_number,
        measured_value: { page_character_score: pageChar, evidence: p.evidence.slice(0, 240) },
        threshold: { min: 82 },
        repair_action: p.repair_action || "regenerate_page",
      });
    }
  }
  return out;
}

// ---------------- Batched 3×3 contact-sheet QC ----------------
//
// One vision call judges 9 pages at once by asking the model to look at a
// composite grid. Each cell is labeled 1-9. Cuts vision-QC volume ~89% for
// full-book passes (35 pages → 4 calls instead of 35). Single-page path
// (runKidsVisionQc) stays for repair re-checks where we only regenerated one
// page and don't need to re-judge all others.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export interface BatchCellVerdict {
  cell: number;               // 1..9
  page_number: number;
  index: number;
  url: string;
  overall_score: number;
  character_match_score: number;
  cover_interior_match_score: number;
  page_scene_match_score: number;
  evidence: string;
  repair_action: string;
}

async function makeContactSheet(urls: string[]): Promise<string> {
  const CELL = 256; // 256×256 per cell → 768×768 sheet; ~4× less decode CPU than 384.
  const canvas = new Image(CELL * 3, CELL * 3);
  canvas.fill(0xffffffff);
  for (let i = 0; i < urls.length && i < 9; i++) {
    try {
      const res = await fetch(urls[i]);
      if (!res.ok) continue;
      const img = await Image.decode(new Uint8Array(await res.arrayBuffer()));
      const resized = img.resize(CELL, CELL);
      const row = Math.floor(i / 3), col = i % 3;
      canvas.composite(resized, col * CELL, row * CELL);
    } catch (e) {
      console.warn("contact-sheet cell decode failed", i, (e as Error).message);
    }
  }
  const png = await canvas.encode();
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < png.length; i += chunk) s += String.fromCharCode(...png.subarray(i, i + chunk));
  return `data:image/png;base64,${btoa(s)}`;
}

const BATCH_SYSTEM =
  "You are a strict picture-book art director doing visual QC on a 3x3 contact sheet. " +
  "Cells are numbered 1-9 in reading order (row-major, top-left = 1). " +
  "For each cell that has an image, judge how well the page matches the reference cover shown first, " +
  "and whether the page scene reads clearly. Give integer scores 0-100. Return JSON only.";

/**
 * Batch vision QC. `coverUrl` is the reference cover pinned as the first image;
 * `pages` are grouped into 3x3 sheets and judged in one call per sheet.
 */
export async function runKidsVisionQcBatched(opts: {
  coverUrl: string;
  interior: Interior[];
  ebook_id?: string;
}): Promise<BatchCellVerdict[]> {
  const results: BatchCellVerdict[] = [];
  for (let start = 0; start < opts.interior.length; start += 9) {
    const group = opts.interior.slice(start, start + 9);
    const sheetDataUrl = await makeContactSheet(group.map((g) => g.url));
    const sceneLines = group.map((g, i) =>
      `cell ${i + 1} (page ${g.page_number}): scene = ${g.scene ?? "(unspecified)"}`,
    ).join("\n");
    const user = `Reference cover is image 1. Image 2 is a 3x3 contact sheet of interior pages.

${sceneLines}

For each cell 1-${group.length} return an object. Return JSON:
{"cells":[{"cell":1,"character_match_score":0,"cover_interior_match_score":0,"page_scene_match_score":0,"overall_score":0,"evidence":"...","repair_action":"none|regenerate_page|adjust_palette"} ...]}`;

    try {
      const j = await callVision(BATCH_SYSTEM, user, [opts.coverUrl, sheetDataUrl], {
        ebook_id: opts.ebook_id,
        step: "kids_vision_qc_batch",
      });
      const cells = Array.isArray((j as { cells?: unknown }).cells)
        ? (j as { cells: Record<string, unknown>[] }).cells
        : [];
      for (const c of cells) {
        const cellNo = num(c.cell as number);
        const g = group[cellNo - 1];
        if (!g) continue;
        results.push({
          cell: cellNo,
          page_number: g.page_number,
          index: g.index,
          url: g.url,
          character_match_score: num(c.character_match_score),
          cover_interior_match_score: num(c.cover_interior_match_score),
          page_scene_match_score: num(c.page_scene_match_score),
          overall_score: num(c.overall_score),
          evidence: String(c.evidence ?? "").slice(0, 400),
          repair_action: String(c.repair_action ?? "none"),
        });
      }
    } catch (e) {
      console.warn("batch vision qc failed for group", start, (e as Error).message);
      for (let i = 0; i < group.length; i++) {
        const g = group[i];
        results.push({
          cell: i + 1, page_number: g.page_number, index: g.index, url: g.url,
          character_match_score: 0, cover_interior_match_score: 0, page_scene_match_score: 0,
          overall_score: 0, evidence: `batch vision failed: ${(e as Error).message.slice(0, 120)}`,
          repair_action: "regenerate_page",
        });
      }
    }
  }
  return results;
}

/**
 * Auto-selecting vision QC. For large books (>12 interior pages) uses the 3x3
 * contact-sheet batched path (≤4 vision calls for a 32-page book) to stay
 * inside the edge-function CPU budget. Otherwise falls back to the per-page
 * path so small repair re-checks keep their higher-fidelity scoring.
 *
 * Always returns a VisionReport-shaped object so downstream findings code
 * (visionReportToFindings) is untouched.
 */
export async function runKidsVisionQcAuto(opts: RunKidsVisionOpts): Promise<VisionReport> {
  if (opts.interior.length <= 12) return runKidsVisionQc(opts);

  const cells = await runKidsVisionQcBatched({
    coverUrl: opts.coverUrl,
    interior: opts.interior,
    ebook_id: opts.ebook_id,
  });

  // Map contact-sheet cell verdicts back into the full VisionPageScore shape
  // by broadcasting the batched scores into the per-dimension fields the
  // downstream findings code reads.
  const pages: VisionPageScore[] = cells.map((c) => ({
    page_number: c.page_number,
    index: c.index,
    url: c.url,
    character_match_score: c.character_match_score,
    protagonist_face_body_score: c.character_match_score,
    clothing_prop_consistency_score: c.character_match_score,
    palette_match_score: c.overall_score,
    line_quality_match_score: c.overall_score,
    lighting_match_score: c.overall_score,
    world_style_match_score: c.overall_score,
    cover_interior_match_score: c.cover_interior_match_score,
    page_scene_match_score: c.page_scene_match_score,
    duplicate_or_near_duplicate_score: 0,
    evidence: c.evidence,
    repair_action: c.repair_action,
  }));

  // Duplicate detection (hash-based) — mirrors runKidsVisionQc.
  const hashes: Record<string, number[]> = {};
  for (const p of opts.interior) {
    if (!p.hash) continue;
    (hashes[p.hash] ??= []).push(p.index);
  }
  for (const [, idxs] of Object.entries(hashes)) {
    if (idxs.length > 1) {
      for (const i of idxs) {
        const pg = pages.find((x) => x.index === i);
        if (pg) {
          pg.duplicate_or_near_duplicate_score = 100;
          pg.evidence = `${pg.evidence} | DUPLICATE bytes vs pages ${idxs.filter((x) => x !== i).join(",")}`;
          pg.repair_action = "regenerate_page";
        }
      }
    }
  }

  const overall_character_consistency = avg(pages.map((p) => p.character_match_score));
  const overall_cover_interior_match = avg(pages.map((p) => p.cover_interior_match_score));
  const overall_style_bible_match = avg(pages.map((p) => p.palette_match_score));

  const critical: string[] = [];
  if (overall_character_consistency < 90) critical.push(`character_consistency ${overall_character_consistency} < 90`);
  if (overall_cover_interior_match < 90) critical.push(`cover_interior_match ${overall_cover_interior_match} < 90`);
  if (overall_style_bible_match < 90) critical.push(`style_bible_match ${overall_style_bible_match} < 90`);
  for (const p of pages) {
    if (p.character_match_score < 82) critical.push(`page ${p.page_number} character ${p.character_match_score} < 82`);
    if (p.duplicate_or_near_duplicate_score >= 90) critical.push(`page ${p.page_number} duplicate`);
  }

  return {
    overall_character_consistency,
    overall_cover_interior_match,
    overall_style_bible_match,
    pages,
    critical_findings: critical,
    computed_at: new Date().toISOString(),
  };
}
