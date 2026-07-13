// Kids Picture Book — Story Bible + Consistency Lock (Master Add-On Skill).
//
// Single source of truth for character look, outfits, illustration style, palette,
// and world shared by cover generation AND every interior chapter illustration.
// Guarantees the same character (fur, outfit, eyes, proportions, accessory)
// shows up on the cover and inside the PDF instead of each step inventing a
// new look. Enforces the rules from the Children's Storybook Consistency Lock
// skill: face/body/outfit/palette/style must never drift page-to-page.

import { admin, aiJSON, logCost } from "./ai.ts";

// ---------- Public types ----------

export interface KidsCharacter {
  name: string;
  // Deprecated single-string form (kept for back-compat with v1 bibles).
  invariant_features?: string;
  proportions?: string;
  // Full character-design lock (v2).
  role?: string;
  species: string;
  age_feel?: string;
  personality?: string;
  body_shape?: string;
  face_shape?: string;
  eye_shape?: string;
  eye_color?: string;
  hair_or_fur_style?: string;
  hair_or_fur_color?: string;
  skin_or_body_color?: string;
  outfit?: string;
  signature_accessory?: string;
  unique_identifying_features?: string[];
  do_not_change?: string[];
}

export interface KidsStyleGuide {
  style_name?: string;
  line_quality?: string;
  coloring_method?: string;
  texture_level?: string;
  shading_style?: string;
  background_detail_level?: string;
  character_proportions?: string;
  mood?: string;
  brush_style?: string;
  edge_style?: string;
  lighting_style?: string;
  page_composition_style?: string;
}

export interface KidsVisualBible {
  // Book-level
  book_title?: string;
  target_age_range?: string;
  reading_level?: string;
  story_theme?: string;
  moral_lesson?: string;
  emotional_tone?: string;
  // Style (single source of truth for cover + interior).
  art_style: string;
  palette: string[];
  line_art_style?: string;
  rendering_style?: string;
  visual_style_guide?: KidsStyleGuide;
  // Characters
  characters: KidsCharacter[];
  // World
  world: string;
  // Constraints
  negative: string;
  forbidden_style_drift?: string[];
  continuity_rules?: string[];
  logo_treatment?: string;
  version?: number;
}

// ---------- Detection ----------

const KIDS_REGEX = /\b(kid|kids|child|children|toddler|little\s+one|picture[-\s]?book|storybook|illustrated[-\s]?story|nursery|bedtime|ages?\s*\d\s*[-–]\s*\d|preschool|kindergarten)\b/i;

export function isKidsPictureBook(input: {
  title?: string | null;
  subtitle?: string | null;
  category?: string | null;
  category_slug?: string | null;
  hook?: string | null;
  product_description?: string | null;
  kids_visual_bible?: unknown;
}): boolean {
  const bible = input.kids_visual_bible as { characters?: unknown[] } | null | undefined;
  if (bible && Array.isArray(bible.characters) && bible.characters.length > 0) return true;
  const haystack = [
    input.title, input.subtitle, input.category, input.category_slug,
    input.hook, input.product_description,
  ].filter(Boolean).join(" ");
  return KIDS_REGEX.test(haystack);
}

// ---------- LLM bible builder ----------

const BIBLE_SYSTEM = `You are the art director + story bible editor for a premium children's picture-book publisher (Peppa Pig / Bluey / Paddington / The Gruffalo tier).

Return a JSON "Story Bible" that will be reused for the cover AND every interior illustration of a single book. Every subsequent image prompt will inject the character block and style block VERBATIM so the character looks identical across all pages and the whole book feels illustrated by the same artist. Be extremely specific and unambiguous — no vague adjectives.

Rules:
- Choose ONE consistent illustration style (e.g. "soft watercolor storybook with visible paper texture", "warm gouache on cream", "clean rounded vector storybook"). This style is locked for cover + every interior page.
- Palette: 4-6 warm hex colors, storybook-friendly, no harsh neon.
- Characters: 1 primary hero. Optional 1-2 supporting. For EACH character fill every field: species, age_feel, personality, body_shape, face_shape, eye_shape, eye_color, hair_or_fur_style, hair_or_fur_color, skin_or_body_color, outfit (with color + material + one memorable detail like a button/patch), signature_accessory, unique_identifying_features (1-3 items like chipped tooth / freckle / cowlick), do_not_change (list the features that must NEVER be redrawn differently).
- Also fill "invariant_features" with a single compact paragraph of the same character — a concatenation of the locked features. This gets injected verbatim into every image prompt.
- World: a single setting description with 3-4 recurring props.
- Negative: hard constraints that must NEVER appear (no text, no scary tones, no extra unnamed characters, no photorealism, no modern tech, etc.).
- forbidden_style_drift: 3-5 phrases the illustrator must avoid (e.g. "no shift to 3D render", "no photographic lighting", "no anime style").
- continuity_rules: 3-5 short rules for the book (e.g. "hero always wears the yellow scarf", "story always set during warm afternoon light").

Return ONLY valid JSON matching:
{
  "book_title": "",
  "target_age_range": "",
  "story_theme": "",
  "moral_lesson": "",
  "emotional_tone": "",
  "art_style": "",
  "line_art_style": "",
  "rendering_style": "",
  "palette": ["#hex","#hex","#hex","#hex"],
  "visual_style_guide": {
    "style_name": "", "line_quality": "", "coloring_method": "", "texture_level": "",
    "shading_style": "", "background_detail_level": "", "character_proportions": "",
    "mood": "", "brush_style": "", "edge_style": "", "lighting_style": "", "page_composition_style": ""
  },
  "characters": [
    {
      "name": "", "role": "", "species": "", "age_feel": "", "personality": "",
      "body_shape": "", "face_shape": "", "eye_shape": "", "eye_color": "",
      "hair_or_fur_style": "", "hair_or_fur_color": "", "skin_or_body_color": "",
      "outfit": "", "signature_accessory": "",
      "unique_identifying_features": [], "do_not_change": [],
      "proportions": "", "invariant_features": ""
    }
  ],
  "world": "",
  "negative": "",
  "forbidden_style_drift": [],
  "continuity_rules": [],
  "logo_treatment": "hand-illustrated title logo in the same medium as the art"
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

Build the Story Bible. Be so specific that a different illustrator could re-draw every character identically from your description alone. Every field is required.`,
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

