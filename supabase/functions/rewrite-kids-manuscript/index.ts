// Rewrite a children's picture-book manuscript into the industry-standard
// 14-spread (32-page) layout, then reset ebook_chapters so render-pdf produces
// a proper storybook.
//
// POST { ebook_id }
//
// Uses the locked Story Bible (kids_visual_bible) so tone, character, world
// and moral stay consistent with the cover and existing illustrations.

import { admin, corsHeaders, logCost } from "../_shared/ai.ts";
import { resolveTrack, wrongTrackResponse } from "../_shared/track-registry.ts";
import { loadStoryCraftBlock } from "../_shared/story-craft-skill.ts";
import { writeSegmentedManuscript } from "../_shared/kids-segments.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  try {
    const { ebook_id } = await req.json().catch(() => ({}));
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await db.from("ebooks").select(
      "id, title, subtitle, storefront_title, storefront_subtitle, hook, product_description, target_buyer, kids_visual_bible, kids_scene_briefs_json, product_type, category_id"
    ).eq("id", ebook_id).maybeSingle();
    if (error || !ebook) return json({ error: "ebook not found" }, 404);

    // Track guard — refuse to rewrite adult ebooks as kids picture books.
    let categorySlug: string | null = null;
    if ((ebook as any).category_id) {
      const { data: cat } = await db.from("categories").select("slug").eq("id", (ebook as any).category_id).maybeSingle();
      categorySlug = cat?.slug ?? null;
    }
    const track = resolveTrack(ebook as any, categorySlug);
    if (track !== "kids") {
      console.log("rewrite-kids-manuscript: refusing non-kids ebook", { ebook_id, track });
      return wrongTrackResponse(ebook_id, "kids", track, corsHeaders, "rewrite-kids-manuscript");
    }

    const title = ebook.storefront_title || ebook.title || "Untitled";
    const subtitle = ebook.storefront_subtitle || ebook.subtitle || "";
    const bible = (ebook.kids_visual_bible ?? {}) as Record<string, any>;
    const heroName = bible?.characters?.[0]?.name || "the hero";

    const skillBlock = await loadStoryCraftBlock(db, '4-6');
    const descHint = `${ebook.hook || ebook.product_description || ""} Hero: ${heroName}. World: ${bible?.world || ""}. Moral (implicit only): ${bible?.moral_lesson || bible?.story_theme || ""}.`;

    const result = await writeSegmentedManuscript({
      title,
      subtitle,
      description: descHint,
      ageBand: '4-6',
      target: 28,
      heroName,
      extraCraftBlock: skillBlock,
    });

    if (!result.ok) {
      return json({ error: `segmented_writer_gate_failed`, violations: result.validation.violations, attempts: result.attempts }, 502);
    }

    await logCost(db, { ebook_id, step: "kids_manuscript_rewrite", model: result.model, input_tokens: 0, output_tokens: 0, cost_usd: 0 });

    const spreads = result.manuscript.pages.map((p, i) => ({
      spread_number: p.page ?? i + 1,
      scene_title: `Page ${i + 1}`,
      story_text: p.text,
      scene_summary: p.text.slice(0, 240),
      characters_present: [heroName],
      emotion: "",
      location: "",
      continuity_notes: "",
    }));

    // Reset ebook_chapters with one row per page (1:1 with segments).
    const { error: delErr } = await db.from("ebook_chapters").delete().eq("ebook_id", ebook_id);
    if (delErr) throw delErr;

    const rows = spreads.map((s, i) => ({
      ebook_id,
      chapter_index: i + 1,
      title: s.scene_title,
      content: s.story_text,
      brief: s.scene_summary,
      metadata: { kids_spread: true, characters_present: s.characters_present },
    }));
    const { error: insErr } = await db.from("ebook_chapters").insert(rows);
    if (insErr) throw insErr;

    const pagePlan: Record<string, unknown> = {
      version: 4,
      total_spreads: spreads.length,
      total_pages: spreads.length + 4,
      format: 'square_8.5x8.5',
      refrain: result.manuscript.refrain,
      spreads,
      segments: result.manuscript,
    };
    await db.from("ebooks").update({
      kids_scene_briefs_json: pagePlan as unknown as never,
      word_count: spreads.reduce((n, s) => n + (s.story_text?.split(/\s+/).length ?? 0), 0),
    }).eq("id", ebook_id);

    return json({ ok: true, spreads: spreads.length, model: result.model, attempts: result.attempts, refrain: result.manuscript.refrain });
  } catch (e) {
    console.error("rewrite-kids-manuscript failed:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
