// Shared QA logic for the SEO/AEO/GEO autopilot. Pure — no DB access.
// @ts-nocheck

export type Finding = {
  code: string;
  severity: "info" | "warn" | "critical";
  message: string;
};

export type QueueItem = {
  page_type: string;
  title?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  body_md?: string | null;
  faq?: unknown;
  internal_links?: unknown;
  schema_json?: unknown;
  image_count?: number | null;
  target_slug?: string | null;
};

export type Cluster = {
  primary_keyword: string;
  secondary_keywords?: string[];
  min_word_count?: number;
  max_word_count?: number;
  recommended_images?: number;
  aeo_questions?: string[];
  geo_evidence_points?: string[];
};

// Word-count / image / link recommendations per page type (spec).
export const PAGE_RULES: Record<string, {
  minWords: number; maxWords: number; images: number; internalLinks: number;
  faq: number; schemas: string[];
}> = {
  category:     { minWords: 500, maxWords: 800,  images: 6,  internalLinks: 3, faq: 3, schemas: ["BreadcrumbList","CollectionPage"] },
  product:      { minWords: 650, maxWords: 1100, images: 8,  internalLinks: 3, faq: 3, schemas: ["Product","Offer","BreadcrumbList"] },
  blog:         { minWords: 1200,maxWords: 1800, images: 5,  internalLinks: 8, faq: 4, schemas: ["Article","FAQPage"] },
  guide:        { minWords: 1200,maxWords: 1800, images: 5,  internalLinks: 8, faq: 4, schemas: ["Article","FAQPage"] },
  programmatic: { minWords: 650, maxWords: 950,  images: 3,  internalLinks: 2, faq: 3, schemas: ["CollectionPage","FAQPage"] },
  comparison:   { minWords: 900, maxWords: 1400, images: 3,  internalLinks: 4, faq: 3, schemas: ["Article","FAQPage"] },
  seasonal:     { minWords: 700, maxWords: 1200, images: 5,  internalLinks: 4, faq: 3, schemas: ["CollectionPage","FAQPage"] },
};

