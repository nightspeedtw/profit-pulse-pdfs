// Generate interior visual spec (framework diagrams + worksheets/checklists) for an ebook.
// Code-rendered later by build-pdf using pdf-lib shapes — no AI image generation per visual.
import { corsHeaders, admin, aiJSON, logCost, requireAdmin } from "../_shared/ai.ts";

export interface FrameworkDiagram {
  visual_name: string;
  chapter: string;
  purpose: string;
  type: "process_flow" | "pyramid" | "matrix_2x2" | "circle_cycle" | "before_after" | "comparison_table" | "checklist";
  nodes: string[];
  labels?: { x_axis?: [string, string]; y_axis?: [string, string] };
}
export interface Worksheet {
  asset_name: string;
  chapter: string;
  purpose: string;
  fields_or_sections: string[];
}
export interface InteriorVisuals {
  interior_visual_strategy: string;
  recommended_visual_count: number;
  chapter_divider_style: string;
  framework_diagrams: FrameworkDiagram[];
  worksheets_and_templates: Worksheet[];
  visual_qc_checklist: string[];
  why_these_visuals_increase_sales_value: string;
}

const SYSTEM = `You are a premium PDF ebook art director and instructional designer.
Decide what visuals belong inside a premium paid PDF to boost perceived value, comprehension, and conversion.
Only practical visuals: frameworks, diagrams, process maps, checklists, worksheets, comparison tables, action plans.
NEVER recommend stock decorative images.
Return JSON only.

Each framework_diagram MUST be one of these renderable types:
- "process_flow": linear 3-7 step process. nodes = ordered steps.
- "pyramid": 3-5 layers, bottom→top. nodes = layers bottom-first.
- "matrix_2x2": 4 quadrants. nodes = [Q1_topleft, Q2_topright, Q3_bottomleft, Q4_bottomright]. labels.x_axis & y_axis required.
- "circle_cycle": 4-6 nodes around a cycle.
- "before_after": [before_state, after_state].
- "comparison_table": nodes = ["row1col1","row1col2","row2col1","row2col2",...] in pairs.
- "checklist": 5-12 checklist items.

Keep node labels under 60 chars. No misleading financial/health/legal claims.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");
    const { data: e } = await db.from("ebooks")
      .select("id,title,target_buyer,hook,toc,chapters,bonuses,category_id,cost_usd")
      .eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");

    const category = e.category_id
      ? (await db.from("categories").select("name").eq("id", e.category_id).maybeSingle()).data?.name
      : null;

    const toc = (e.toc ?? []) as { title: string; brief?: string }[];
    const chapterSummaries = ((e.chapters ?? []) as { title: string; content: string }[])
      .map((c, i) => `Ch ${i + 1}: ${c.title} — ${(c.content ?? "").slice(0, 220).replace(/\s+/g, " ")}`)
      .join("\n");

    const ai = await aiJSON<InteriorVisuals>({
      model: "google/gemini-3.1-pro-preview",
      system: SYSTEM,
      user: `Ebook Title: ${e.title}
Category: ${category ?? "general"}
Target Buyer: ${e.target_buyer ?? ""}
Transformation Promise: ${e.hook ?? ""}

Table of Contents:
${toc.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}

Chapter Summaries:
${chapterSummaries}

Recommend interior visuals. Output:
{
  "interior_visual_strategy": "",
  "recommended_visual_count": 0,
  "chapter_divider_style": "minimal_accent_bar",
  "framework_diagrams": [
    {"visual_name":"","chapter":"Ch 2","purpose":"","type":"process_flow","nodes":["step 1","step 2","step 3"]}
  ],
  "worksheets_and_templates": [
    {"asset_name":"","chapter":"Ch 5","purpose":"","fields_or_sections":["",""]}
  ],
  "visual_qc_checklist": ["",""],
  "why_these_visuals_increase_sales_value": ""
}

Provide 3-5 framework_diagrams and 5-10 worksheets_and_templates.`,
    });

    await logCost(db, { ebook_id, step: "interior_visuals", model: ai.model, ...ai.usage });
    await db.from("ebooks").update({
      interior_visuals: ai.data as unknown as never,
      cost_usd: Number(e.cost_usd ?? 0) + ai.usage.cost_usd,
    }).eq("id", ebook_id);

    return new Response(JSON.stringify({ ok: true, visuals: ai.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
