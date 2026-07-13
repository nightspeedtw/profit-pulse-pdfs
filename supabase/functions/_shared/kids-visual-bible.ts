// Kids Picture Book Visual Bible.
// Single source of truth for character look + art style shared by cover
// generation AND every interior chapter illustration. Guarantees the same
// character (fur, outfit, eyes, proportions) shows up on the cover and inside
// the PDF instead of each step inventing a new look.

import { admin, aiJSON, logCost } from "./ai.ts";

export interface KidsCharacter {
  name: string;
  species: string;
  invariant_features: string; // MUST be repeated verbatim in every image prompt
  proportions: string;
}

export interface KidsVisualBible {
  art_style: string;
  palette: string[];
  characters: KidsCharacter[];
  world: string;
  negative: string;
  logo_treatment?: string;
}

const KIDS_REGEX = /\b(kid|kids|child|children|picture[-\s]?book|storybook|illustrated[-\s]?story|nursery|bedtime|ages?\s*\d\s*[-–]\s*\d)\b/i;

export function isKidsPictureBook(input: {
  title?: string | null;
  subtitle?: string | null;
  category?: string | null;
  category_slug?: string | null;
  hook?: string | null;
}): boolean {
  const haystack = [
    input.title,
    input.subtitle,
    input.category,
    input.category_slug,
    input.hook,
  ].filter(Boolean).join(" ");
  return KIDS_REGEX.test(haystack);
}

const BIBLE_SYSTEM = `You are the art director for a premium children's picture-book publisher (Peppa Pig / Bluey / Paddington / The Gruffalo tier).

Return a JSON "Visual Bible" that will be reused for the cover AND every interior illustration of a single book. Every subsequent image prompt will inject "invariant_features" verbatim so the character looks identical across all pages. Be extremely specific and unambiguous — no vague adjectives.

Rules:
- Choose ONE consistent art medium (e.g. "soft watercolor storybook with visible paper texture", "gouache on warm cream", "digital-watercolor children's picture book").
- Palette: 4-6 warm hex colors, storybook-friendly, no harsh neon.
- Characters: 1 primary hero. Optional 1-2 supporting. Each MUST specify: species, exact fur/skin color (name + hex), eye color, distinct clothing with color + material + one memorable detail (button, patch, scarf pattern), proportions (toddler-sized big head short limbs, etc.), one signature identifier (chipped tooth, freckle, cowlick).
- World: a single setting description with 3-4 recurring props.
- Negative: hard constraints that must NEVER appear (no text, no scary tones, no extra unnamed characters, no photorealism, no modern tech, etc.).

Return ONLY valid JSON matching:
{
  "art_style": "",
  "palette": ["#hex","#hex","#hex","#hex"],
  "characters": [
    {"name":"","species":"","invariant_features":"","proportions":""}
  ],
  "world": "",
  "negative": "",
  "logo_treatment": "hand-illustrated title logo in the same medium as the art, letters incorporate story motifs, never a plain font"
}`;

export async function buildKidsVisualBible(input: {
  ebook_id: string;
  title: string;
  subtitle?: string | null;
  target_buyer?: string | null;
  hook?: string | null;
  chapters?: { title?: string | null; content?: string | null }[];
}): Promise<KidsVisualBible> {
  const db = admin();
  const chapterDigest = (input.chapters ?? [])
    .slice(0, 8)
    .map((c, i) => `Ch ${i + 1}: ${c.title ?? ""} — ${(c.content ?? "").slice(0, 200).replace(/\s+/g, " ")}`)
    .join("\n");

  const ai = await aiJSON<KidsVisualBible>({
    model: "google/gemini-3.1-pro-preview",
    system: BIBLE_SYSTEM,
    user: `Book Title: ${input.title}
Subtitle: ${input.subtitle ?? ""}
Target Reader: ${input.target_buyer ?? "children ages 4-7"}
Story Promise: ${input.hook ?? ""}

Chapter Digest:
${chapterDigest}

Build the Visual Bible. Be so specific that a different illustrator could re-draw the character identically from your description alone.`,
  });

  await logCost(db, {
    ebook_id: input.ebook_id,
    step: "kids_visual_bible",
    model: ai.model,
    ...ai.usage,
  });

  const bible = normalizeBible(ai.data);
  await db.from("ebooks").update({
    kids_visual_bible: bible as unknown as never,
  }).eq("id", input.ebook_id);

  return bible;
}

