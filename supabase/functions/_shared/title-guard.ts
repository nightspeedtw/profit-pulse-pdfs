// Premium Title Guard
// Hard filter that rejects generic, blog-post-sounding ebook titles BEFORE
// they can be saved as ideas or pass the premium title QC gate.
//
// The user explicitly banned generic titles like:
//   - "How to Pay Off Debt"
//   - "Personal Finance Guide"
//   - "Budgeting Tips"
//   - "How to Be More Productive"
//   - "Relationship Advice Workbook"
//
// Every accepted title must feel like a paid digital product using:
//   pain · urgency · identity · system · transformation · premium positioning.

const GENERIC_LEADERS = [
  /^how to\b/i,
  /^the ultimate\b/i,
  /^ultimate guide\b/i,
  /^a beginner'?s guide\b/i,
  /^beginner'?s guide\b/i,
  /^complete guide\b/i,
  /^the complete guide\b/i,
  /^introduction to\b/i,
  /^everything you need to know\b/i,
  /^a guide to\b/i,
];

const GENERIC_WHOLE_PHRASES = [
  /^personal finance guide$/i,
  /^budgeting tips$/i,
  /^money tips$/i,
  /^relationship advice( workbook)?$/i,
  /^productivity tips$/i,
  /^self[- ]?help guide$/i,
  /^fitness guide$/i,
];

// Weak / bloggy words that must not carry the whole title.
const WEAK_WORDS = [
  "tips", "tricks", "hacks", "secrets", "basics", "basic",
  "simple", "easy", "quick tips", "guide to", "advice",
];

// Premium positioning tokens — at least ONE must appear (case-insensitive)
// unless the title uses an explicit outcome+timeframe pattern
// (e.g. "The 6-Month Debt Exit Strategy").
const PREMIUM_TOKENS = [
  "protocol", "blueprint", "playbook", "framework", "operating system",
  "os", "system", "method", "formula", "toolkit", "field guide",
  "reset plan", "reset", "exit strategy", "escape plan", "recovery plan",
  "safety plan", "roadmap", "engine", "stack", "code", "doctrine",
  "manifesto", "protocol", "protocols", "vault", "fortress", "shield",
  "advantage", "edge", "arsenal", "mastery",
];

const OUTCOME_TIMEFRAME =
  /\b(\d+)[- ]?(day|week|month|year|hour|minute)s?\b/i;

export interface TitleCheck {
  ok: boolean;
  reasons: string[];
}

export function checkPremiumTitle(rawTitle: string): TitleCheck {
  const reasons: string[] = [];
  const title = (rawTitle ?? "").trim();
  if (!title) return { ok: false, reasons: ["empty_title"] };

  const words = title.split(/\s+/);
  if (words.length < 3) reasons.push("too_short_for_premium_product");
  if (words.length > 16) reasons.push("too_long_reads_like_blog_post");

  for (const rx of GENERIC_LEADERS) {
    if (rx.test(title)) { reasons.push(`generic_leader:${rx.source}`); break; }
  }
  for (const rx of GENERIC_WHOLE_PHRASES) {
    if (rx.test(title)) { reasons.push("generic_whole_phrase"); break; }
  }

  const lower = title.toLowerCase();
  const weakHit = WEAK_WORDS.find((w) => lower.includes(w));
  if (weakHit) reasons.push(`weak_word:${weakHit}`);

  const hasPremiumToken = PREMIUM_TOKENS.some((t) =>
    new RegExp(`\\b${t.replace(/\s+/g, "\\s+")}\\b`, "i").test(title)
  );
  const hasOutcomeTimeframe = OUTCOME_TIMEFRAME.test(title);
  if (!hasPremiumToken && !hasOutcomeTimeframe) {
    reasons.push("missing_premium_positioning_token");
  }

  return { ok: reasons.length === 0, reasons };
}
