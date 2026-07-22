// 17-point Blog Quality Gate (SEO / AEO / GEO / E-E-A-T).
// Pure functions — no I/O. Callers persist findings to blog_qa_findings.

export type Severity = "critical" | "major" | "minor" | "info";
export type Category = "seo" | "aeo" | "geo" | "eeat" | "structure" | "originality" | "safety";

export interface QaFinding {
  check_name: string;
  severity: Severity;
  category: Category;
  message: string;
  evidence?: unknown;
}

export interface BlogDraft {
  title?: string;
  dek?: string;
  meta_description?: string;
  meta_title?: string;
  body_md?: string;
  primary_keyword?: string;
  secondary_keywords?: string[];
  faq?: Array<{ q: string; a: string }>;
  direct_answer?: string;
  takeaways?: string[];
  sources?: Array<{ title: string; url: string }>;
  embedded_product_ids?: string[];
  hero_image_prompt?: string;
}

export interface QaResult {
  score: number;           // 0-100
  passed: boolean;         // score >= 70 AND no critical
  findings: QaFinding[];
  word_count: number;
}

const HYPE_WORDS = [
  "revolutionary", "game-changing", "mind-blowing", "unbelievable",
  "insane", "epic", "ultimate best ever", "literally the best",
];
const FLUFF_OPENERS = [
  "in today's fast-paced world",
  "in this day and age",
  "it goes without saying",
  "at the end of the day",
  "when it comes to",
];

function countMatches(hay: string, needle: string): number {
  if (!needle) return 0;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (hay.match(re) ?? []).length;
}

