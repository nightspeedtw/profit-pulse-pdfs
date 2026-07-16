// coloring-book-start — creates the canonical ebooks_kids row for a
// coloring book. Does NOT begin generation; sits in `queued` behind
// Sequential Safe Mode until P0 closes.
//
// Body: {
//   category_key: string,
//   title: string,
//   age_band?: "3-5" | "4-6" | "6-8",
//   page_count?: 24 | 32 | 48
// }

// @ts-nocheck  Edge runtime.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadColoringCategory } from "../_shared/coloring/category.ts";
import { DEFAULT_KIDS_4_6_STYLE } from "../_shared/coloring/style-contract.ts";
import { generatePagePlan, validatePagePlan } from "../_shared/coloring/page-plan.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const category_key: string = body.category_key;
    const title: string = body.title;
    const angle: string | null = body.angle ?? null;
    const variant_number: number = Number(body.variant_number ?? 1) || 1;
    const age_band: string = body.age_band ?? "4-6";
    const page_count: number = Number(body.page_count ?? 32);
    if (!category_key || !title) {
      return json({ error: "category_key and title required" }, 400);
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const category = await loadColoringCategory(sb, category_key);
    const pagePlan = generatePagePlan({ ...category, coloring_page_count: page_count });
    const planIssues = validatePagePlan(pagePlan.plan, category);
    const blocking = planIssues.filter((i) =>
      i.code === "DUPLICATE_CONCEPT" || i.code === "OUT_OF_CATEGORY" || i.code === "FORBIDDEN_SUBJECT"
    );
    if (blocking.length > 0) {
      return json({ error: "page_plan_invalid", issues: blocking }, 422);
    }
    const styleContract = DEFAULT_KIDS_4_6_STYLE;

    const { data, error } = await sb
      .from("ebooks_kids")
      .insert({
        title,
        book_type: "coloring_book",
        pipeline_status: "queued",
        metadata: {
          coloring_category_key: category.category_key,
          coloring_age_band: age_band,
          coloring_page_count: page_count,
          coloring_angle: angle,
          coloring_variant: variant_number,
          coloring_progress_percent: 5,
          coloring_current_step_label: "Queued — waiting for coloring worker to dispatch",
          coloring_theme_bible: {
            category_key: category.category_key,
            category_name: category.category_name,
            allowed_subjects: category.allowed_subjects,
            forbidden_subjects: category.forbidden_subjects,
          },
          coloring_page_plan: pagePlan,
          coloring_style_contract: styleContract,
          coloring_workflow_version: "v1",
        },
      })
      .select("id")
      .single();
    if (error) throw error;
    return json({ ok: true, ebook_id: data.id, note: "queued for coloring worker" });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
