// Kids-track QC gates. Enforces the Children's Storybook Consistency Lock:
// character consistency, illustration-style consistency, story continuity,
// age appropriateness, and cover-to-interior match — all ≥ 95 (hard fail).

export interface KidsScores {
  character_consistency: number;      // face/body/outfit page-to-page
  illustration_style_consistency: number;
  story_continuity: number;
  age_appropriateness: number;
  cover_to_interior_match: number;
  emotional_flow: number;
  moral_clarity: number;
  language_naturalness: number;
  final_children_book_quality: number;
  issues?: string[];
  notes?: string;
}

export const KIDS_TH = {
  character_consistency: 95,
  illustration_style_consistency: 95,
  story_continuity: 95,
  age_appropriateness: 95,
  cover_to_interior_match: 95,
  emotional_flow: 90,
  moral_clarity: 90,
  language_naturalness: 90,
  final_children_book_quality: 90,
  maxImageRegenPerSpread: 3,
  maxManuscriptRewrites: 2,
} as const;

export function kidsManuscriptGate(s: Partial<KidsScores>): { pass: boolean; reason: string } {
  const reasons: string[] = [];
  if ((s.story_continuity ?? 0) < KIDS_TH.story_continuity) reasons.push("story_continuity <95");
  if ((s.age_appropriateness ?? 0) < KIDS_TH.age_appropriateness) reasons.push("age_appropriateness <95");
  if ((s.emotional_flow ?? 0) < KIDS_TH.emotional_flow) reasons.push("emotional_flow <90");
  if ((s.moral_clarity ?? 0) < KIDS_TH.moral_clarity) reasons.push("moral_clarity <90");
  if ((s.language_naturalness ?? 0) < KIDS_TH.language_naturalness) reasons.push("language_naturalness <90");
  return { pass: reasons.length === 0, reason: reasons.join("; ") };
}

export function kidsVisualGate(s: Partial<KidsScores>): { pass: boolean; reason: string } {
  const reasons: string[] = [];
  if ((s.character_consistency ?? 0) < KIDS_TH.character_consistency) reasons.push("character_consistency <95");
  if ((s.illustration_style_consistency ?? 0) < KIDS_TH.illustration_style_consistency) reasons.push("illustration_style <95");
  return { pass: reasons.length === 0, reason: reasons.join("; ") };
}

export function kidsPublishGate(s: Partial<KidsScores>): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if ((s.character_consistency ?? 0) < KIDS_TH.character_consistency) reasons.push("character_consistency <95");
  if ((s.illustration_style_consistency ?? 0) < KIDS_TH.illustration_style_consistency) reasons.push("illustration_style <95");
  if ((s.story_continuity ?? 0) < KIDS_TH.story_continuity) reasons.push("story_continuity <95");
  if ((s.age_appropriateness ?? 0) < KIDS_TH.age_appropriateness) reasons.push("age_appropriateness <95");
  if ((s.cover_to_interior_match ?? 0) < KIDS_TH.cover_to_interior_match) reasons.push("cover_to_interior_match <95");
  if ((s.final_children_book_quality ?? 0) < KIDS_TH.final_children_book_quality) reasons.push("final_children_book_quality <90");
  return { pass: reasons.length === 0, reasons };
}
