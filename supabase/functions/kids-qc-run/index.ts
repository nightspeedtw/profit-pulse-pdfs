// QC v2 — evidence-based QC run for a kids book.
// Runs: PDF preflight, glyph check, asset preflight, VISION consistency
// (cover vs each interior + duplicate detection), and STORY LLM judge
// (age/coherence/reread/emotional payoff/language/parent buyer value).
// Missing measured QC = KIDS_MEASURED_QC_MISSING critical failure.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { languageCheck, preflightCover, preflightPdf, type RawFinding } from "../_shared/pdf-preflight.ts";
import { preflightKidsAssets, preflightPdfGlyphs, kidsThresholdsForAge } from "../_shared/kids-preflight.ts";
import { runKidsVisionQc, visionReportToFindings } from "../_shared/kids-vision-qc.ts";
import { runKidsStoryJudge, storyReportToFindings } from "../_shared/kids-story-judge.ts";
import { computeVerdict } from "../_shared/qc/sellable.ts";
import { QC_RULE_VERSION } from "../_shared/qc/weights.ts";
import { verifyTitleSpelling, type TitleTreatmentMetadata } from "../_shared/covers/kids-title-treatment.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { ebook_id, run_id, skip_vision = false, skip_story = false } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await supabase
      .from("ebooks_kids")
      .select("id, title, subtitle, cover_url, pdf_url, manuscript_md, page_count, thumbnail_url, preview_page_urls, interior_illustrations, style_bible_json, age_group_id, storefront_meta")
      .eq("id", ebook_id)
      .single();
    if (error || !ebook) return json({ error: "ebook not found" }, 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (supabase.from("kids_book_bibles") as any)
      .select("style_bible_json, character_bible_json").eq("ebook_id", ebook_id).maybeSingle();
    const styleBible = (ebook.style_bible_json ?? bible?.style_bible_json) as Record<string, unknown> | null;
    const characterBible = (bible?.character_bible_json ?? null) as Record<string, unknown> | null;

    await supabase.from("qc_findings").delete().eq("ebook_id", ebook_id);

    const thresholds = kidsThresholdsForAge(null, "high");
    const raw: RawFinding[] = [];
    raw.push(...await preflightPdf(ebook.pdf_url as string | null));
    raw.push(...await preflightPdfGlyphs(ebook.pdf_url as string | null));
    raw.push(...preflightCover(ebook.cover_url as string | null, (ebook.title as string) ?? ""));
    raw.push(...languageCheck((ebook.manuscript_md as string) ?? null));
    raw.push(...languageCheck((ebook.title as string) ?? null));
    raw.push(...preflightKidsAssets({
      interior_illustrations: ebook.interior_illustrations,
      thumbnail_url: (ebook.thumbnail_url as string | null) ?? null,
      preview_page_urls: ebook.preview_page_urls,
      cover_url: (ebook.cover_url as string | null) ?? null,
      style_bible_json: styleBible,
      min_interior: thresholds.min_interior,
      min_previews: thresholds.min_previews,
    }));

    // ---- Title-treatment spelling gate ----
    // Every kids cover MUST be composed with the illustrated title-treatment
    // renderer, and the rendered title MUST match ebook.title exactly. This
    // prevents any regression to plain-typed or AI-baked title covers.
    const treatmentMeta = ((ebook.storefront_meta as Record<string, unknown> | null)?.title_treatment ?? null) as TitleTreatmentMetadata | null;
    const spelling = verifyTitleSpelling((ebook.title as string) ?? "", treatmentMeta);
    if (!spelling.pass) {
      raw.push({
        rule_id: "KIDS_TITLE_TREATMENT_INVALID",
        category: "cover",
        severity: "critical",
        passed: false,
        measured_value: {
          expected: spelling.expected,
          rendered: spelling.rendered,
          reason: spelling.reason,
          renderer: treatmentMeta?.renderer ?? null,
        },
        threshold: { must: "title_treatment_metadata_matches_ebook_title" },
        repair_action: "rerun_kids_cover_title_treatment",
      });
    }

    // ---- VISION QC ----
    let visionReport: unknown = null;
    const illos = Array.isArray(ebook.interior_illustrations) ? (ebook.interior_illustrations as Array<Record<string, unknown>>) : [];
    if (!skip_vision && ebook.cover_url && illos.length > 0) {
      try {
        const v = await runKidsVisionQc({
          coverUrl: ebook.cover_url as string,
          interior: illos.map((r, i) => ({
            index: (r.index as number) ?? i + 1,
            page_number: (r.page_number as number) ?? i + 3,
            scene: r.scene as string | undefined,
            url: r.url as string,
            hash: r.hash as string | undefined,
          })).filter((p) => typeof p.url === "string" && p.url.length > 8),
          styleBible,
          characterBible,
        });
        visionReport = v;
        raw.push(...visionReportToFindings(v));
      } catch (e) {
        raw.push({
          rule_id: "KIDS_MEASURED_QC_MISSING", category: "character_consistency",
          severity: "critical", passed: false,
          measured_value: { subsystem: "vision", error: String((e as Error).message ?? e).slice(0, 300) },
          threshold: { must: "vision_report_present" },
          repair_action: "rerun_vision_qc",
        });
      }
    } else if (!skip_vision) {
      raw.push({
        rule_id: "KIDS_MEASURED_QC_MISSING", category: "character_consistency",
        severity: "critical", passed: false,
        measured_value: { subsystem: "vision", cover: !!ebook.cover_url, interior_count: illos.length },
        threshold: { must: "vision_report_present" },
        repair_action: "generate_cover_and_interior",
      });
    }

    // ---- STORY JUDGE ----
    let storyReport: unknown = null;
    if (!skip_story && (ebook.manuscript_md as string | null)?.trim()) {
      try {
        const s = await runKidsStoryJudge({
          title: (ebook.title as string) ?? "",
          subtitle: (ebook.subtitle as string | null) ?? null,
          ageBand: null,
          manuscript_md: (ebook.manuscript_md as string) ?? "",
          page_texts: illos.map((r) => (r.scene as string | undefined) ?? "").filter(Boolean),
        });
        storyReport = s;
        raw.push(...storyReportToFindings(s));
      } catch (e) {
        raw.push({
          rule_id: "KIDS_MEASURED_QC_MISSING", category: "story_structure",
          severity: "critical", passed: false,
          measured_value: { subsystem: "story_judge", error: String((e as Error).message ?? e).slice(0, 300) },
          threshold: { must: "story_report_present" },
          repair_action: "rerun_story_judge",
        });
      }
    } else if (!skip_story) {
      raw.push({
        rule_id: "KIDS_MEASURED_QC_MISSING", category: "story_structure",
        severity: "critical", passed: false,
        measured_value: { subsystem: "story_judge", manuscript_present: false },
        threshold: { must: "manuscript_present" },
        repair_action: "generate_manuscript",
      });
    }

    if (raw.length) {
      const rows = raw.map((f) => ({
        ebook_id, run_id: run_id ?? null, ebook_track: "kids",
        rule_id: f.rule_id, category: f.category, page_number: f.page_number ?? null,
        measured_value: f.measured_value, threshold: f.threshold,
        passed: f.passed, severity: f.severity, evidence_url: f.evidence_url ?? null,
        repair_action: f.repair_action ?? null, qc_rule_version: QC_RULE_VERSION,
      }));
      const ins = await supabase.from("qc_findings").insert(rows);
      if (ins.error) console.error("qc_findings insert failed", ins.error);
    }

    const verdict = computeVerdict(raw.map((f) => ({
      rule_id: f.rule_id, category: f.category, passed: f.passed, severity: f.severity,
    })));

    await supabase.from("ebooks_kids").update({
      sellable: verdict.sellable,
      overall_qc_score: verdict.overall_score,
      qc_rule_version: QC_RULE_VERSION,
      qc_scorecard: {
        version: QC_RULE_VERSION,
        overall_score: verdict.overall_score,
        category_scores: verdict.category_scores,
        critical_errors: verdict.critical_errors,
        failed_categories: verdict.failed_categories,
        reasons: verdict.reasons,
        vision_report: visionReport,
        story_report: storyReport,
        computed_at: new Date().toISOString(),
      },
      human_review_reason: verdict.sellable ? null : verdict.reasons.join(" | "),
    }).eq("id", ebook_id);

    return json({ ok: true, verdict, finding_count: raw.length, vision_report: visionReport, story_report: storyReport });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