// ---------- Normalization + back-compat ----------

function fallbackInvariant(c: KidsCharacter): string {
  if (c.invariant_features && c.invariant_features.trim().length > 0) return c.invariant_features;
  const parts = [
    c.species,
    c.age_feel,
    c.body_shape,
    c.face_shape && `${c.face_shape} face`,
    c.eye_shape && c.eye_color ? `${c.eye_shape} ${c.eye_color} eyes` : (c.eye_color && `${c.eye_color} eyes`),
    c.hair_or_fur_style && c.hair_or_fur_color ? `${c.hair_or_fur_style} ${c.hair_or_fur_color} fur/hair` : c.hair_or_fur_color,
    c.skin_or_body_color && `${c.skin_or_body_color} skin/body`,
    c.outfit && `wearing ${c.outfit}`,
    c.signature_accessory && `signature ${c.signature_accessory}`,
    (c.unique_identifying_features ?? []).join(", "),
  ].filter(Boolean);
  return parts.join(", ");
}

function normalizeCharacter(c: Partial<KidsCharacter>): KidsCharacter {
  const out: KidsCharacter = {
    name: c.name || "Hero",
    role: c.role,
    species: c.species || "small animal",
    age_feel: c.age_feel,
    personality: c.personality,
    body_shape: c.body_shape,
    face_shape: c.face_shape,
    eye_shape: c.eye_shape,
    eye_color: c.eye_color,
    hair_or_fur_style: c.hair_or_fur_style,
    hair_or_fur_color: c.hair_or_fur_color,
    skin_or_body_color: c.skin_or_body_color,
    outfit: c.outfit,
    signature_accessory: c.signature_accessory,
    unique_identifying_features: c.unique_identifying_features ?? [],
    do_not_change: c.do_not_change ?? [],
    proportions: c.proportions ?? "toddler-sized, big head, short limbs",
    invariant_features: c.invariant_features,
  };
  out.invariant_features = fallbackInvariant(out);
  return out;
}

