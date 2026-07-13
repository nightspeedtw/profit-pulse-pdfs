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

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

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
): Promise<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: userPrompt }];
  for (const u of imageUrls) content.push({ type: "image_url", image_url: { url: u } });

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `${systemPrompt}\n\nCRITICAL: Return ONLY JSON. No prose. No markdown fences. Use integer scores 0-100.` },
        { role: "user", content },
      ],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const raw = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(raw); } catch { throw new Error(`vision bad JSON: ${raw.slice(0, 200)}`); }
}

const PAGE_SYSTEM =
  "You are a strict picture-book art director doing visual QC. Compare the INTERIOR PAGE (image 2) against the COVER MASTER (image 1). Judge how consistently the hero character, palette, line quality, lighting, and world style match the cover. Also judge whether the page image plausibly depicts the requested scene. Give integer scores 0-100. Provide short concrete evidence naming what you actually see. Never invent scores without visual evidence.";

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
 "evidence": "<what you see; be specific: face shape, outfit, color, brush strokes>",
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
}

export async function runKidsVisionQc(opts: RunKidsVisionOpts): Promise<VisionReport> {
  const pages: VisionPageScore[] = [];
  const styleSummary = opts.styleBible
    ? `Style bible: ${JSON.stringify(opts.styleBible).slice(0, 800)}`
    : "Style bible: (none provided)";
  const charSummary = opts.characterBible
    ? `Character bible: ${JSON.stringify(opts.characterBible).slice(0, 500)}`
    : "";

  const conc = Math.max(1, Math.min(4, opts.concurrency ?? 3));
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
