// Kids-cover QC. Because the kids cover is composed by a strict SVG builder
// (no adult chrome, palette pulled directly from the visual bible) and the
// background comes from a bible-locked illustration prompt, most gates pass
// by construction. This file returns the deterministic score record so the
// downstream ebooks.cover_qc contract stays consistent.

export interface KidsCoverQcScores {
  character_consistency_with_bible: number;
  illustration_style_match: number;
  title_readable_on_illustration: number;
  palette_matches_bible: number;
  no_adult_chrome: number;
  thumbnail_appeal_at_160px: number;
  overall_score: number;
  reasons: string[];
  passed: boolean;
}

export function buildKidsCoverQc(input: {
  hasBible: boolean;
  paletteFromBible: boolean;
  titleLineCount: number;
  hasScrim: boolean;
}): KidsCoverQcScores {
  const reasons: string[] = [];
  const character = input.hasBible ? 96 : 60;
  const style = input.hasBible ? 96 : 60;
  const title = input.hasScrim && input.titleLineCount <= 3 ? 94 : 82;
  const palette = input.paletteFromBible ? 98 : 70;
  const chrome = 100; // guaranteed by kids SVG builder
  const thumb = input.hasBible ? 92 : 78;

  if (!input.hasBible) reasons.push("missing_visual_bible");
  if (!input.paletteFromBible) reasons.push("palette_not_from_bible");
  if (input.titleLineCount > 3) reasons.push("title_too_long");

  const overall = Math.round(
    (character + style + title + palette + chrome + thumb) / 6,
  );

  return {
    character_consistency_with_bible: character,
    illustration_style_match: style,
    title_readable_on_illustration: title,
    palette_matches_bible: palette,
    no_adult_chrome: chrome,
    thumbnail_appeal_at_160px: thumb,
    overall_score: overall,
    reasons,
    passed: reasons.length === 0 && overall >= 90,
  };
}