// Unsupported / risky marketing claims.
export const BANNED_CLAIMS = [
  /\bbest[- ]selling\b/i,
  /\b#\s?1\b/,
  /\bnumber one\b/i,
  /\bguaranteed\b/i,
  /\btop[- ]selling\b/i,
  /\beducational outcomes? guaranteed\b/i,
  /\bworld[’']?s best\b/i,
];

// Defamatory / attacking competitor language (spec: don't attack Etsy).
export const ATTACK_PATTERNS = [
  /\betsy (?:is|are) (?:bad|awful|terrible|scam|ripoff)\b/i,
  /\bavoid etsy\b/i,
  /\bdo(?:n['’]?t)? (?:buy|use) etsy\b/i,
];

export function countWords(s: string): number {
  return (s?.trim().match(/\S+/g) ?? []).length;
}

export function runQa(item: QueueItem, cluster: Cluster, opts: {
  existingSlugs?: string[];
  existingTitles?: string[];
} = {}): { findings: Finding[]; seo_score: number; aeo_score: number; geo_score: number; duplicate_risk_score: number; word_count: number } {
  const findings: Finding[] = [];
  const rules = PAGE_RULES[item.page_type] ?? PAGE_RULES.blog;
  const body = item.body_md ?? "";
  const wc = countWords(body);
  const primary = (cluster.primary_keyword ?? "").toLowerCase();
  const title = (item.title ?? "").toString();
  const metaTitle = (item.meta_title ?? "").toString();
  const metaDesc = (item.meta_description ?? "").toString();
  const faq = Array.isArray(item.faq) ? item.faq : [];
  const links = Array.isArray(item.internal_links) ? item.internal_links : [];
  const schema = (item.schema_json ?? {}) as Record<string, unknown>;

  // ---- Meta title
  if (!metaTitle) findings.push({ code: "meta_title_missing", severity: "critical", message: "Meta title missing" });
  else {
    if (metaTitle.length > 65) findings.push({ code: "meta_title_too_long", severity: "critical", message: `Meta title ${metaTitle.length} chars (>65 hard max)` });
    else if (metaTitle.length < 45 || metaTitle.length > 60) findings.push({ code: "meta_title_length", severity: "warn", message: `Meta title ${metaTitle.length} chars (prefer 45-60)` });
  }

  // ---- Meta description
  if (!metaDesc) findings.push({ code: "meta_desc_missing", severity: "critical", message: "Meta description missing" });
  else {
    if (metaDesc.length > 170) findings.push({ code: "meta_desc_too_long", severity: "critical", message: `Meta description ${metaDesc.length} chars (>170 hard max)` });
    else if (metaDesc.length < 145 || metaDesc.length > 160) findings.push({ code: "meta_desc_length", severity: "warn", message: `Meta description ${metaDesc.length} chars (prefer 145-160)` });
  }

  // ---- Primary keyword presence in title/H1
  const h1Match = body.match(/^#\s+(.+)$/m);
  const h1 = h1Match?.[1] ?? "";
  if (primary && !title.toLowerCase().includes(primary) && !h1.toLowerCase().includes(primary)) {
    findings.push({ code: "primary_keyword_missing_title", severity: "critical", message: `Primary keyword "${cluster.primary_keyword}" not in title or H1` });
  }

  // ---- Keyword stuffing (>3% density)
  if (primary && wc > 0) {
    const occ = (body.toLowerCase().match(new RegExp(`\\b${primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
    const density = occ / wc;
    if (density > 0.03) findings.push({ code: "keyword_stuffing", severity: "critical", message: `Primary keyword density ${(density*100).toFixed(1)}% (>3%)` });
  }

  // ---- Word count
  const minW = cluster.min_word_count ?? rules.minWords;
  const maxW = cluster.max_word_count ?? rules.maxWords;
  if (wc < minW) findings.push({ code: "word_count_low", severity: "critical", message: `Word count ${wc} below minimum ${minW}` });
  else if (wc > maxW * 1.4) findings.push({ code: "word_count_high", severity: "warn", message: `Word count ${wc} above recommended ${maxW}` });

  // ---- Images
  const imgs = item.image_count ?? 0;
  const recImgs = cluster.recommended_images ?? rules.images;
  if (imgs < recImgs) findings.push({ code: "images_low", severity: "warn", message: `Image count ${imgs} below recommendation ${recImgs}` });

  // ---- FAQ (AEO)
  if (faq.length < rules.faq) findings.push({ code: "faq_missing", severity: rules.faq >= 3 ? "critical" : "warn", message: `FAQ has ${faq.length} items, need ${rules.faq}+` });

  // ---- Internal links
  if (links.length < rules.internalLinks) findings.push({ code: "internal_links_low", severity: "critical", message: `Only ${links.length} internal links (need ${rules.internalLinks}+)` });

  // ---- Schema presence
  for (const s of rules.schemas) {
    const t = (schema["@type"] as string) ?? (Array.isArray(schema["@graph"]) ? (schema["@graph"] as any[]).map((n) => n["@type"]).join(",") : "");
    if (!t.includes(s)) findings.push({ code: "schema_missing", severity: "warn", message: `Schema type ${s} not present` });
  }

  // ---- Unsupported claims
  const fullText = `${title} ${metaTitle} ${metaDesc} ${body}`;
  for (const pat of BANNED_CLAIMS) {
    if (pat.test(fullText)) findings.push({ code: "unsupported_claim", severity: "critical", message: `Unsupported marketing claim: /${pat.source}/` });
  }
  for (const pat of ATTACK_PATTERNS) {
    if (pat.test(fullText)) findings.push({ code: "defamatory_competitor", severity: "critical", message: `Attacks competitor: /${pat.source}/` });
  }

  // ---- AEO direct-answer block (40-60 words)
  const answerMatch = body.match(/<!--\s*answer\s*-->([\s\S]*?)<!--\s*\/answer\s*-->/i);
  const answerWords = answerMatch ? countWords(answerMatch[1]) : 0;
  if (!answerMatch) findings.push({ code: "aeo_answer_missing", severity: "critical", message: "Missing <!-- answer --> direct-answer block for AEO" });
  else if (answerWords < 40 || answerWords > 70) findings.push({ code: "aeo_answer_length", severity: "warn", message: `Direct-answer block ${answerWords} words (prefer 40-60)` });

  // ---- GEO evidence
  const evidencePoints = (cluster.geo_evidence_points ?? []).length;
  if (evidencePoints < 2) findings.push({ code: "geo_evidence_thin", severity: "warn", message: `Only ${evidencePoints} GEO evidence points` });

  // ---- Duplicate slug / title cannibalization
  let duplicate_risk_score = 0;
  const slug = (item.target_slug ?? "").toLowerCase();
  if (slug && (opts.existingSlugs ?? []).includes(slug)) {
    findings.push({ code: "duplicate_slug", severity: "critical", message: `Slug ${slug} already exists` });
    duplicate_risk_score = 100;
  }
  // Strip generic brand/category tokens before comparing — otherwise every
  // "…Printable PDFs for Kids | SecretPDF Kids" title collides.
  const STOP = new Set(["for","the","a","an","and","of","to","in","on","with","printable","pdf","pdfs","kids","kid","secretpdf","instant","download","coloring","book","books","pages","from","by","your","our","best"]);
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)));
  const titleTokens = tokens(title);
  const nearDup = (opts.existingTitles ?? []).filter((t) => {
    if (!t || titleTokens.size === 0) return false;
    const other = tokens(t);
    if (other.size === 0) return false;
    const inter = [...titleTokens].filter((x) => other.has(x)).length;
    const union = new Set([...titleTokens, ...other]).size;
    return inter / union > 0.75;
  });
  if (nearDup.length) {
    findings.push({ code: "title_cannibalization", severity: "critical", message: `Title too similar to ${nearDup.length} existing item(s)` });
    duplicate_risk_score = Math.max(duplicate_risk_score, 60);
  }

  // ---- Orphan check
  if (links.length === 0) {
    findings.push({ code: "orphan_no_links", severity: "critical", message: "Page has no internal links (orphan)" });
  }

  // ---- Scoring
  const criticals = findings.filter((f) => f.severity === "critical").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const seo_score = clamp(100 - criticals * 15 - warns * 4);
  const aeoCriticals = findings.filter((f) => f.severity === "critical" && f.code.startsWith("aeo")).length;
  const aeoWarns = findings.filter((f) => f.severity === "warn" && (f.code.startsWith("aeo") || f.code === "faq_missing")).length;
  const aeo_score = clamp(100 - aeoCriticals * 25 - aeoWarns * 8 - (faq.length === 0 ? 20 : 0));
  const geo_score = clamp(100 - (findings.filter((f) => f.code === "geo_evidence_thin").length ? 25 : 0) - (findings.filter((f) => f.code === "unsupported_claim").length ? 30 : 0) - (evidencePoints < 3 ? 10 : 0));

  return { findings, seo_score, aeo_score, geo_score, duplicate_risk_score, word_count: wc };
}

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

export function passesGates(scores: { seo_score: number; aeo_score: number; geo_score: number; duplicate_risk_score: number; findings: Finding[] }): boolean {
  if (scores.seo_score < 85) return false;
  if (scores.aeo_score < 80) return false;
  if (scores.geo_score < 80) return false;
  if (scores.duplicate_risk_score >= 40) return false;
  if (scores.findings.some((f) => f.severity === "critical")) return false;
  return true;
}
