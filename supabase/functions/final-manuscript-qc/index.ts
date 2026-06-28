// Milestone 4 — Final Manuscript QC.
// Loads all chapters, runs whole-book QC (depth, reader value, practical tools,
// editorial polish, compliance, refund risk, plus repetition/filler/formatting
// /flow/title-match/promise/disclaimer checks). Auto-fixes up to 2x.
// Pass rule: final_manuscript_score >= 85 AND compliance_safety_score >= 90.
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";
import { logRun } from "../_shared/qc.ts";

const PASS_MANUSCRIPT = 85;
const PASS_COMPLIANCE = 90;
const MIN_WORDS = 18000;

interface ManuscriptQC {
  final_content_depth_score: number;
  reader_value_score: number;
  practical_tool_score: number;
  editorial_polish_score: number;
  compliance_safety_score: number;
  refund_risk_score: number; // 0-100, lower = safer
  final_manuscript_score: number;
  checks: {
    word_count_ok: boolean;
    no_repeated_sections: boolean;
    no_generic_filler: boolean;
    no_broken_formatting: boolean;
    chapter_flow_ok: boolean;
    title_matches_content: boolean;
    promise_delivered: boolean;
    practical_tools_present: boolean;
    disclaimers_present_when_required: boolean;
    compliance_safe_language: boolean;
    buyer_value_strong: boolean;
  };
  issues: string[];
  blocking_issues: string[];
  fix_instructions_per_chapter: { chapter_index: number; instructions: string }[];
}

const SCHEMA = `{
  "final_content_depth_score": 0-100,
  "reader_value_score": 0-100,
  "practical_tool_score": 0-100,
  "editorial_polish_score": 0-100,
  "compliance_safety_score": 0-100,
  "refund_risk_score": 0-100,
  "final_manuscript_score": 0-100,
  "checks": {
    "word_count_ok": true,
    "no_repeated_sections": true,
    "no_generic_filler": true,
    "no_broken_formatting": true,
    "chapter_flow_ok": true,
    "title_matches_content": true,
    "promise_delivered": true,
    "practical_tools_present": true,
    "disclaimers_present_when_required": true,
    "compliance_safe_language": true,
    "buyer_value_strong": true
  },
  "issues": ["short bullets, max 12"],
  "blocking_issues": ["only issues serious enough to block publish"],
  "fix_instructions_per_chapter": [{ "chapter_index": 1, "instructions": "..." }]
}`;

function wc(text: string) { return text?.trim() ? text.trim().split(/\s+/).length : 0; }

async function scoreManuscript(model: string, ebook: any, chapters: { chapter_index: number; title: string; content: string; word_count: number }[]) {
  const outline = ebook.outline_json ?? {};
  // Send chapter samples (truncated) to fit token budget
  const samples = chapters.map((c) =>
    `### Ch ${c.chapter_index}: ${c.title} (${c.word_count} words)\n${(c.content ?? "").slice(0, 2200)}…`
  ).join("\n\n");
  const totalWords = chapters.reduce((s, c) => s + (c.word_count ?? 0), 0);
  const disclaimerRequired = !!outline.disclaimer_required;

  return aiJSON<ManuscriptQC>({
    model,
    schemaHint: SCHEMA,
    system: PREMIUM_WRITER_SYSTEM + `

You are the FINAL manuscript reviewer for a premium paid PDF ebook. Be brutal. Score the whole book on:
- Final Content Depth · Reader Value · Practical Tool · Editorial Polish · Compliance Safety · Refund Risk · Final Manuscript Score
Also fill the boolean checklist honestly:
- total word count >= ${MIN_WORDS}
- no repeated sections / paragraphs / filler
- no generic AI-sounding filler ("in today's fast-paced world", "unlock the secrets", etc.)
- no broken markdown / formatting
- chapter flow is logical
- title matches the actual content
- promise from the outline is delivered
- practical tools (checklists, templates, worksheets, step-by-step actions) are present in chapters
- disclaimers are present when ${disclaimerRequired ? "REQUIRED (regulated topic)" : "not required"}
- compliance-safe language (no guarantees, no personalized advice)
- buyer value is strong enough to justify the price

If a check fails, list it in "issues" and (if serious) "blocking_issues". For each weak chapter, give specific fix_instructions_per_chapter.
Refund risk: 0 = no buyer would refund · 100 = refunds guaranteed.`,
    user: `Title: ${ebook.title}
Subtitle: ${ebook.subtitle ?? ""}
Target Buyer: ${ebook.target_buyer ?? ""}
Promise: ${outline.promise_statement ?? ""}
Disclaimer required: ${disclaimerRequired}
Total word count: ${totalWords} (minimum ${MIN_WORDS})

Chapter samples (truncated for token budget — judge based on what you see plus consistency across chapters):
${samples}

Return JSON only matching the schema.`,
  });
}

