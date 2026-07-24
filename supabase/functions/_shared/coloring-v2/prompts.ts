// Coloring V2 prompt builders. Text-mode (concept/style-bible/page-plan)
// uses Lovable AI Gateway (Gemini 2.5 Pro). Image-mode uses Runware.
// @ts-nocheck

import { getAgeProfile, type V2AgeBand } from "./age-matrix.ts";

// ── System prompts ──────────────────────────────────────────────────────

export const CONCEPT_SYSTEM = `You design premium coloring-book concepts sold on Etsy/Amazon KDP.
Return JSON exactly matching the schema. The TITLE must be short (2-5 words), catchy for a parent scanning a thumbnail, thematic, and easy to spell. NO clichés like "Amazing", "Ultimate", "Fun". Prefer alliteration, sensory nouns, and evocative adjectives.`;

export const STYLE_BIBLE_SYSTEM = `You are the style director for a premium coloring book. Emit a Style Bible in JSON that any illustrator (or an image model) can follow to keep every page visually coherent. Focus on line-weight in px, palette mood (line art is black on white, but palette hints inform any color accents on the cover), motif inventory, decorative language, and forbidden visual traits.`;

export const PAGE_PLAN_SYSTEM = `You are planning individual coloring-book pages. Every page must be visually distinct — no two pages can share the same primary subject, framing, and composition. Return an array of pages in JSON matching the schema exactly. Each scene must be a self-contained illustration.`;

// ── Builders ────────────────────────────────────────────────────────────

export function buildConceptPrompt(theme: string, ageBand: V2AgeBand, pageCount: number) {
  const prof = getAgeProfile(ageBand);
  return `Design a premium coloring-book concept.

Theme: ${theme}
Target audience: ${prof.label}
Page count: ${pageCount}
Complexity level: ${prof.complexity}

Return JSON only:
{
  "title": "2-5 word catchy title, no clichés",
  "subtitle": "one short evocative line, 4-8 words, or empty string",
  "hero_subjects": ["3-6 hero subjects that anchor the book"],
  "motif_inventory": ["8-14 recurring visual motifs the illustrator will reuse across pages"],
  "parent_hook": "one sentence explaining why a parent would buy this for their ${prof.label} kid",
  "spelling_lock": "the title again, letter-for-letter — used for QC"
}`;
}

export function buildStyleBiblePrompt(concept: any, ageBand: V2AgeBand) {
  const prof = getAgeProfile(ageBand);
  return `Build the Style Bible for the coloring book "${concept.title}".

Concept: ${JSON.stringify(concept)}
Age band: ${prof.label}
Line-weight target: ${prof.lineWeightPx[0]}–${prof.lineWeightPx[1]} px on a 1088px canvas
Enclosed regions per page: ${prof.regions[0]}–${prof.regions[1]}
Complexity: ${prof.complexity}
Positive traits: ${prof.positive.join("; ")}
Forbidden traits: ${prof.negative.join("; ")}

Return JSON only:
{
  "line_weight_px": [min, max],
  "regions_per_page": [min, max],
  "decorative_language": "1-2 sentences describing recurring patterns, tessellations, borders",
  "motif_bank": ["12-20 concrete motifs the illustrator can drop into any page"],
  "palette_mood_words": ["6-10 mood words for the cover palette"],
  "forbidden_visual_traits": ["${prof.negative.join('", "')}"],
  "line_art_law": "black ink on white paper only, no gray fills, no shading, no cross-hatching that traps regions closed"
}`;
}

export function buildPagePlanPrompt(concept: any, styleBible: any, ageBand: V2AgeBand, pageCount: number) {
  const prof = getAgeProfile(ageBand);
  return `Plan ${pageCount} distinct coloring-book pages for "${concept.title}".

Concept: ${JSON.stringify(concept)}
Style Bible: ${JSON.stringify(styleBible)}
Age band: ${prof.label}

Rules:
- Every page must be visually distinct — different primary subject or radically different framing.
- Reuse motifs from the motif bank for coherence, but never repeat the same scene.
- Pages progress in visual rhythm: alternate close-up / mid / wide / decorative-pattern pages.
- No text inside any illustration. No page numbers inside art.
- Each page must obey the Style Bible's line-weight and region-count targets.

Return JSON only:
{
  "pages": [
    {
      "page_number": 1,
      "purpose": "hero opener | scene | pattern | portrait | vignette | finale",
      "scene": "1-2 sentence scene description",
      "focal_subject": "the primary subject",
      "action": "what the subject is doing / arrangement",
      "supporting": "supporting elements around the focal subject",
      "framing": "close-up | portrait | mid | wide | flat-lay | decorative-panel",
      "detail_target": "one of: ${prof.complexity}",
      "continuity": "which motifs from the motif bank appear",
      "forbidden": "explicit list of what NOT to include on this page"
    }
  ]
}

Emit exactly ${pageCount} pages.`;
}

