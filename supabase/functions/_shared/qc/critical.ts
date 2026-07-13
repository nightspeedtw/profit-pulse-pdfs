// QC v2 — critical rule IDs. Any one = NOT SELLABLE.

export const CRITICAL_RULE_IDS = [
  "TEXT_OVERFLOW",
  "TEXT_CLIPPED",
  "TEXT_OUTSIDE_SAFE_AREA",
  "MISSING_PAGE",
  "BLANK_UNINTENDED_PAGE",
  "BROKEN_FONT_OR_GLYPH",
  "IMAGE_MISSING",
  "IMAGE_PLACEHOLDER",
  "INVALID_PDF",
  "FAKE_PDF_MIME_TYPE",
  "UNREADABLE_TEXT",
  "COVER_TITLE_MISMATCH",
  "CHARACTER_IDENTITY_BREAK",
  "WRONG_LANGUAGE",
  "COPYRIGHT_PLACEHOLDER",
  "DUPLICATED_PAGE",
  "PAGE_ORDER_ERROR",
  "CONTENT_UNSAFE_FOR_AGE",
] as const;

export type CriticalRuleId = (typeof CRITICAL_RULE_IDS)[number];

export function isCritical(ruleId: string): boolean {
  return (CRITICAL_RULE_IDS as readonly string[]).includes(ruleId);
}
