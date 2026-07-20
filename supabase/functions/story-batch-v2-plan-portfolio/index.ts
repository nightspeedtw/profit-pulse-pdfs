// story-batch-v2-plan-portfolio
// Generates 50 unique, market-diverse concepts and inserts one `story_batch_v2_books`
// row per concept, keyed by (batch, age_band, slot_index). Idempotent: if the
// slot already exists, skips it.
//
// Uses one cheap-model call per age band (5 total) with structured JSON output.
// Enforces budget guard before EVERY provider call.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  adminClient,
  AGE_BAND_CONTRACT,
  AgeBand,
  assertBudget,
  BudgetCeilingError,
  chat,
  COST_ESTIMATE_CENTS,
  MODELS,
  recordCost,
  STORY_BATCH_V2_TAG,
} from "../_shared/story-batch-v2.ts";

const THEMES = [
  "friendship", "courage", "emotional regulation", "bedtime adventure",
  "animals", "dinosaurs", "space exploration", "ocean exploration",
  "magical forest", "gentle mystery", "science discovery", "robots",
  "nature", "family", "school adventure", "fantasy quest",
  "time travel", "future city", "mythical world", "environmental care",
];

function conceptPrompt(age: AgeBand, count: number, existing: string[]): string {
  const c = AGE_BAND_CONTRACT[age];
  return `You are a children's-publishing acquisitions editor. Design ${count} ORIGINAL, commercially-attractive English illustrated storybook concepts for the ${age.replace("age_", "ages ")} age band.

CONTRACT
- Tone: ${c.tone}
- Page format: 8.5x8.5 in, ${c.pageCount} total pages, ~${c.storyPages} story pages, ${c.wordsPerPage[0]}-${c.wordsPerPage[1]} words per page.
- Market: global English readers, parent-buyer + child-reader dual appeal.
- FORBIDDEN: imitation of Disney/Pixar/DreamWorks/Bluey/Peppa/Paw Patrol/Harry Potter/etc; living-artist styles; celebrities; recognizable protected characters; scary, explicit, drug, or unsafe content.

DIVERSITY
- Vary themes across this list, never all the same: ${THEMES.join(", ")}.
- Every title, subtitle, protagonist, setting, plot core, and visual identity must be unique.
- Avoid titles or plots resembling these already-planned works: ${existing.slice(0, 40).join(" | ") || "(none)"}.

OUTPUT: strict JSON object of shape
{
  "books": [
    {
      "slot_index": 0,
      "title": "...",                       // punchy, <= 45 chars
      "subtitle": "...",                    // optional, <= 70 chars
      "hook": "...",                        // 1-sentence commercial hook
      "synopsis": "...",                    // 3-4 sentence emotional arc
      "protagonist": "...",                 // name + one-line
      "setting": "...",                     // one-line
      "theme": "...",                       // pick from THEMES
      "keywords": ["...", "..."],           // 5-8 SEO keywords
      "category_tags": ["...", "..."],      // 2-4 BISAC-ish tags
      "parent_value": "...",                // why a parent buys it
      "differentiation_note": "..."         // how it differs from mainstream titles
    }
  ]
}

Return ${count} objects with slot_index 0..${count - 1}. No prose, no markdown fences.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = adminClient();

  try {
    const { batch_id } = await req.json();
    if (!batch_id) throw new Error("batch_id required");

    const { data: batch, error } = await supa
      .from("story_batch_v2_batches")
      .select("*")
      .eq("id", batch_id)
      .single();
    if (error || !batch) throw new Error(`batch not found: ${batch_id}`);
    if (batch.status === "blocked") throw new Error(`batch blocked: ${batch.blocker_reason}`);

    await supa.from("story_batch_v2_batches").update({ status: "portfolio_planning" }).eq("id", batch_id);

    const targets = batch.targets_by_age as Record<AgeBand, number>;
    const summary: Record<string, unknown> = {};

    // Existing titles across all age bands to feed exclusion list.
    const existingTitles: string[] = [];

    for (const [age, count] of Object.entries(targets) as [AgeBand, number][]) {
      if (!(age in AGE_BAND_CONTRACT) || count <= 0) continue;

      // How many slots already filled?
      const { data: filled } = await supa
        .from("story_batch_v2_books")
        .select("slot_index, title")
        .eq("batch_id", batch_id)
        .eq("age_band", age);
      const filledSlots = new Set((filled ?? []).map((r) => r.slot_index));
      const needed = count - filledSlots.size;
      if (needed <= 0) {
        summary[age] = { skipped: true, already: filledSlots.size };
        continue;
      }

      // Budget guard
      try {
        await assertBudget(batch_id, COST_ESTIMATE_CENTS.concept_planner);
      } catch (e) {
        if (e instanceof BudgetCeilingError) {
          await supa
            .from("story_batch_v2_batches")
            .update({ status: "blocked", blocker_reason: e.message })
            .eq("id", batch_id);
          summary[age] = { skipped: true, reason: "budget_ceiling" };
          break;
        }
        throw e;
      }

      const prompt = conceptPrompt(age, needed, existingTitles);
      const { parsed } = await chat({
        model: MODELS.cheapText,
        system: "You are a children's publishing acquisitions editor. Return strict JSON only.",
        user: prompt,
        json: true,
        temperature: 0.9,
      });

      await recordCost({
        batchId: batch_id,
        provider: "google",
        model: MODELS.cheapText,
        kind: "text",
        costCents: COST_ESTIMATE_CENTS.concept_planner,
        meta: { stage: "portfolio_planner", age, needed },
      });

      const books = (parsed as { books?: unknown[] } | undefined)?.books ?? [];
      if (!Array.isArray(books) || books.length === 0) {
        summary[age] = { error: "planner_returned_no_books" };
        continue;
      }

      const rows = books
        .filter((b: unknown): b is Record<string, unknown> => !!b && typeof b === "object")
        .slice(0, needed)
        .map((b, i) => {
          const slot = (typeof b.slot_index === "number" ? b.slot_index : i);
          const finalSlot = filledSlots.has(slot)
            ? [...Array(count).keys()].find((s) => !filledSlots.has(s)) ?? slot
            : slot;
          filledSlots.add(finalSlot);
          return {
            batch_id,
            age_band: age,
            slot_index: finalSlot,
            title: String(b.title ?? "").slice(0, 200),
            subtitle: b.subtitle ? String(b.subtitle).slice(0, 200) : null,
            hook: b.hook ? String(b.hook) : null,
            synopsis: b.synopsis ? String(b.synopsis) : null,
            protagonist: b.protagonist ? String(b.protagonist) : null,
            setting: b.setting ? String(b.setting) : null,
            theme: b.theme ? String(b.theme) : null,
            keywords: Array.isArray(b.keywords) ? b.keywords.map(String) : null,
            category_tags: Array.isArray(b.category_tags) ? b.category_tags.map(String) : null,
            parent_value: b.parent_value ? String(b.parent_value) : null,
            differentiation_note: b.differentiation_note ? String(b.differentiation_note) : null,
            stage: "concept_generation",
            is_pilot: filledSlots.size <= 2, // first 2 per age band flagged as pilots
          };
        });

      if (rows.length) {
        const { error: upErr } = await supa.from("story_batch_v2_books").upsert(rows, {
          onConflict: "batch_id,age_band,slot_index",
        });
        if (upErr) {
          summary[age] = { error: upErr.message };
          continue;
        }
        for (const r of rows) if (r.title) existingTitles.push(r.title);
      }

      summary[age] = { planned: rows.length };
    }

    // First pilot per age band flagged is_pilot=true
    for (const age of Object.keys(targets) as AgeBand[]) {
      const { data: firstBook } = await supa
        .from("story_batch_v2_books")
        .select("id")
        .eq("batch_id", batch_id)
        .eq("age_band", age)
        .order("slot_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstBook) {
        await supa.from("story_batch_v2_books").update({ is_pilot: true }).eq("id", firstBook.id);
      }
    }

    await supa.from("story_batch_v2_batches").update({ status: "pilot_running" }).eq("id", batch_id);

    console.log(`${STORY_BATCH_V2_TAG} portfolio planned for batch=${batch_id}`, summary);
    return new Response(JSON.stringify({ ok: true, batch_id, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${STORY_BATCH_V2_TAG} plan-portfolio fatal:`, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
