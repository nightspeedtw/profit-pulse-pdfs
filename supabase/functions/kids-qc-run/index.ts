// QC v2 — evidence-based QC run for a kids book.
// Downloads the actual PDF, checks it, writes qc_findings, computes score,
// updates ebooks_kids.sellable / overall_qc_score / qc_scorecard.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { languageCheck, preflightCover, preflightPdf, type RawFinding } from "../_shared/pdf-preflight.ts";
import { preflightKidsAssets, preflightPdfGlyphs, kidsThresholdsForAge } from "../_shared/kids-preflight.ts";
import { computeVerdict } from "../_shared/qc/sellable.ts";
import { QC_RULE_VERSION } from "../_shared/qc/weights.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { ebook_id, run_id } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await supabase
      .from("ebooks_kids")
      .select("id, title, cover_url, pdf_url, manuscript_md, page_count, thumbnail_url, preview_page_urls, interior_illustrations, style_bible_json")
      .eq("id", ebook_id)
      .single();
    if (error || !ebook) return json({ error: "ebook not found" }, 404);

    // Also fetch style bible from the kids_book_bibles table as a fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (supabase.from("kids_book_bibles") as any)
      .select("style_bible_json").eq("ebook_id", ebook_id).maybeSingle();
    const styleBible = (ebook.style_bible_json ?? bible?.style_bible_json) as unknown;

    // Clear prior findings for this book/run so this becomes the source of truth.
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

    // Persist findings
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
        computed_at: new Date().toISOString(),
      },
      human_review_reason: verdict.sellable ? null : verdict.reasons.join(" | "),
    }).eq("id", ebook_id);

    return json({ ok: true, verdict, finding_count: raw.length });
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
