// Milestone 3 — Premium ebook outline generator with auto-QC + auto-improve.
// Input: { idea_id, ebook_id? }. Creates an ebook row if needed, then generates
// a premium outline JSON, scores it, and rewrites up to 2 times if any score < 80.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";
import { scoreOutline, outlineGate, TH, logRun } from "../_shared/qc.ts";

interface OutlineChapter {
  index: number;
  title: string;
  objective: string;
  key_teaching_points: string[];
  practical_examples: string[];
  worksheets_checklists_templates: string[];
}
interface OutlineJson {
  title: string;
  subtitle: string;
  target_buyer: string;
  promise_statement: string;
  disclaimer_required: boolean;
  disclaimer_text: string | null;
  table_of_contents: { index: number; title: string }[];
  chapters: OutlineChapter[];
  action_plan: { title: string; steps: string[] };
  bonus_section: { checklist: string; worksheet: string; templates: string; action_plan_7day: string };
}

const SCHEMA_HINT = `{
  "title": "string",
  "subtitle": "string",
  "target_buyer": "string",
  "promise_statement": "1 sentence transformation promise",
  "disclaimer_required": true,
  "disclaimer_text": "educational disclaimer if finance/health/legal/medical/relationship/investing — else null",
  "table_of_contents": [{ "index": 1, "title": "..." }],
  "chapters": [
    {
      "index": 1,
      "title": "...",
      "objective": "what reader can do after this chapter",
      "key_teaching_points": ["3-6 short bullets"],
      "practical_examples": ["2-4 named realistic scenarios"],
      "worksheets_checklists_templates": ["assets included in this chapter"]
    }
  ],
  "action_plan": { "title": "7-Day Action Plan", "steps": ["7 numbered steps"] },
  "bonus_section": { "checklist": "...", "worksheet": "...", "templates": "...", "action_plan_7day": "..." }
}`;

function compliance(topic: string): boolean {
  const t = topic.toLowerCase();
  return /(finance|invest|money|wealth|health|medical|legal|law|relationship|diet|weight|cure)/i.test(t);
}

async function generateOutline(model: string, idea: any): Promise<{ data: OutlineJson; usage: any; model: string }> {
  const needsDisclaimer = compliance([idea.title, idea.subtitle, idea.hook, idea.category_name].filter(Boolean).join(" "));
  return aiJSON<OutlineJson>({
    model,
    schemaHint: SCHEMA_HINT,
    system: PREMIUM_WRITER_SYSTEM + `\n\nYou are designing a PREMIUM PAID PDF EBOOK outline. The outline must read like a paid product, not a blog. Generate 8-12 chapters; each must deliver a specific transformation. No generic "Introduction" chapter.`,
    user: `Approved ebook idea:
Title: ${idea.title}
Subtitle: ${idea.subtitle ?? ""}
Target Buyer: ${idea.target_buyer ?? ""}
Hook: ${idea.hook ?? ""}
Core pain: ${idea.core_pain_point ?? ""}
Transformation promise: ${idea.transformation_promise ?? ""}

Design the full premium ebook outline. Use 8-12 chapters (aim 10). Each chapter MUST include an objective, key teaching points, practical examples, and any worksheets/checklists/templates the chapter delivers. Also produce an action plan and a bonus section.

${needsDisclaimer ? 'This topic is in a regulated area (finance/health/legal/medical/relationship). Set disclaimer_required=true and write a short educational disclaimer ("This guide is for educational purposes only and is not professional advice. Consult a qualified professional for your situation.").' : 'Set disclaimer_required=false and disclaimer_text=null.'}

Return JSON only.`,
  });
}

async function improveOutline(model: string, idea: any, previous: OutlineJson, weakness: string) {
  return aiJSON<OutlineJson>({
    model,
    schemaHint: SCHEMA_HINT,
    system: PREMIUM_WRITER_SYSTEM + `\n\nYou are improving a premium ebook outline. Fix the listed weaknesses. Keep chapters between 8-12. Strengthen practicality, depth, premium feel, buyer usefulness. Remove duplication.`,
    user: `Title: ${idea.title}
Target Buyer: ${idea.target_buyer ?? ""}
Hook: ${idea.hook ?? ""}

Previous outline (JSON):
${JSON.stringify(previous).slice(0, 8000)}

Weaknesses to fix: ${weakness}

Return the FULL improved outline JSON.`,
  });
}

