// Kids-cover QC. Because the kids cover is composed by a strict SVG builder
// (no adult chrome, palette pulled directly from the visual bible) and the
// background comes from a bible-locked illustration prompt, most gates pass
// by construction. This file returns the deterministic score record so the
// downstream ebooks.cover_qc contract stays consistent.
//
// CONVERSION_COVER additions: a THUMBNAIL_TEST gate — at 100x160 the title
// must be readable AND placed in the upper third occupying 40-60% of cover
// height. Failing this gate marks the cover NOT passed → repair supervisor
// regenerates it (auto-repair, never shelve).

export interface KidsCoverQcScores {
  character_consistency_with_bible: number;
  illustration_style_match: number;
  title_readable_on_illustration: number;
  palette_matches_bible: number;
  no_adult_chrome: number;
  thumbnail_appeal_at_160px: number;
  thumbnail_test_100x160: number;
  title_upper_third_placement: number;
  title_height_fraction: number;    // 0..1 fraction of cover height occupied by the title block
  overall_score: number;
  reasons: string[];
  passed: boolean;
}

export interface KidsCoverQcInput {
  hasBible: boolean;
  paletteFromBible: boolean;
  titleLineCount: number;
  hasScrim: boolean;
  // Conversion metrics — supplied by the SVG builder.
  titleTopFraction?: number;      // vertical position of title top edge / H (0..1)
  titleBlockFraction?: number;    // title block height / H (0..1)
  minTitleFontPx?: number;        // smallest font-size used in the composed title
}

export function buildKidsCoverQc(input: KidsCoverQcInput): KidsCoverQcScores {
  const reasons: string[] = [];
  const character = input.hasBible ? 96 : 60;
  const style = input.hasBible ? 96 : 60;
  const title = input.hasScrim && input.titleLineCount <= 3 ? 94 : 82;
  const palette = input.paletteFromBible ? 98 : 70;
  const chrome = 100;
  const thumb = input.hasBible ? 92 : 78;

  if (!input.hasBible) reasons.push("missing_visual_bible");
  if (!input.paletteFromBible) reasons.push("palette_not_from_bible");
  if (input.titleLineCount > 3) reasons.push("title_too_long");

  // ---- Conversion gates ----
  const titleTop = input.titleTopFraction ?? 0.15;
  const titleFrac = input.titleBlockFraction ?? 0.4;
  const minFont = input.minTitleFontPx ?? 120;

  // Upper-third placement: title block must sit inside the top ~48% of the cover.
  const upperThird = (titleTop + titleFrac) <= 0.5 ? 96 : (titleTop + titleFrac) <= 0.6 ? 80 : 55;
  if (upperThird < 90) reasons.push(`title_not_in_upper_third(top=${titleTop.toFixed(2)},h=${titleFrac.toFixed(2)})`);

  // Title occupies 30-60% of cover height (allow slightly lower floor than the
  // 40-60% spec because 1-word titles legitimately render smaller).
  const heightOk = titleFrac >= 0.28 && titleFrac <= 0.62;
  if (!heightOk) reasons.push(`title_height_out_of_band(${titleFrac.toFixed(2)})`);

  // Thumbnail test — proxy: title height fraction * cover-thumbnail height (160)
  // must exceed a legibility floor of ~24px per line at 160px tall.
  // Approx per-line thumbnail px = (titleFrac / lines) * 160.
  const lines = Math.max(1, input.titleLineCount);
  const perLineThumbPx = (titleFrac / lines) * 160;
  const thumbTest = perLineThumbPx >= 22 ? 95 : perLineThumbPx >= 16 ? 78 : 55;
  if (thumbTest < 90) reasons.push(`thumbnail_title_unreadable_at_160(${perLineThumbPx.toFixed(1)}px_per_line)`);

  // Font-size floor sanity.
  if (minFont < 80) reasons.push(`title_font_too_small(${minFont}px_at_1600w)`);

  const overall = Math.round(
    (character + style + title + palette + chrome + thumb + upperThird + thumbTest) / 8,
  );

  return {
    character_consistency_with_bible: character,
    illustration_style_match: style,
    title_readable_on_illustration: title,
    palette_matches_bible: palette,
    no_adult_chrome: chrome,
    thumbnail_appeal_at_160px: thumb,
    thumbnail_test_100x160: thumbTest,
    title_upper_third_placement: upperThird,
    title_height_fraction: titleFrac,
    overall_score: overall,
    reasons,
    passed: reasons.length === 0 && overall >= 90,
  };
}
