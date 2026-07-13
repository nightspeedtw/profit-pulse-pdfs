// Kids-cover-specific QC rubric applied at composition time.
// Judges the freshly-composed picture-book cover against the visual bible +
// storybook layout rules, NOT the adult finance-template rubric.

import { aiJSON } from "../ai.ts";
import type { KidsVisualBible } from "../kids-visual-bible.ts";

export interface KidsCoverQcScores {
  character_consistency_with_bible: number;
  illustration_style_match: number;
  title_readable_on_illustration: number;
  palette_matches_bible: number;
  no_adult_chrome: number;              // hard gate = 100
  thumbnail_appeal_at_160px: number;
  overall_score: number;
  reasons: string[];
  improvements: string[];
}

export const KIDS_COVER_TH = {
  character_consistency_with_bible: 95,
  illustration_style_match: 95,
  title_readable_on_illustration: 90,
  palette_matches_bible: 95,
  no_adult_chrome: 100,   // hard
  thumbnail_appeal_at_160px: 90,
  overall_minimum: 90,
} as const;

const KIDS_COVER_QC_SYSTEM = `You are a picture-book art director judging a fresh children's book cover.

Score each dimension 0-100. Be strict.

1. character_consistency_with_bible — Does the hero character look identical to the locked visual bible (species, fur/hair colour, eye colour, outfit, signature accessory, proportions)?
2. illustration_style_match — Same medium, line quality, brush, palette register as the bible's art_style?
3. title_readable_on_illustration — Is the title clearly legible against the illustration? Any contrast issues, overlap with character face, or missing scrim?
4. palette_matches_bible — Colours pulled from the bible's palette, no foreign gold/cyan finance-accent colours?
5. no_adult_chrome — HARD GATE. Must be 100 unless the cover shows ANY of: solid black background field, "EBOOK" text badge, condensed uppercase sans title, thin hairline horizontal rules, a row of 3-4 feature chip pills, accent bar spanning the width, finance/business layout. If ANY appear, score 0.
6. thumbnail_appeal_at_160px — Will it read and delight at Shopify thumbnail size (160px)?

Return JSON only:
{
  "character_consistency_with_bible": 0,
  "illustration_style_match": 0,
  "title_readable_on_illustration": 0,
  "palette_matches_bible": 0,
  "no_adult_chrome": 0,
  "thumbnail_appeal_at_160px": 0,
  "overall_score": 0,
  "reasons": ["short bullet list of what failed"],
  "improvements": ["specific hint per failure — e.g. 'move title down 100px', 'strengthen top scrim', 'regenerate bg — character eyes changed'"]
}`;

export async function judgeKidsCover(input: {
  title: string;
  bible: KidsVisualBible;
  coverPng: Uint8Array;
}): Promise<{ scores: KidsCoverQcScores; usage: { cost_usd: number }; model: string }> {
  const bibleSummary = {
    art_style: input.bible.art_style,
    palette: input.bible.palette,
    line_art_style: input.bible.line_art_style,
    rendering_style: input.bible.rendering_style,
    character: input.bible.characters?.[0]
      ? {
          name: input.bible.characters[0].name,
          species: input.bible.characters[0].species,
          outfit: input.bible.characters[0].outfit,
          hair_or_fur_color: input.bible.characters[0].hair_or_fur_color,
          eye_color: input.bible.characters[0].eye_color,
          signature_accessory: input.bible.characters[0].signature_accessory,
        }
      : null,
  };

  const b64 = (() => {
    const CHUNK = 8192;
    let bin = "";
    for (let i = 0; i < input.coverPng.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(input.coverPng.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
  })();

  const result = await aiJSON<KidsCoverQcScores>({
    model: "google/gemini-3.1-pro-preview",
    system: KIDS_COVER_QC_SYSTEM,
    user: `Book title: ${input.title}

Visual bible (must match):
${JSON.stringify(bibleSummary, null, 2)}

The composed cover PNG is attached. Judge it strictly against the bible and the 6 rules above.`,
    imageBase64: `data:image/png;base64,${b64}`,
  } as any);

  const s = result.data;
  return {
    scores: {
      character_consistency_with_bible: Number(s.character_consistency_with_bible ?? 0),
      illustration_style_match: Number(s.illustration_style_match ?? 0),
      title_readable_on_illustration: Number(s.title_readable_on_illustration ?? 0),
      palette_matches_bible: Number(s.palette_matches_bible ?? 0),
      no_adult_chrome: Number(s.no_adult_chrome ?? 0),
      thumbnail_appeal_at_160px: Number(s.thumbnail_appeal_at_160px ?? 0),
      overall_score: Number(s.overall_score ?? 0),
      reasons: Array.isArray(s.reasons) ? s.reasons : [],
      improvements: Array.isArray(s.improvements) ? s.improvements : [],
    },
    usage: result.usage,
    model: result.model,
  };
}

export function kidsCoverGate(s: KidsCoverQcScores): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.no_adult_chrome < KIDS_COVER_TH.no_adult_chrome) reasons.push("adult_chrome_detected");
  if (s.character_consistency_with_bible < KIDS_COVER_TH.character_consistency_with_bible) reasons.push("character_off_bible");
  if (s.illustration_style_match < KIDS_COVER_TH.illustration_style_match) reasons.push("style_drift");
  if (s.title_readable_on_illustration < KIDS_COVER_TH.title_readable_on_illustration) reasons.push("title_unreadable");
  if (s.palette_matches_bible < KIDS_COVER_TH.palette_matches_bible) reasons.push("palette_mismatch");
  if (s.thumbnail_appeal_at_160px < KIDS_COVER_TH.thumbnail_appeal_at_160px) reasons.push("thumbnail_weak");
  if (s.overall_score < KIDS_COVER_TH.overall_minimum) reasons.push("overall_below_90");
  return { passed: reasons.length === 0, reasons };
}