function normalizeBible(b: Partial<KidsVisualBible>): KidsVisualBible {
  const chars = (b.characters && b.characters.length > 0)
    ? b.characters.map(normalizeCharacter)
    : [normalizeCharacter({
        name: "Hero",
        species: "small forest animal",
        invariant_features: "small round animal, warm chestnut-brown fur, cream muzzle, big amber eyes",
        proportions: "toddler-sized, big head, short limbs",
      })];
  return {
    book_title: b.book_title,
    target_age_range: b.target_age_range,
    reading_level: b.reading_level,
    story_theme: b.story_theme,
    moral_lesson: b.moral_lesson,
    emotional_tone: b.emotional_tone,
    art_style: b.art_style || "soft watercolor storybook illustration with visible paper texture, warm sun-dappled lighting",
    palette: (b.palette && b.palette.length >= 3) ? b.palette : ["#F6E3C5", "#8FB77A", "#D97742", "#3B2A1A"],
    line_art_style: b.line_art_style,
    rendering_style: b.rendering_style,
    visual_style_guide: b.visual_style_guide,
    characters: chars,
    world: b.world || "sunlit woodland clearing with mossy stones, pinecones, and ferns",
    negative: b.negative || "no text, no letters, no logos, no photorealism, no scary tones, no extra unnamed characters, no modern technology",
    forbidden_style_drift: b.forbidden_style_drift ?? [
      "no shift to 3D render", "no photographic lighting", "no anime style", "no glossy CGI look",
    ],
    continuity_rules: b.continuity_rules ?? [],
    logo_treatment: b.logo_treatment || "hand-illustrated title logo in the same medium as the art",
    version: 2,
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
  const isV2 = existing && (existing as { version?: number }).version === 2;
  const hasRichChar = existing?.characters?.some((c) =>
    !!(c.outfit || c.face_shape || c.eye_color || c.hair_or_fur_color),
  );
  if (existing && existing.characters && existing.characters.length > 0 && existing.art_style && (isV2 || hasRichChar)) {
    return normalizeBible(existing);
  }
  // v1 or missing → rebuild with the full lock.
  return buildKidsVisualBible(input);
}

// ---------- Prompt builders (character + style lock injected verbatim) ----------

function characterBlock(c: KidsCharacter): string {
  const lines: string[] = [];
  lines.push(`- ${c.name} (${c.species})${c.role ? ` — ${c.role}` : ""}:`);
  lines.push(`    Appearance: ${c.invariant_features}.`);
  if (c.outfit) lines.push(`    Outfit (LOCKED, must be identical every page): ${c.outfit}.`);
  if (c.signature_accessory) lines.push(`    Signature accessory (LOCKED): ${c.signature_accessory}.`);
  if (c.proportions) lines.push(`    Proportions: ${c.proportions}.`);
  if (c.do_not_change && c.do_not_change.length > 0) {
    lines.push(`    DO NOT CHANGE: ${c.do_not_change.join("; ")}.`);
  }
  return lines.join("\n");
}

function styleBlock(bible: KidsVisualBible): string {
  const g = bible.visual_style_guide ?? {};
  const rows = [
    `Art style: ${bible.art_style}`,
    bible.line_art_style && `Line art: ${bible.line_art_style}`,
    bible.rendering_style && `Rendering: ${bible.rendering_style}`,
    g.coloring_method && `Coloring: ${g.coloring_method}`,
    g.shading_style && `Shading: ${g.shading_style}`,
    g.texture_level && `Texture: ${g.texture_level}`,
    g.lighting_style && `Lighting: ${g.lighting_style}`,
    g.background_detail_level && `Backgrounds: ${g.background_detail_level}`,
    g.edge_style && `Edges: ${g.edge_style}`,
    `Palette (use only these): ${bible.palette.slice(0, 6).join(", ")}`,
  ].filter(Boolean);
  return rows.join("\n");
}

/**
 * Build a deterministic image prompt for ANY kids illustration (cover or
 * interior). Every character description + style rule is injected verbatim so
 * the same character appears identically across pages and the whole book
 * looks illustrated by one artist.
 */
export function kidsIllustrationPrompt(
  bible: KidsVisualBible,
  sceneBrief: string,
  opts?: { reservedZone?: string; role?: "cover" | "interior" },
): string {
  const chars = bible.characters.map(characterBlock).join("\n");
  const style = styleBlock(bible);
  const reserved = opts?.reservedZone
    ? `\nLeave clear negative space in the ${opts.reservedZone} for typography to be added later.`
    : "";
  const roleClause = opts?.role === "cover"
    ? "\nComposition: single strong front-cover hero moment, cinematic warm light, storybook charm."
    : "\nComposition: interior storybook page, character-focused, clear action, expressive body language.";
  const drift = (bible.forbidden_style_drift ?? []).join("; ");
  const continuity = (bible.continuity_rules ?? []).join("; ");

  return `Create a children's storybook illustration.
Use the locked Story Bible EXACTLY — do not redesign anything.

STYLE LOCK (identical to every other page of this book):
${style}

CHARACTER LOCK (draw exactly as described, same face, same outfit, same colors, same proportions on every page):
${chars}

WORLD: ${bible.world}
${continuity ? `CONTINUITY RULES: ${continuity}` : ""}

SCENE: ${sceneBrief}.${roleClause}${reserved}

HARD CONSTRAINTS: ${bible.negative}. ${drift ? `Avoid drift: ${drift}.` : ""}
Absolutely NO text, letters, numbers, words, typography, logos, watermarks, UI, or book-mockup inside the image. Title/typography will be added by the app afterwards.
The image MUST look like it belongs to the same children's book as every other page — same artist, same style, same character.`;
}

// ---------- Scene briefs (unchanged behaviour, richer prompt) ----------

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
    model: "google/gemini-3-flash-preview",
    system: SCENE_BRIEF_SYSTEM,
    user: `Hero character: ${heroName}
Bible characters allowed: ${input.bible.characters.map((c) => c.name).join(", ")}
World: ${input.bible.world}
Continuity rules: ${(input.bible.continuity_rules ?? []).join("; ")}

Chapters:
${digest}

For each chapter, return one short scene brief (max 25 words) describing what ${heroName} is doing and where. Use ONLY characters listed above. Respect the continuity rules.

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
