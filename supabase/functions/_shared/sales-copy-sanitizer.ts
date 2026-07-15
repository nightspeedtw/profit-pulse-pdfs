// Phase 8 — Sales-page sanitization.
//
// SPLIT CONTRACT:
//
//   internal_story_brief_json (PRIVATE)
//     - craft notes, moral, judge feedback, prompt fragments, forbidden objects,
//       character sheet references, threshold hints, QC scorecards, etc.
//     - MUST NEVER appear on the storefront.
//
//   customer_product_description_html (PUBLIC)
//     - HTML the storefront renders. Whitelist-only tags. No scripts, no
//       inline styles/events, no on-* handlers, no external references, no
//       internal-note leakage.
//
// The sanitizer produces the public HTML from a structured customer-facing
// brief. It refuses to emit if any leakage indicator is present in the input.

export interface CustomerFacingBrief {
  hook: string;
  child_benefit: string;
  what_kids_will_love: string[];
  parent_reassurance?: string;
  age_band?: string;
}

/** Tokens that indicate an internal-only string must not go to the customer. */
export const INTERNAL_LEAK_TOKENS: readonly string[] = Object.freeze([
  "story_bible",
  "story bible",
  "moral_lesson",
  "internal note",
  "internal-only",
  "judge:",
  "qc score",
  "qc scorecard",
  "threshold",
  "prompt fragment",
  "forbidden_objects",
  "character sheet",
  "reference_asset_ids",
  "scene contract",
  "style_version",
  "TODO",
  "TBD",
  "lorem ipsum",
]);

export class SalesCopyLeakError extends Error {
  readonly leaks: string[];
  constructor(leaks: string[]) {
    super(`SalesCopyLeakError: ${leaks.join(", ")}`);
    this.name = "SalesCopyLeakError";
    this.leaks = leaks;
  }
}

/** Scan any string for internal-only tokens. Returns the tokens found. */
export function findInternalLeaks(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return INTERNAL_LEAK_TOKENS.filter((t) => lower.includes(t.toLowerCase()));
}

// --- HTML escaping / whitelist ---------------------------------------------

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

/** Whitelist tags we allow on the storefront. */
const ALLOWED_TAGS = new Set(["p", "ul", "li", "strong", "em", "h2", "h3", "br"]);

/**
 * Strict pass: reject any HTML containing tags outside the whitelist,
 * inline event handlers, javascript: URLs, style attributes, or scripts.
 */
export function assertSafeHtml(html: string): void {
  if (!html) return;
  if (/<script/i.test(html)) throw new SalesCopyLeakError(["<script>"]);
  if (/\son[a-z]+\s*=/i.test(html)) throw new SalesCopyLeakError(["inline event handler"]);
  if (/javascript:/i.test(html)) throw new SalesCopyLeakError(["javascript: url"]);
  if (/\sstyle\s*=/i.test(html)) throw new SalesCopyLeakError(["inline style"]);
  const tagRx = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRx.exec(html)) !== null) {
    if (!ALLOWED_TAGS.has(m[1].toLowerCase())) {
      throw new SalesCopyLeakError([`disallowed tag <${m[1]}>`]);
    }
  }
}

/**
 * Build the customer-facing HTML from a structured brief.
 * Throws SalesCopyLeakError if any input field leaks internal notes.
 */
export function buildCustomerProductDescriptionHtml(brief: CustomerFacingBrief): string {
  const inputs = [
    brief.hook,
    brief.child_benefit,
    brief.parent_reassurance ?? "",
    ...(brief.what_kids_will_love ?? []),
    brief.age_band ?? "",
  ];
  const leaks = inputs.flatMap(findInternalLeaks);
  if (leaks.length) throw new SalesCopyLeakError([...new Set(leaks)]);

  const bullets = (brief.what_kids_will_love ?? [])
    .filter((s) => s && s.trim())
    .map((s) => `<li>${escapeHtml(s.trim())}</li>`)
    .join("");

  const parts: string[] = [];
  parts.push(`<p><strong>${escapeHtml(brief.hook.trim())}</strong></p>`);
  parts.push(`<p>${escapeHtml(brief.child_benefit.trim())}</p>`);
  if (bullets) {
    parts.push(`<h3>What kids will love</h3><ul>${bullets}</ul>`);
  }
  if (brief.parent_reassurance && brief.parent_reassurance.trim()) {
    parts.push(`<p><em>${escapeHtml(brief.parent_reassurance.trim())}</em></p>`);
  }
  if (brief.age_band && brief.age_band.trim()) {
    parts.push(`<p>Recommended age: ${escapeHtml(brief.age_band.trim())}</p>`);
  }
  const html = parts.join("\n");
  assertSafeHtml(html);
  return html;
}

/**
 * Convenience: fully sanitize + persist-ready. Returns null when brief is
 * incomplete (missing hook or child_benefit) so caller can leave the column
 * NULL and the storefront can render its empty-state placeholder (per
 * src/AGENTS.md — NEVER fall back to internal fields).
 */
export function sanitizeSalesCopy(brief: Partial<CustomerFacingBrief>): {
  html: string | null;
  sanitized_at: string;
} {
  if (!brief.hook || !brief.child_benefit) return { html: null, sanitized_at: new Date().toISOString() };
  const html = buildCustomerProductDescriptionHtml({
    hook: brief.hook,
    child_benefit: brief.child_benefit,
    what_kids_will_love: brief.what_kids_will_love ?? [],
    parent_reassurance: brief.parent_reassurance,
    age_band: brief.age_band,
  });
  return { html, sanitized_at: new Date().toISOString() };
}
