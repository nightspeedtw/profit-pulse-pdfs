// Phase 5a — Textless Illustration Policy (canonical).
//
// SecretPDF children's picture books render ALL customer-facing text
// (title, captions, page copy) as HTML/SVG/PDF overlays. AI illustration
// models MUST produce fully textless artwork. Any letters/words/numbers
// in the raster are a defect class routed to `image-artifact-guard`.
//
// This module is the single source of truth for:
//   1. The prompt directive appended to every image-gen call.
//   2. The forbidden-objects list injected into every SceneContract.
//   3. A lightweight verdict helper the image-artifact-guard uses to
//      decide whether a generated raster satisfies the policy.
//
// Do NOT weaken these strings without an owner-approved policy change:
// weakening the directive is a gate bypass under the P0 rules.

export const TEXTLESS_DIRECTIVE =
  "ABSOLUTELY NO TEXT of any kind in the image — no letters, no words, " +
  "no captions, no speech bubbles, no signage, no book covers, no logos, " +
  "no watermarks, no numbers, no typography, no calligraphy, no handwriting. " +
  "All customer-facing copy is added later as an HTML/SVG overlay.";

/** Forbidden objects that must appear on every SceneContract for kids books. */
export const TEXTLESS_FORBIDDEN_OBJECTS: readonly string[] = Object.freeze([
  "text",
  "letters",
  "words",
  "captions",
  "speech bubbles",
  "signage",
  "book cover text",
  "logos",
  "watermarks",
  "numbers",
  "typography",
  "handwriting",
]);

/**
 * Append the textless directive to any illustration prompt.
 * Idempotent: if the directive is already present verbatim, returns input.
 */
export function withTextlessDirective(prompt: string): string {
  if (!prompt || typeof prompt !== "string") return TEXTLESS_DIRECTIVE;
  if (prompt.includes(TEXTLESS_DIRECTIVE)) return prompt;
  const sep = prompt.trimEnd().endsWith(".") ? " " : ". ";
  return `${prompt.trimEnd()}${sep}${TEXTLESS_DIRECTIVE}`;
}

/**
 * Return true if a SceneContract's forbidden_objects list satisfies the
 * textless policy (covers text + letters + words at minimum).
 */
export function forbiddenObjectsSatisfyTextlessPolicy(list: readonly string[] | undefined | null): boolean {
  if (!Array.isArray(list)) return false;
  const lower = list.map((s) => String(s).toLowerCase().trim());
  const required = ["text", "letters", "words"];
  return required.every((r) => lower.includes(r));
}

export interface TextlessPolicyViolation {
  code: "MISSING_DIRECTIVE" | "MISSING_FORBIDDEN_OBJECTS";
  message: string;
}

/**
 * Validate a dispatch payload (prompt + scene contract forbidden_objects)
 * satisfies the textless policy. Returns [] when compliant.
 */
export function validateTextlessDispatch(input: {
  prompt: string;
  forbidden_objects?: readonly string[];
}): TextlessPolicyViolation[] {
  const violations: TextlessPolicyViolation[] = [];
  if (!input.prompt || !input.prompt.includes(TEXTLESS_DIRECTIVE)) {
    violations.push({ code: "MISSING_DIRECTIVE", message: "prompt is missing canonical TEXTLESS_DIRECTIVE" });
  }
  if (!forbiddenObjectsSatisfyTextlessPolicy(input.forbidden_objects ?? [])) {
    violations.push({ code: "MISSING_FORBIDDEN_OBJECTS", message: "forbidden_objects must include text, letters, words" });
  }
  return violations;
}
