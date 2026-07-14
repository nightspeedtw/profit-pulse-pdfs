// QC v2 — evidence-based QC run for a kids book.
// Runs: PDF preflight, glyph check, asset preflight, VISION consistency
// (cover vs each interior + duplicate detection), and STORY LLM judge
// (age/coherence/reread/emotional payoff/language/parent buyer value).
// Missing measured QC = KIDS_MEASURED_QC_MISSING critical failure.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { languageCheck, preflightCover, preflightPdf, type RawFinding } from "../_shared/pdf-preflight.ts";
import { auditPdfGlyphs, preflightKidsAssets, kidsThresholdsForAge } from "../_shared/kids-preflight.ts";
import { runKidsVisionQc, visionReportToFindings } from "../_shared/kids-vision-qc.ts";
import { runKidsStoryJudge, storyReportToFindings, type StoryReport } from "../_shared/kids-story-judge.ts";
import { computeVerdict } from "../_shared/qc/sellable.ts";
import { QC_RULE_VERSION } from "../_shared/qc/weights.ts";
import { verifyTitleSpelling, type TitleTreatmentMetadata } from "../_shared/covers/kids-title-treatment.ts";
import { computeLuminanceFromUrl } from "../_shared/image-luminance.ts";
import { splitManuscriptForSpreads } from "../_shared/kids-picture-pdf.ts";
import { loadSegments, segmentsToPageTexts } from "../_shared/kids-segments.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { ebook_id, run_id, skip_vision = false, skip_story = false, use_cached_story_judge_if_hash_matches = false, auto_repair_on_fail = true } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await supabase
      .from("ebooks_kids")
      .select("id, title, subtitle, cover_url, pdf_url, manuscript_md, page_count, thumbnail_url, preview_page_urls, interior_illustrations, style_bible_json, age_group_id, storefront_meta, qc_scorecard")
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
    const glyphAudit = await auditPdfGlyphs(ebook.pdf_url as string | null);
    raw.push(...glyphAudit.findings);
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

    // ---- STORY JUDGE (with manuscript-hash caching) ----
    // Story judging is stochastic; when the manuscript hasn't changed we trust
    // the last passing hash-matched result instead of rerunning it during
    // art-only repairs. Cache lives at storefront_meta.story_judge_cache.
    async function sha256Hex(s: string): Promise<string> {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const manuscriptStr = String(ebook.manuscript_md ?? "").trim();
    const manuscriptHash = manuscriptStr ? await sha256Hex(manuscriptStr.replace(/\s+/g, " ")) : "";
    const storyJudgeCache = ((ebook.storefront_meta as Record<string, unknown> | null)?.story_judge_cache ?? null) as Record<string, unknown> | null;
    function getCachedPassingJudge(hash: string): { manuscript_hash: string; report: StoryReport; cached_at: string } | null {
      if (!storyJudgeCache || !hash) return null;
      const direct = storyJudgeCache[hash] as { manuscript_hash?: string; report?: StoryReport; cached_at?: string } | undefined;
      if (direct?.report?.story_qc_passed === true) {
        return { manuscript_hash: direct.manuscript_hash ?? hash, report: direct.report, cached_at: direct.cached_at ?? "" };
      }
      const byHash = (storyJudgeCache.by_hash as Record<string, { manuscript_hash?: string; report?: StoryReport; cached_at?: string }> | undefined)?.[hash];
      if (byHash?.report?.story_qc_passed === true) {
        return { manuscript_hash: byHash.manuscript_hash ?? hash, report: byHash.report, cached_at: byHash.cached_at ?? "" };
      }
      if (storyJudgeCache.manuscript_hash === hash && (storyJudgeCache.report as StoryReport | undefined)?.story_qc_passed === true) {
        return storyJudgeCache as unknown as { manuscript_hash: string; report: StoryReport; cached_at: string };
      }
      return null;
    }

    let storyReport: unknown = null;
    let storyStatus: "computed" | "hash_matched_cached_pass" | "skipped" | "missing" = "missing";
    if (!skip_story && manuscriptStr) {
      const cachedJudge = use_cached_story_judge_if_hash_matches ? getCachedPassingJudge(manuscriptHash) : null;
      if (cachedJudge) {
        storyReport = cachedJudge.report;
        raw.push(...storyReportToFindings(cachedJudge.report));
        storyStatus = "hash_matched_cached_pass";
      } else {
        try {
          const s = await runKidsStoryJudge({
            title: (ebook.title as string) ?? "",
            subtitle: (ebook.subtitle as string | null) ?? null,
            ageBand: null,
            manuscript_md: manuscriptStr,
            page_texts: illos.map((r) => (r.scene as string | undefined) ?? "").filter(Boolean),
            ebook_id: ebook.id as string,
          });
          storyReport = s;
          raw.push(...storyReportToFindings(s));
          storyStatus = "computed";
          // Cache passing report keyed by manuscript hash.
          if (s.story_qc_passed && manuscriptHash) {
            const existingMeta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
            await supabase.from("ebooks_kids").update({
            storefront_meta: {
                ...existingMeta,
                story_judge_cache: {
                ...(((existingMeta.story_judge_cache ?? null) as Record<string, unknown>) ?? {}),
                [manuscriptHash]: { manuscript_hash: manuscriptHash, report: s, cached_at: new Date().toISOString() },
                by_hash: {
                  ...((((existingMeta.story_judge_cache as Record<string, unknown> | undefined)?.by_hash ?? null) as Record<string, unknown>) ?? {}),
                  [manuscriptHash]: { manuscript_hash: manuscriptHash, report: s, cached_at: new Date().toISOString() },
                },
                manuscript_hash: manuscriptHash,
                report: s,
                cached_at: new Date().toISOString(),
                },
              },
            }).eq("id", ebook_id);
          }
        } catch (e) {
          raw.push({
            rule_id: "KIDS_MEASURED_QC_MISSING", category: "story_structure",
            severity: "critical", passed: false,
            measured_value: { subsystem: "story_judge", error: String((e as Error).message ?? e).slice(0, 300) },
            threshold: { must: "story_report_present" },
            repair_action: "rerun_story_judge",
          });
        }
      }
    } else if (skip_story) {
      storyStatus = "skipped";
    } else if (!manuscriptStr) {
      raw.push({
        rule_id: "KIDS_MEASURED_QC_MISSING", category: "story_structure",
        severity: "critical", passed: false,
        measured_value: { subsystem: "story_judge", manuscript_present: false },
        threshold: { must: "manuscript_present" },
        repair_action: "generate_manuscript",
      });
    }

    // ---- Gate 2 (deterministic dead-page check on rendered assets) ----
    // Cheap luminance/variance check on cover + every interior image. Catches
    // solid-black / solid-white / flat-gray pages that vision LLMs miss.
    const deadPageFindings: Array<{ index: number; url: string; reason: string; mean: number; variance: number }> = [];
    async function checkDead(url: string, label: string, idx: number | null) {
      const s = await computeLuminanceFromUrl(url);
      if ('error' in s) return;
      if (s.dead) {
        deadPageFindings.push({ index: idx ?? -1, url, reason: s.reason ?? 'dead', mean: s.mean, variance: s.variance });
        raw.push({
          rule_id: 'KIDS_DEAD_PAGE', category: 'illustration_quality',
          severity: 'critical', passed: false,
          page_number: idx != null ? idx + 3 : undefined,
          measured_value: { label, url, reason: s.reason, mean: s.mean, variance: s.variance },
          threshold: { must: 'variance>=200 AND 12<mean<243' },
          repair_action: 'regenerate_dead_page',
        });
      }
    }
    if (ebook.cover_url) await checkDead(ebook.cover_url as string, 'cover', null);
    for (let i = 0; i < illos.length; i++) {
      const u = (illos[i] as { url?: string }).url;
      if (typeof u === 'string' && u.length > 8) await checkDead(u, `interior_${i + 1}`, i);
    }

    // ---- Gate 4 (text-to-page mapping check) ----
    // Every story page must have real caption text — no "Page N" placeholders,
    // no empty captions. This is what puts "Page 28" in Detective Pip p31.
    const captions = splitManuscriptForSpreads(manuscriptStr, illos.length);
    const placeholderRx = /^\s*(page\s*\d+|lorem\s+ipsum|placeholder|tbd|todo)\s*$/i;
    const badCaptions: number[] = [];
    captions.forEach((c, i) => { if (!c || !c.trim() || placeholderRx.test(c.trim())) badCaptions.push(i); });
    if (badCaptions.length) {
      raw.push({
        rule_id: 'KIDS_TEXT_MAPPING_BROKEN', category: 'story_structure',
        severity: 'critical', passed: false,
        measured_value: { bad_page_indices: badCaptions, total_pages: illos.length, usable_captions: captions.filter(c => c && c.trim()).length },
        threshold: { must: 'every_page_has_manuscript_text' },
        repair_action: 'fix_manuscript_page_split',
      });
    }

    // ---- Gate 3 (style coherence) ----
    // Every interior page must share the book's style anchor fingerprint.
    const anchorFp = (ebook.qc_scorecard as Record<string, unknown> | null)?.style_anchor_fingerprint as string | undefined;
    const mixedFps: Array<{ index: number; fp: string | null }> = [];
    if (anchorFp) {
      for (let i = 0; i < illos.length; i++) {
        const fp = (illos[i] as { style_fingerprint?: string }).style_fingerprint ?? null;
        if (fp && fp !== anchorFp) mixedFps.push({ index: i, fp });
      }
      if (mixedFps.length) {
        raw.push({
          rule_id: 'KIDS_MIXED_ART_STYLES', category: 'illustration_quality',
          severity: 'critical', passed: false,
          measured_value: { anchor: anchorFp, mismatches: mixedFps },
          threshold: { must: 'all_interiors_share_style_anchor_fingerprint' },
          repair_action: 'regenerate_offstyle_pages',
        });
      }
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

    // ---- Gate 5 (honest score caps) ----
    // Deterministic hard caps overriding the vision-LLM optimism that let
    // Detective Pip score 100 while having a dead page + 3 art styles + a
    // "Page 28" caption. Any of these defects caps overall_score.
    const caps: Array<{ rule: string; cap: number; reason: string }> = [];
    if (deadPageFindings.length) caps.push({ rule: 'KIDS_DEAD_PAGE', cap: 30, reason: `${deadPageFindings.length} dead page(s)` });
    if (mixedFps.length) caps.push({ rule: 'KIDS_MIXED_ART_STYLES', cap: 40, reason: `${mixedFps.length} off-style page(s)` });
    if (badCaptions.length) caps.push({ rule: 'KIDS_TEXT_MAPPING_BROKEN', cap: 40, reason: `${badCaptions.length} placeholder caption(s)` });
    if (!spelling.pass) caps.push({ rule: 'KIDS_TITLE_TREATMENT_INVALID', cap: 50, reason: 'cover title invalid' });
    const effectiveScore = caps.length
      ? Math.min(verdict.overall_score, ...caps.map(c => c.cap))
      : verdict.overall_score;
    const cappedSellable = verdict.sellable && caps.length === 0;
    const capReasons = caps.map(c => `${c.rule}(cap=${c.cap}:${c.reason})`);
    const finalReasons = [...verdict.reasons, ...capReasons];

    const existingScorecard = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
    const preservedScorecard: Record<string, unknown> = {};
    if (existingScorecard.final_text_repair) preservedScorecard.final_text_repair = existingScorecard.final_text_repair;
    if (existingScorecard.repair_log) preservedScorecard.repair_log = existingScorecard.repair_log;
    if (existingScorecard.style_anchor_fingerprint) preservedScorecard.style_anchor_fingerprint = existingScorecard.style_anchor_fingerprint;

    await supabase.from("ebooks_kids").update({
      sellable: cappedSellable,
      overall_qc_score: effectiveScore,
      qc_rule_version: QC_RULE_VERSION,
      qc_scorecard: {
        ...preservedScorecard,
        version: QC_RULE_VERSION,
        overall_score: effectiveScore,
        raw_overall_score: verdict.overall_score,
        score_caps_applied: caps,
        category_scores: verdict.category_scores,
        critical_errors: verdict.critical_errors,
        failed_categories: verdict.failed_categories,
        reasons: finalReasons,
        dead_page_findings: deadPageFindings,
        text_mapping_bad_indices: badCaptions,
        style_mismatch_indices: mixedFps,
        vision_report: visionReport,
        story_report: storyReport,
        story_qc_status: storyStatus,
        manuscript_hash: manuscriptHash || null,
        title_treatment: treatmentMeta,
        title_spelling: spelling,
        pdf_glyph_audit: glyphAudit.audit,
        computed_at: new Date().toISOString(),
      },
      human_review_reason: cappedSellable ? null : finalReasons.join(" | "),
      blocker_reason: cappedSellable ? null : finalReasons.join(" | "),
    }).eq("id", ebook_id);

    if (!cappedSellable && auto_repair_on_fail) {
      // @ts-expect-error EdgeRuntime is a Deno Deploy global
      EdgeRuntime.waitUntil(fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id, run_id: run_id ?? undefined, source: "kids-qc-run", async: true }),
      }).then((r) => r.text()).catch((e) => console.error("kids-qc-run supervisor dispatch failed", e)));
    }

    return json({ ok: true, verdict: { ...verdict, sellable: cappedSellable, overall_score: effectiveScore, reasons: finalReasons, score_caps_applied: caps }, finding_count: raw.length, dead_page_count: deadPageFindings.length, text_mapping_bad: badCaptions.length, style_mismatch_count: mixedFps.length, vision_report: visionReport, story_report: storyReport, story_qc_status: storyStatus, manuscript_hash: manuscriptHash, pdf_glyph_audit: glyphAudit.audit, supervisor_dispatched: !cappedSellable && auto_repair_on_fail });
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