function stripMd(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*_~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function runQualityGate(draft: BlogDraft): QaResult {
  const findings: QaFinding[] = [];
  const body = draft.body_md ?? "";
  const plain = stripMd(body);
  const words = plain.split(/\s+/).filter(Boolean);
  const wc = words.length;
  const title = draft.title ?? "";
  const kw = (draft.primary_keyword ?? "").trim();
  const secondary = draft.secondary_keywords ?? [];
  const faq = draft.faq ?? [];

  const add = (f: QaFinding) => findings.push(f);

  // 1. Title present, <= 65 chars, includes primary keyword
  if (!title) add({ check_name: "title_present", severity: "critical", category: "seo", message: "Missing title." });
  else {
    if (title.length > 65) add({ check_name: "title_length", severity: "major", category: "seo", message: `Title is ${title.length} chars (max 65).`, evidence: title });
    if (kw && !title.toLowerCase().includes(kw.toLowerCase()))
      add({ check_name: "title_keyword", severity: "major", category: "seo", message: "Primary keyword missing from title." });
  }

  // 2. Meta description 120-160 chars
  const meta = draft.meta_description ?? "";
  if (!meta) add({ check_name: "meta_present", severity: "major", category: "seo", message: "Missing meta description." });
  else if (meta.length < 110 || meta.length > 160)
    add({ check_name: "meta_length", severity: "minor", category: "seo", message: `Meta description is ${meta.length} chars (target 120-160).` });

  // 3. Word count 900-1800
  if (wc < 900) add({ check_name: "word_count_low", severity: "major", category: "seo", message: `Body is ${wc} words (min 900).` });
  else if (wc > 2200) add({ check_name: "word_count_high", severity: "minor", category: "seo", message: `Body is ${wc} words (max 2200).` });

  // 4. Keyword density 0.5% – 2.5%
  if (kw) {
    const hits = countMatches(plain, kw);
    const density = wc ? hits / wc : 0;
    if (hits === 0) add({ check_name: "keyword_body", severity: "major", category: "seo", message: "Primary keyword not found in body." });
    else if (density > 0.03) add({ check_name: "keyword_stuffing", severity: "major", category: "seo", message: `Keyword density ${(density * 100).toFixed(1)}% > 3%.`, evidence: { hits, wc } });
    else if (density < 0.003) add({ check_name: "keyword_thin", severity: "minor", category: "seo", message: `Keyword density ${(density * 100).toFixed(2)}% < 0.3%.`, evidence: { hits, wc } });
  } else {
    add({ check_name: "keyword_missing", severity: "major", category: "seo", message: "No primary keyword provided." });
  }

  // 5. Secondary keywords present (>=2 appear at least once)
  const secHits = secondary.filter((s) => s && countMatches(plain, s) > 0).length;
  if (secondary.length && secHits < Math.min(2, secondary.length))
    add({ check_name: "secondary_keywords", severity: "minor", category: "seo", message: `Only ${secHits} secondary keywords used.` });

  // 6. Heading hierarchy — >=2 H2 sections
  const h2 = (body.match(/^##\s+/gm) ?? []).length;
  const h3 = (body.match(/^###\s+/gm) ?? []).length;
  if (h2 < 2) add({ check_name: "h2_count", severity: "major", category: "structure", message: `Only ${h2} H2 sections (min 2).` });
  if (h2 + h3 < 3) add({ check_name: "scannability", severity: "minor", category: "structure", message: "Too few sub-headings; article won't scan." });

  // 7. Uses bullet or numbered lists
  const hasList = /^\s*[-*]\s+/m.test(body) || /^\s*\d+\.\s+/m.test(body);
  if (!hasList) add({ check_name: "lists", severity: "minor", category: "structure", message: "No bullet or numbered list found." });

  // 8. FAQ has 3-5 items, each with question + answer
  if (faq.length < 3) add({ check_name: "faq_count", severity: "major", category: "aeo", message: `FAQ has ${faq.length} items (min 3).` });
  else if (faq.length > 6) add({ check_name: "faq_bloat", severity: "minor", category: "aeo", message: `FAQ has ${faq.length} items (max 6).` });
  const badFaq = faq.filter((f) => !f.q || !f.a || f.a.split(/\s+/).length < 20);
  if (badFaq.length) add({ check_name: "faq_thin_answers", severity: "minor", category: "aeo", message: `${badFaq.length} FAQ answers under 20 words.` });

  // 9. Direct answer for AEO (40-80 words ideal)
  const da = (draft.direct_answer ?? "").trim();
  if (!da) add({ check_name: "direct_answer_missing", severity: "major", category: "aeo", message: "No direct-answer summary for featured snippets." });
  else {
    const daw = da.split(/\s+/).length;
    if (daw < 30 || daw > 90) add({ check_name: "direct_answer_length", severity: "minor", category: "aeo", message: `Direct answer is ${daw} words (target 40-80).` });
  }

  // 10. Key takeaways (>=3)
  const t = draft.takeaways ?? [];
  if (t.length < 3) add({ check_name: "takeaways", severity: "minor", category: "aeo", message: `${t.length} takeaways (min 3).` });

  // 11. Sources/citations for E-E-A-T
  const sources = draft.sources ?? [];
  if (sources.length < 2) add({ check_name: "sources", severity: "major", category: "eeat", message: `${sources.length} sources (min 2 for trust).` });
  const badSrc = sources.filter((s) => !s.url || !/^https?:\/\//.test(s.url));
  if (badSrc.length) add({ check_name: "sources_invalid", severity: "minor", category: "eeat", message: `${badSrc.length} sources missing valid URLs.` });

  // 12. Outbound links (>=1 non-product external link)
  const outbound = (body.match(/\]\((https?:\/\/[^)]+)/g) ?? []).length;
  if (outbound < 1 && sources.length < 2)
    add({ check_name: "outbound_links", severity: "minor", category: "eeat", message: "No outbound authority links in body." });

  // 13. Internal product embeds (>=2)
  const embeds = draft.embedded_product_ids ?? [];
  const embedRefs = (body.match(/\[BOOK_LINK:[a-f0-9-]{36}\]/gi) ?? []).length;
  if (embeds.length < 2)
    add({ check_name: "product_embeds", severity: "major", category: "geo", message: `Only ${embeds.length} product embeds (min 2).` });
  if (embedRefs === 0 && embeds.length > 0)
    add({ check_name: "product_refs_body", severity: "minor", category: "geo", message: "Products listed but not referenced in body via [BOOK_LINK:id]." });

  // 14. Hype / spam words
  const hype = HYPE_WORDS.filter((w) => plain.toLowerCase().includes(w));
  if (hype.length) add({ check_name: "hype_words", severity: "minor", category: "originality", message: `Hype words: ${hype.join(", ")}.` });

  // 15. Exclamation-mark spam (>3)
  const bangs = (body.match(/!/g) ?? []).length;
  if (bangs > 4) add({ check_name: "exclamation_spam", severity: "minor", category: "originality", message: `${bangs} exclamation marks (max 4).` });

  // 16. Fluff openers
  const fluff = FLUFF_OPENERS.filter((f) => plain.toLowerCase().includes(f));
  if (fluff.length) add({ check_name: "fluff_phrases", severity: "minor", category: "originality", message: `Fluff phrases: ${fluff.join("; ")}.` });

  // 17. Safety — no medical / financial / legal advice claims
  const unsafe = /\b(cure|diagnose|treat[a-z]* (your|a) (child|kid))\b/i.test(plain);
  if (unsafe) add({ check_name: "safety_claims", severity: "critical", category: "safety", message: "Contains medical/treatment claims — remove or rephrase." });

  // Scoring
  const weights: Record<Severity, number> = { critical: 30, major: 10, minor: 3, info: 0 };
  const deduct = findings.reduce((s, f) => s + weights[f.severity], 0);
  const score = Math.max(0, 100 - deduct);
  const hasCritical = findings.some((f) => f.severity === "critical");
  const passed = score >= 70 && !hasCritical;

  return { score, passed, findings, word_count: wc };
}