// ── Image prompt builders ───────────────────────────────────────────────

export function buildInteriorImagePrompt(page: any, styleBible: any, ageBand: V2AgeBand): string {
  const prof = getAgeProfile(ageBand);
  const lw = styleBible?.line_weight_px ?? prof.lineWeightPx;
  const parts = [
    `Coloring book interior page for ${prof.label}, black-ink line art on pure white background.`,
    `Scene: ${page.scene}.`,
    `Focal subject: ${page.focal_subject}. Action/arrangement: ${page.action}. Supporting elements: ${page.supporting}.`,
    `Framing: ${page.framing}. Complexity: ${prof.complexity}.`,
    `Line weight: consistent ${lw[0]}–${lw[1]}px black strokes at 1088px canvas.`,
    `Enclosed regions: ${styleBible?.regions_per_page?.[0] ?? prof.regions[0]}–${styleBible?.regions_per_page?.[1] ?? prof.regions[1]} clearly separated closed regions kids can fill without ink bleeding across.`,
    `Positive traits: ${prof.positive.join("; ")}.`,
    `Decorative motifs from the motif bank if relevant: ${(styleBible?.motif_bank ?? []).slice(0, 8).join(", ")}.`,
    `Style Bible decorative language: ${styleBible?.decorative_language ?? ""}.`,
    `LINE-ART LAW: pure black outlines only, NO grayscale fills, NO shading, NO cross-hatching that traps a region closed, NO photo textures, NO watermark, NO logo, NO page number, NO text of any kind inside the illustration, NO signature.`,
    `ANATOMY LAW (anatomy_structure_constraints_v1): anatomically correct structure with flawless body proportions, natural relaxed posture, and believable weight/balance. Correct number of limbs; exactly FIVE distinct, separated fingers on each hand; properly connected joints (shoulder→elbow→wrist, hip→knee→ankle). Symmetrical, well-drawn facial features with accurate eye alignment. For fantasy creatures (mermaids, centaurs, dragons, fairies, unicorns, phoenixes, nagas, garudas, kinnari, multi-armed deities, nine-tailed foxes), blend hybrid anatomical elements with a natural biological flow — canonical mythical forms only, never random extra appendages or deformities.`,
    `Forbidden this page: ${page.forbidden ?? "none"}.`,
    `Global forbidden traits: ${(styleBible?.forbidden_visual_traits ?? prof.negative).join(", ")}.`,
    `Square 1:1 composition, edge-to-edge composition with 6% safe margin.`,
  ];
  return parts.join("\n");
}

// anatomy_structure_constraints_v1 (owner 2026-07-24): explicit negative
// vocabulary for limbs/hands/joints/faces + hybrid-creature deformities.
export const INTERIOR_NEGATIVE_PROMPT = [
  "color fills", "watercolor", "gray shading", "grayscale", "hatching", "cross-hatching",
  "photograph", "3d render", "realistic texture", "blurry lines", "messy background",
  "text", "letters", "watermark", "logo", "signature", "page number",
  // Limb / hand / finger / joint deformities
  "extra limbs", "missing arms", "missing legs", "extra legs", "extra arms",
  "mutated hands", "fused fingers", "extra fingers", "six fingers", "seven fingers",
  "four fingers on a human hand", "webbed human fingers", "melted fingers",
  "broken joints", "dislocated joints", "disconnected limbs", "floating limbs",
  "disembodied parts", "severed limbs",
  // Head / face deformities
  "two heads", "extra head", "duplicated head", "fused faces", "distorted face",
  "asymmetrical eyes", "misaligned eyes", "crossed eyes", "extra eyes",
  // Body deformities
  "fused limbs", "wrong number of legs", "wrong number of fins", "wrong number of arms",
  "deformed anatomy", "bad anatomy", "malformed body", "mangled anatomy",
  "twisted body", "unnatural twists", "frankenstein composition", "stitched body",
  "amorphous blob", "potato shape", "unrecognizable creature",
  // Hybrid-creature specific: keep canonical, avoid random appendages
  "random extra appendages on fantasy creature", "hybrid seams", "unnatural biological flow",
  // Coloring-book cleanliness
  "solid black fills", "solid black shapes",
].join(", ");