function bonusesRecord(o: OutlineJson) {
  return {
    checklist: o.bonus_section?.checklist ?? "",
    worksheet: o.bonus_section?.worksheet ?? "",
    templates: o.bonus_section?.templates ?? "",
    action_plan_7day: o.bonus_section?.action_plan_7day ?? "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, ebook_id } = await req.json();
    if (!idea_id && !ebook_id) throw new Error("idea_id or ebook_id required");

    // Load or create ebook
    let ebook: any;
    if (ebook_id) {
      const { data, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
      if (error || !data) throw new Error("Ebook not found");
      ebook = data;
    } else {
      const { data: idea, error: ie } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
      if (ie || !idea) throw new Error("Idea not found");
      const { data: cat } = idea.category_id
        ? await db.from("categories").select("*").eq("id", idea.category_id).single()
        : { data: null };
      const price = Number(cat?.default_price ?? 24.99);
      const { data: created, error: ee } = await db.from("ebooks").insert({
        idea_id: idea.id,
        category_id: idea.category_id,
        title: idea.title,
        subtitle: idea.subtitle,
        target_buyer: idea.target_buyer,
        hook: idea.hook,
        status: "outline",
        pipeline_status: "outline_generation",
        writing_status: "outline_generating",
        price,
      }).select("*").single();
      if (ee || !created) throw new Error(`Failed to create ebook: ${ee?.message}`);
      ebook = created;
      await db.from("ebook_ideas").update({ status: "outline", pipeline_status: "outline_generation" }).eq("id", idea.id);
    }

    // Load idea for context
    const { data: idea } = await db.from("ebook_ideas").select("*").eq("id", ebook.idea_id).single();
    const { data: cat } = ebook.category_id
      ? await db.from("categories").select("name").eq("id", ebook.category_id).single()
      : { data: null };
    const ctx = { ...idea, category_name: cat?.name };

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const model = pickModel(mode, "content");

    await db.from("ebooks").update({ writing_status: "outline_generating", pipeline_status: "outline_generation" }).eq("id", ebook.id);

    let outlineRes = await generateOutline(model, ctx);
    await logCost(db, { ebook_id: ebook.id, step: "outline", model: outlineRes.model, ...outlineRes.usage });
    let totalCost = outlineRes.usage.cost_usd;
    let outline = outlineRes.data;

    let rewrites = 0;
    let scores = await scoreOutline(model, {
      title: outline.title,
      toc: outline.chapters.map((c) => ({ title: c.title, brief: c.objective })),
      bonuses: bonusesRecord(outline),
    });
    totalCost += scores.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: "outline_qc", model: scores.model, ...scores.usage });
    let gate = outlineGate(scores.data);
    await logRun(db, { ebook_id: ebook.id, step: "outline_qc", status: gate.pass ? "ok" : "rewrite", score: scores.data.structure_score, rewrite_count: 0, cost_usd: totalCost, payload: scores.data as any });

    while (!gate.pass && rewrites < 2) {
      rewrites++;
      const improved = await improveOutline(model, ctx, outline, gate.reason);
      totalCost += improved.usage.cost_usd;
      await logCost(db, { ebook_id: ebook.id, step: `outline_improve_${rewrites}`, model: improved.model, ...improved.usage });
      outline = improved.data;
      scores = await scoreOutline(model, {
        title: outline.title,
        toc: outline.chapters.map((c) => ({ title: c.title, brief: c.objective })),
        bonuses: bonusesRecord(outline),
      });
      totalCost += scores.usage.cost_usd;
      await logCost(db, { ebook_id: ebook.id, step: `outline_qc_${rewrites}`, model: scores.model, ...scores.usage });
      gate = outlineGate(scores.data);
      await logRun(db, { ebook_id: ebook.id, step: "outline_qc", status: gate.pass ? "ok" : "rewrite", score: scores.data.structure_score, rewrite_count: rewrites, cost_usd: totalCost, payload: scores.data as any });
    }

    const writing_status = gate.pass ? "outline_ready" : "needs_review";
    const qc_status = gate.pass ? "outline_passed" : "outline_failed";
    const pipeline_status = gate.pass ? "outline_generation" : "rejected";

    await db.from("ebooks").update({
      outline_json: outline as any,
      outline_qc: scores.data as any,
      outline_rewrite_count: rewrites,
      toc: outline.chapters.map((c) => ({ title: c.title, brief: c.objective })),
      bonuses: bonusesRecord(outline),
      title: outline.title,
      subtitle: outline.subtitle,
      target_buyer: outline.target_buyer,
      writing_status,
      qc_status,
      pipeline_status,
      rejection_reason: gate.pass ? null : `Outline QC failed after ${rewrites} rewrites: ${gate.reason}`,
      cost_usd: (Number(ebook.cost_usd ?? 0) + totalCost),
      status: gate.pass ? "outline" : "needs_review",
    }).eq("id", ebook.id);

    return new Response(JSON.stringify({ ebook_id: ebook.id, writing_status, qc_status, scores: scores.data, rewrites, outline }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
