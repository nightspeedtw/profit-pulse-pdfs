// Rewrite a children's picture-book manuscript into the industry-standard
// 14-spread (32-page) layout, then reset ebook_chapters so render-pdf produces
// a proper storybook.
//
// POST { ebook_id }
//
// Uses the locked Story Bible (kids_visual_bible) so tone, character, world
// and moral stay consistent with the cover and existing illustrations.

import { admin, aiJSON, corsHeaders, logCost } from "../_shared/ai.ts";
import { resolveTrack, wrongTrackResponse } from "../_shared/track-registry.ts";

type Spread = {
  spread_number: number;
  scene_title: string;
  story_text: string;
  scene_summary: string;
  characters_present: string[];
  emotion: string;
  location: string;
  continuity_notes: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  try {
    const { ebook_id } = await req.json().catch(() => ({}));
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await db.from("ebooks").select(
      "id, title, subtitle, shopify_title, shopify_subtitle, hook, product_description, target_buyer, kids_visual_bible, kids_scene_briefs_json, product_type, category_id"
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

    const title = ebook.shopify_title || ebook.title || "Untitled";
    const subtitle = ebook.shopify_subtitle || ebook.subtitle || "";
    const bible = (ebook.kids_visual_bible ?? {}) as Record<string, any>;
    const heroName = bible?.characters?.[0]?.name || "the hero";
    const heroDesc = bible?.characters?.[0]?.invariant_features || "";
    const world = bible?.world || "";
    const moral = bible?.moral_lesson || bible?.story_theme || "";

    const system = `You are a professional children's picture-book author writing for ages 4-7.
Follow the "Children's Storybook Consistency Lock" skill: age-appropriate warm read-aloud voice,
short sentences, sensory detail, gentle rhythm, implicit moral (never preachy), satisfying resolution.
Return valid JSON only. No markdown.`;

    const user = `Write a 14-spread picture-book manuscript for the industry-standard 32-page format
(1 cover page + 1 copyright + 1 half-title + 14 story spreads (28 pages) + 1 back page = 32 pages).

Book title: "${title}"
Subtitle: "${subtitle}"
Story promise: ${ebook.hook || ebook.product_description || ""}
Hero: ${heroName} — ${heroDesc}
World: ${world}
Implicit moral: ${moral}
Target reader: ages 4-7

Rules:
- 14 spreads total. Each spread has ONE short paragraph of read-aloud story text.
- 35-65 words per spread. 550-900 words total for the whole book.
- Grade-1/2 vocabulary. Short sentences. Warm, gentle, curious tone.
- Clear arc: opening (spreads 1-3), rising problem (4-8), turning point/climax (9-11), resolution (12-14).
- Never mention adult topics, tech, brands, or scary imagery.
- Never write the moral as a lecture — show it through the character's actions.
- Use ${heroName} by name; refer to them consistently.
- Each spread also includes a short scene_title (max 4 words) used only internally,
  a scene_summary for the illustrator, characters_present (names), emotion, location,
  and continuity_notes (what must match previous spreads: outfit, palette, world).

Return: {"spreads":[{"spread_number":1,"scene_title":"","story_text":"","scene_summary":"","characters_present":[],"emotion":"","location":"","continuity_notes":""}, ... 14 items ...]}`;

    const ai = await aiJSON<{ spreads: Spread[] }>({
      model: "google/gemini-3.1-pro-preview",
      system,
      user,
      maxTokens: 6000,
      timeoutMs: 180_000,
    });

    await logCost(db, { ebook_id, step: "kids_manuscript_rewrite", model: ai.model, ...ai.usage });

    const spreads = (ai.data.spreads ?? []).slice(0, 14);
    if (spreads.length < 14) {
      return json({ error: `AI returned only ${spreads.length} spreads (need 14)`, raw: ai.data }, 502);
    }

    // Reset ebook_chapters with 14 rows, one per spread.
    const { error: delErr } = await db.from("ebook_chapters").delete().eq("ebook_id", ebook_id);
    if (delErr) throw delErr;

    const rows = spreads.map((s, i) => ({
      ebook_id,
      chapter_index: i + 1,
      title: s.scene_title || `Spread ${i + 1}`,
      content: s.story_text,
      brief: s.scene_summary,
      metadata: {
        kids_spread: true,
        characters_present: s.characters_present ?? [],
        emotion: s.emotion ?? "",
        location: s.location ?? "",
        continuity_notes: s.continuity_notes ?? "",
      },
    }));
    const { error: insErr } = await db.from("ebook_chapters").insert(rows);
    if (insErr) throw insErr;

    // Persist structured page plan for the illustrator and future QC.
    const pagePlan: Record<string, unknown> = {
      version: 2,
      total_spreads: 14,
      total_pages: 32,
      spreads,
    };
    await db.from("ebooks").update({
      kids_scene_briefs_json: pagePlan as unknown as never,
      word_count: spreads.reduce((n, s) => n + (s.story_text?.split(/\s+/).length ?? 0), 0),
    }).eq("id", ebook_id);

    return json({ ok: true, spreads: spreads.length, model: ai.model });
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