function normalizeBible(b: Partial<KidsVisualBible>): KidsVisualBible {
  return {
    art_style: b.art_style || "soft watercolor storybook illustration with visible paper texture, warm sun-dappled lighting",
    palette: (b.palette && b.palette.length >= 3) ? b.palette : ["#F6E3C5", "#8FB77A", "#D97742", "#3B2A1A"],
    characters: (b.characters && b.characters.length > 0) ? b.characters : [{
      name: "Hero",
      species: "small forest animal",
      invariant_features: "small round animal, warm chestnut-brown fur, cream muzzle, big amber eyes",
      proportions: "toddler-sized, big head, short limbs",
    }],
    world: b.world || "sunlit woodland clearing with mossy stones, pinecones, and ferns",
    negative: b.negative || "no text, no letters, no logos, no photorealism, no scary tones, no extra unnamed characters, no modern technology",
    logo_treatment: b.logo_treatment || "hand-illustrated title logo in the same medium as the art, letters incorporate story motifs",
  };
}

export async function getOrBuildKidsVisualBible(input: {
  ebook_id: string;
  existing: unknown;
  title: string;
  subtitle?: string | null;
  target_buyer?: string | null;
  hook?: string | null;
  chapters?: { title?: string | null; content?: string | null }[];
}): Promise<KidsVisualBible> {
  const existing = input.existing as Partial<KidsVisualBible> | null | undefined;
  if (existing && existing.characters && existing.characters.length > 0 && existing.art_style) {
    return normalizeBible(existing);
  }
  return buildKidsVisualBible(input);
}

/**
 * Build a deterministic image prompt for ANY kids illustration (cover or
 * interior). Every character description is injected verbatim so the same
 * character appears identically across pages.
 */
export function kidsIllustrationPrompt(
  bible: KidsVisualBible,
  sceneBrief: string,
  opts?: { reservedZone?: string; role?: "cover" | "interior" },
): string {
  const chars = bible.characters.map((c) =>
    `${c.name} (${c.species}): ${c.invariant_features}. Proportions: ${c.proportions}.`
  ).join(" ");
  const palette = bible.palette.slice(0, 6).join(", ");
  const reserved = opts?.reservedZone
    ? ` Leave clear negative space in the ${opts.reservedZone} for typography to be added later.`
    : "";
  const roleClause = opts?.role === "cover"
    ? " Composition suitable for a picture-book front cover: single strong hero moment, cinematic warm light, storybook charm."
    : " Composition suitable for an interior storybook page: character-focused, clear action, expressive body language.";

  return `${bible.art_style}. Palette: ${palette}. Setting: ${bible.world}.
CHARACTERS (draw EXACTLY as described, do not change any feature): ${chars}
SCENE: ${sceneBrief}.${roleClause}${reserved}
HARD CONSTRAINTS: ${bible.negative}. Absolutely no text, no letters, no numbers, no words, no typography of any kind in the image. No book mockup, no UI, no logo, no watermark.`;
}

const SCENE_BRIEF_SYSTEM = `You write one-sentence visual scene briefs for children's picture-book interior illustrations. Focus on WHAT the hero character is doing and where. Do NOT invent new characters. Do NOT include dialogue or text. Return JSON only.`;

export async function generateSceneBriefs(input: {
  ebook_id: string;
  bible: KidsVisualBible;
  chapters: { index: number; title: string; content: string }[];
}): Promise<Record<number, string>> {
  const db = admin();
  const heroName = input.bible.characters[0]?.name ?? "the hero";
  const digest = input.chapters
    .map((c) => `Ch ${c.index}: ${c.title} — ${(c.content ?? "").slice(0, 400).replace(/\s+/g, " ")}`)
    .join("\n");

  const ai = await aiJSON<{ briefs: { chapter_index: number; brief: string }[] }>({
    model: "google/gemini-3.1-flash-preview",
    system: SCENE_BRIEF_SYSTEM,
    user: `Hero character: ${heroName}
Bible characters allowed: ${input.bible.characters.map((c) => c.name).join(", ")}
World: ${input.bible.world}

Chapters:
${digest}

For each chapter, return one short scene brief (max 25 words) describing what ${heroName} is doing and where. Use ONLY characters listed above.

Return: {"briefs":[{"chapter_index":1,"brief":"..."}, ...]}`,
  });
  await logCost(db, {
    ebook_id: input.ebook_id,
    step: "kids_scene_briefs",
    model: ai.model,
    ...ai.usage,
  });

  const out: Record<number, string> = {};
  for (const b of ai.data.briefs ?? []) {
    out[b.chapter_index] = b.brief;
  }
  await db.from("ebooks").update({
    kids_scene_briefs_json: out as unknown as never,
  }).eq("id", input.ebook_id);
  return out;
}