async function rewriteChapter(model: string, ebook: any, ch: { chapter_index: number; title: string; content: string }, instructions: string, wordsTarget: number) {
  const outline = ebook.outline_json ?? {};
  const oc = (outline.chapters ?? []).find((x: any) => x.index === ch.chapter_index) ?? {};
  const disclaimer = outline.disclaimer_required
    ? "\nThis is a regulated topic. Educational language only. No personalized advice."
    : "";
  return aiText({
    model,
    system: PREMIUM_WRITER_SYSTEM + disclaimer,
    user: `You are fixing one chapter of a premium ebook based on final manuscript QC feedback.

Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}
Reader: ${ebook.target_buyer ?? ""}

Chapter ${ch.chapter_index}: "${ch.title}"
Objective: ${oc.objective ?? ""}
Key teaching points: ${(oc.key_teaching_points ?? []).join(" | ")}

FIX INSTRUCTIONS: ${instructions}

Previous chapter content (rewrite/improve it to fix the issues — keep what works, fix what doesn't):
"""
${(ch.content ?? "").slice(0, 14000)}
"""

HARD REQUIREMENT: at least ${wordsTarget} words. Keep the 7-beat structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). Do not start with the word "Chapter". Return the full chapter body only — no headers like "Chapter X".`,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (error || !ebook) throw new Error("Ebook not found");

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? MIN_WORDS);
    const scoreModel = pickModel(mode, "qc");
    const fixModel = pickModel(mode, "content");

    async function loadChapters() {
      const { data } = await db.from("ebook_chapters")
        .select("chapter_index,title,content,word_count").eq("ebook_id", ebook_id).order("chapter_index");
      return (data ?? []) as { chapter_index: number; title: string; content: string; word_count: number }[];
    }

    await db.from("ebooks").update({
      pipeline_status: "final_qc",
      writing_status: "final_qc",
      manuscript_qc_status: "running",
    }).eq("id", ebook.id);

    let chapters = await loadChapters();
    if (!chapters.length) throw new Error("No chapters to QC. Run write-chapters first.");

    let totalCost = 0;
    let fixes = Number(ebook.manuscript_fix_count ?? 0);
    let qc: ManuscriptQC | null = null;
    let pass = false;

    for (let attempt = 0; attempt <= 2; attempt++) {
      const total = chapters.length;
      const wordsTarget = Math.max(1800, Math.ceil((minWords * 1.2) / Math.max(total, 1)));

      const s = await scoreManuscript(scoreModel, ebook, chapters);
      totalCost += s.usage.cost_usd;
      qc = s.data;
      await logCost(db, { ebook_id: ebook.id, step: `manuscript_qc${attempt ? `:fix${attempt}` : ""}`, model: s.model, ...s.usage });

      // Hard override: enforce word-count check from server side
      const totalWords = chapters.reduce((sum, c) => sum + (c.word_count ?? 0), 0);
      if (totalWords < minWords) {
        qc.checks.word_count_ok = false;
        qc.issues = [...(qc.issues ?? []), `Total word count ${totalWords} < ${minWords}`];
        qc.blocking_issues = [...(qc.blocking_issues ?? []), `Word count ${totalWords} < ${minWords}`];
      }

      pass = qc.final_manuscript_score >= PASS_MANUSCRIPT && qc.compliance_safety_score >= PASS_COMPLIANCE && qc.checks.word_count_ok;
      await logRun(db, {
        ebook_id: ebook.id, step: "final_manuscript_qc",
        status: pass ? "ok" : (attempt >= 2 ? "fail" : "rewrite"),
        score: qc.final_manuscript_score, rewrite_count: attempt, cost_usd: totalCost, payload: qc as any,
      });

      if (pass || attempt === 2) break;

      // Auto-fix worst chapters per fix_instructions_per_chapter
      const targets = (qc.fix_instructions_per_chapter ?? []).filter((x) => x.instructions);
      if (targets.length === 0) {
        // Fall back: short overall instructions → re-run scoring won't help; bail.
        break;
      }
      for (const t of targets) {
        const ch = chapters.find((c) => c.chapter_index === t.chapter_index);
        if (!ch) continue;
        const r = await rewriteChapter(fixModel, ebook, ch, t.instructions, wordsTarget);
        totalCost += r.usage.cost_usd;
        await logCost(db, { ebook_id: ebook.id, step: `manuscript_fix_ch${t.chapter_index}:r${attempt + 1}`, model: r.model, ...r.usage });
        const newContent = r.data;
        const newWc = wc(newContent);
        await db.from("ebook_chapters").update({
          content: newContent, word_count: newWc,
          rewrite_count: (ch as any).rewrite_count ? (ch as any).rewrite_count + 1 : 1,
        }).eq("ebook_id", ebook.id).eq("chapter_index", t.chapter_index);
      }
      fixes++;
      chapters = await loadChapters();
    }

    const totalWords = chapters.reduce((s, c) => s + (c.word_count ?? 0), 0);
    const finalStatus = pass ? "manuscript_passed" : "needs_review";
    const writingStatus = pass ? "manuscript_passed" : "needs_review";
    const pipelineStatus = pass ? "pdf_design" : "final_qc";

    await db.from("ebooks").update({
      final_manuscript_qc: qc as any,
      final_manuscript_score: qc?.final_manuscript_score ?? null,
      reader_value_score: qc?.reader_value_score ?? null,
      practical_tool_score: qc?.practical_tool_score ?? null,
      editorial_polish_score: qc?.editorial_polish_score ?? null,
      refund_risk_score: qc?.refund_risk_score ?? null,
      compliance_safety_score: qc?.compliance_safety_score ?? null,
      final_quality_score: qc?.final_manuscript_score ?? null,
      content_depth_score: qc?.final_content_depth_score ?? null,
      manuscript_fix_count: fixes,
      manuscript_qc_status: finalStatus,
      qc_status: finalStatus,
      total_word_count: totalWords,
      word_count: totalWords,
      writing_status: writingStatus,
      pipeline_status: pipelineStatus,
      status: pass ? "ready_for_qc" : "needs_review",
      rejection_reason: pass ? null : `Final QC failed after ${fixes} auto-fix attempts: ${(qc?.blocking_issues ?? qc?.issues ?? []).slice(0, 3).join("; ")}`,
      cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
    }).eq("id", ebook.id);

    return new Response(JSON.stringify({ ok: true, pass, fixes, qc, total_word_count: totalWords }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
