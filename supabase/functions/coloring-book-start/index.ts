// coloring-book-start — creates the canonical ebooks_kids row for a
// coloring book. Does NOT begin generation; sits in `queued` behind
// Sequential Safe Mode until P0 closes.
//
// Body: {
//   category_key: string,
//   title: string,
//   age_band?: "3-5" | "4-6" | "6-8",
//   page_count?: 4 | 16 | 24 | 32 | 48   (4 = mini_test format)
// }

// @ts-nocheck  Edge runtime.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadColoringCategory } from "../_shared/coloring/category.ts";
import { DEFAULT_KIDS_4_6_STYLE } from "../_shared/coloring/style-contract.ts";
import { resolveStyleContractForDbBand } from "../_shared/coloring/age-bands.ts";
import { generatePagePlan, validatePagePlan } from "../_shared/coloring/page-plan.ts";

declare const Deno: any;

import { TRIM_PROFILES, type TrimProfileKey } from "../_shared/coloring/trim-lock.ts";

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
    // Phase A (2026-07-19): every new coloring row is stamped with a trim
    // profile. Default = square_8_5 (owner directive). Callers may pin
    // `letter_portrait` explicitly for legacy-shape test dispatches.
    const trim_profile_raw: string = body.trim_profile ?? "square_8_5";
    if (!(trim_profile_raw in TRIM_PROFILES)) {
      return json({
        error: `trim_profile must be one of ${Object.keys(TRIM_PROFILES).join("|")}`,
      }, 400);
    }
    const trim_profile = trim_profile_raw as TrimProfileKey;
    if (![4, 16, 24, 32, 48].includes(page_count)) {
      return json({ error: "page_count must be 4, 16, 24, 32, or 48" }, 400);
    }
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
    // Age-band contract resolution (owner directive, 2026-07-19 wave):
    // Every book must ship the contract calibrated for its band. Bands
    // without a distinct contract PARK as `band_defaults_missing` — no
    // silent fallback to 4_6. Callers may pass `age_band` as a DB band
    // key (e.g. "2_3") or a library key (e.g. "2-4"); we try DB-map first.
    let styleContract = DEFAULT_KIDS_4_6_STYLE;
    let resolvedBandKey: string = age_band;
    const dbResolved = resolveStyleContractForDbBand(age_band);
    if (dbResolved) {
      styleContract = dbResolved.contract;
      resolvedBandKey = dbResolved.band_key;
    } else if (String(age_band).includes("_")) {
      // Looked like a DB band key but no calibrated contract → PARK row.
      const { data: parked, error: parkErr } = await sb
        .from("ebooks_kids")
        .insert({
          title,
          book_type: "coloring_book",
          pipeline_status: "parked_rotated",
          blocker_reason: "band_defaults_missing",
          metadata: {
            trim_profile,
            coloring_category_key: category.category_key,
            coloring_age_band: age_band,
            coloring_page_count: page_count,
            coloring_current_step_label: `Parked: no calibrated contract for band ${age_band}`,
            band_defaults_missing: {
              requested_band: age_band,
              at: new Date().toISOString(),
              note: "AGE_BAND_DEFAULTS has no distinct contract for this DB band; add one before re-dispatching.",
            },
          },
        })
        .select("id")
        .single();
      if (parkErr) throw parkErr;
      return json({
        ok: true,
        parked: true,
        ebook_id: parked.id,
        blocker_reason: "band_defaults_missing",
        note: `no calibrated style contract for band '${age_band}' — parked honestly`,
      });
    }

    const { data, error } = await sb
      .from("ebooks_kids")
      .insert({
        title,
        book_type: "coloring_book",
        pipeline_status: "queued",
        metadata: {
          trim_profile,
          coloring_category_key: category.category_key,
          coloring_age_band: resolvedBandKey,
          coloring_age_band_input: age_band,
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
          coloring_format: page_count <= 4 ? "mini_test" : "standard",
        },
      })
      .select("id")
      .single();
    if (error) throw error;
    return json({ ok: true, ebook_id: data.id, trim_profile, note: "queued for coloring worker" });
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
