// Milestone 3 — Chapter writing engine. Writes a single chapter (or all)
// for an ebook, runs chapter QC, and auto-rewrites up to 2 times if any
// chapter score is below 80. Writes to ebook_chapters.
import { corsHeaders, admin, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";
import { scoreChapter, chapterGate, TH, logRun } from "../_shared/qc.ts";

interface OutlineChapter {
  index: number;
  title: string;
  objective: string;
  key_teaching_points: string[];
  practical_examples?: string[];
  worksheets_checklists_templates?: string[];
}

// Map either the legacy outline shape OR the new strict premium schema
// (chapter_number / chapter_title / chapter_promise / learning_outcomes /
// sections / worksheet / framework) into the legacy OutlineChapter the
// chapter writer expects. This keeps downstream writers stable while the
// outline generator evolves.
function adaptChapter(c: any, fallbackIndex: number): OutlineChapter {
  const index = Number(c?.index ?? c?.chapter_number ?? c?.number ?? fallbackIndex);
  const title = String(c?.title ?? c?.chapter_title ?? `Chapter ${index}`);
  const objective = String(c?.objective ?? c?.chapter_promise ?? c?.promise ?? "");
  const learning = Array.isArray(c?.key_teaching_points)
    ? c.key_teaching_points.map(String)
    : Array.isArray(c?.learning_outcomes) ? c.learning_outcomes.map(String) : [];
  const sectionPoints: string[] = Array.isArray(c?.sections)
    ? c.sections.flatMap((s: any) => [
      s?.section_title, s?.section_goal,
      ...(Array.isArray(s?.key_points) ? s.key_points : []),
    ]).filter(Boolean).map(String)
    : [];
  const practical: string[] = Array.isArray(c?.practical_examples)
    ? c.practical_examples.map(String)
    : sectionPoints.slice(0, 4);
  const tools: string[] = Array.isArray(c?.worksheets_checklists_templates)
    ? c.worksheets_checklists_templates.map(String)
    : [
      ...(c?.worksheet ? [`${c.worksheet.title ?? "Worksheet"} (${c.worksheet.type ?? "checklist"}) — ${c.worksheet.purpose ?? ""}`] : []),
      ...(c?.framework ? [`${c.framework.title ?? "Framework"} (${c.framework.type ?? "vertical_steps"}) — ${c.framework.purpose ?? ""}`] : []),
    ].filter(Boolean);
  return {
    index,
    title,
    objective,
    key_teaching_points: learning,
    practical_examples: practical,
    worksheets_checklists_templates: tools,
  };
}


function wc(text: string) {
  const t = text?.trim() ?? "";
  return t ? t.split(/\s+/).length : 0;
}

async function writeChapter(model: string, ebook: any, ch: OutlineChapter, wordsTarget: number, rewriteHint?: string) {
  const disclaimer = ebook.outline_json?.disclaimer_required
    ? "\nThis is a regulated topic. Use educational language only. Do not promise outcomes. No personalized advice."
    : "";
  const sys = PREMIUM_WRITER_SYSTEM + disclaimer;
  const user = `Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}
Reader: ${ebook.target_buyer ?? ""}
Hook: ${ebook.hook ?? ""}

Write Chapter ${ch.index}: "${ch.title}".
Objective: ${ch.objective}
Key teaching points: ${(ch.key_teaching_points ?? []).join(" | ")}
Practical examples to weave in: ${(ch.practical_examples ?? []).join(" | ")}
Worksheets/templates to include: ${(ch.worksheets_checklists_templates ?? []).join(" | ")}

HARD REQUIREMENT: minimum ${wordsTarget} words. Do not stop early.
Follow this chapter structure (the section beats, not literal headings unless they read well):
1) Chapter objective (one line)
2) Main teaching (the framework in plain English)
3) Practical example (realistic, named scenario)
4) Common mistake (what most people get wrong and why)
5) Step-by-step action (numbered)
6) Quick checklist (4-7 bullets)
7) Key takeaway (one sentence at the end)

Do not include the chapter number or the word "Chapter" in the body. Start with a hook paragraph that names the reader's specific pain.

${rewriteHint ? `IMPORTANT — fix these issues from the previous draft: ${rewriteHint}` : ""}`;
  return aiText({ model, system: sys, user });
}

async function processChapter(db: ReturnType<typeof admin>, ebook: any, ch: OutlineChapter, wordsTarget: number, model: string) {
  let rewrites = 0;
  let content = "";
  let scores: any = null;
  let gate = { pass: false, reason: "init" };
  let lastIssues = "";
  let cost = 0;

  // upsert chapter row in writing state
  await db.from("ebook_chapters").upsert({
    ebook_id: ebook.id,
    chapter_index: ch.index,
    title: ch.title,
    brief: ch.objective,
    pipeline_status: "writing",
    qc_status: "writing",
    rewrite_count: 0,
  }, { onConflict: "ebook_id,chapter_index" });

  while (!gate.pass && rewrites <= 2) {
    const r = await writeChapter(model, ebook, ch, wordsTarget, rewrites > 0 ? lastIssues : undefined);
    content = r.data;
    cost += r.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: `chapter:${ch.index}${rewrites ? `:rw${rewrites}` : ""}`, model: r.model, ...r.usage });

    const s = await scoreChapter(model, ch.title, content);
    cost += s.usage.cost_usd;
    scores = s.data;
    await logCost(db, { ebook_id: ebook.id, step: `chapter_qc:${ch.index}${rewrites ? `:rw${rewrites}` : ""}`, model: s.model, ...s.usage });
    gate = chapterGate(s.data);
    lastIssues = `${gate.reason}. Issues: ${(s.data.issues ?? []).join("; ")}`;

    await logRun(db, { ebook_id: ebook.id, step: `chapter_qc:${ch.index}`, status: gate.pass ? "ok" : (rewrites >= 2 ? "fail" : "rewrite"), score: s.data.buyer_value_score, rewrite_count: rewrites, cost_usd: cost, payload: s.data });

    if (gate.pass) break;
    if (rewrites >= 2) break;
    rewrites++;
  }

  const finalStatus = gate.pass ? "chapter_qc" : "rejected";
  const qcStatus = gate.pass ? "passed" : "failed";
  await db.from("ebook_chapters").update({
    content,
    word_count: wc(content),
    qc_scores: scores ?? {},
    rewrite_count: rewrites,
    pipeline_status: finalStatus,
    qc_status: qcStatus,
    rejection_reason: gate.pass ? null : gate.reason,
  }).eq("ebook_id", ebook.id).eq("chapter_index", ch.index);

  return { passed: gate.pass, rewrites, cost, scores, content };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id, chapter_index, all } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (error || !ebook) throw new Error("Ebook not found");
    const outline = ebook.outline_json as any;
    if (!outline?.chapters?.length) throw new Error("No outline yet — run generate-outline first.");

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? 18000);
    const adaptedChapters: OutlineChapter[] = (outline.chapters as any[]).map((c, i) => adaptChapter(c, i + 1));
    const total = adaptedChapters.length;
    const wordsTarget = Math.max(1800, Math.ceil((minWords * 1.2) / total));
    const model = pickModel(mode, "content");

    // Single-chapter mode (synchronous, ~30-90s)
    if (!all && typeof chapter_index === "number") {
      const ch: OutlineChapter | undefined = adaptedChapters.find((c) => c.index === chapter_index);
      if (!ch) throw new Error(`Chapter ${chapter_index} not found in outline`);
      await db.from("ebooks").update({ writing_status: "writing", pipeline_status: "writing" }).eq("id", ebook.id);
      const r = await processChapter(db, ebook, ch, wordsTarget, model);

      // Refresh totals
      const { data: rows } = await db.from("ebook_chapters").select("word_count,qc_status").eq("ebook_id", ebook.id);
      const totalWc = (rows ?? []).reduce((s, r) => s + Number(r.word_count ?? 0), 0);
      const done = (rows ?? []).filter((x) => x.qc_status === "passed").length;
      const allPassed = done === total;
      await db.from("ebooks").update({
        total_word_count: totalWc,
        word_count: totalWc,
        writing_status: r.passed ? (allPassed ? "manuscript_ready" : "writing") : "needs_review",
        pipeline_status: r.passed ? (allPassed ? "chapter_qc" : "writing") : "writing",
        qc_status: r.passed ? null : "needs_admin_review",
        rejection_reason: r.passed ? null : `Chapter ${chapter_index}: ${r.scores ? JSON.stringify(r.scores.issues ?? []) : "QC failed"}`,
        cost_usd: Number(ebook.cost_usd ?? 0) + r.cost,
      }).eq("id", ebook.id);

      return new Response(JSON.stringify({ ok: true, chapter_index, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All-chapter mode (background)
    await db.from("ebooks").update({ writing_status: "writing", pipeline_status: "writing" }).eq("id", ebook.id);

    const background = (async () => {
      try {
        let totalCost = 0;
        let allOk = true;
        for (const ch of adaptedChapters) {
          // Skip already-passed chapters (resume support)
          const { data: existing } = await db.from("ebook_chapters")
            .select("qc_status,word_count").eq("ebook_id", ebook.id).eq("chapter_index", ch.index).maybeSingle();
          if (existing?.qc_status === "passed" && (existing.word_count ?? 0) > 0) continue;



          const r = await processChapter(db, ebook, ch, wordsTarget, model);
          totalCost += r.cost;
          if (!r.passed) allOk = false;

          const { data: rows } = await db.from("ebook_chapters").select("word_count").eq("ebook_id", ebook.id);
          const totalWc = (rows ?? []).reduce((s, x) => s + Number(x.word_count ?? 0), 0);
          await db.from("ebooks").update({
            total_word_count: totalWc,
            word_count: totalWc,
            cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
          }).eq("id", ebook.id);

          if (!r.passed) {
            // Halt: do not continue to final manuscript until every chapter passes.
            await db.from("ebooks").update({
              writing_status: "needs_review",
              pipeline_status: "writing",
              qc_status: "needs_admin_review",
              rejection_reason: `Chapter ${ch.index} failed QC after 2 rewrites: ${r.scores ? (r.scores.issues ?? []).join("; ") : "unknown"}`,
            }).eq("id", ebook.id);
            return;
          }
        }
        await db.from("ebooks").update({
          writing_status: allOk ? "manuscript_ready" : "needs_review",
          pipeline_status: allOk ? "chapter_qc" : "writing",
          qc_status: allOk ? "qc_passed" : "needs_admin_review",
        }).eq("id", ebook.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("write-chapters background failed:", msg);
        await db.from("ebooks").update({
          writing_status: "needs_review",
          rejection_reason: `Writer error: ${msg}`,
        }).eq("id", ebook.id);
      }
    })();

    // @ts-ignore Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(background);

    return new Response(JSON.stringify({ ok: true, ebook_id: ebook.id, mode: "background", chapters: total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
