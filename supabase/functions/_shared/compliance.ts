// Finance-compliance linter. Rewrites risky performance claims into educational,
// non-promissory wording so PDFs are safe to sell. Deterministic — regex-only,
// no AI call — so it always runs in ~milliseconds and never fails the pipeline.
//
// Returns { text, changes[] } so callers can persist a diff to
// ebooks.compliance_rewrites_json and score the run.

export interface ComplianceChange {
  before: string;
  after: string;
  rule: string;
}

interface Rule {
  name: string;
  // If a callable is used, it may return null to skip.
  test: RegExp;
  replace: (m: string, ...groups: string[]) => string;
}

// Ordered least-specific last so specific numeric claims are caught first.
const RULES: Rule[] = [
  // "accelerate ... by at least 35%" → "may help accelerate ..."
  {
    name: "accelerate_by_pct",
    test: /\baccelerate\b([^.,;!?]{0,80}?)\bby\s+(?:at\s+least\s+)?\d{1,3}\s*%/gi,
    replace: (_m, mid: string) => `may help accelerate${mid}`,
  },
  // "success rate over 80%" / "success rate of 80%+"
  {
    name: "success_rate_pct",
    test: /\bsuccess\s+rate\b\s+(?:of|over|above|>)\s*\d{1,3}\s*%\+?/gi,
    replace: () => "outcomes vary by situation",
  },
  // "guaranteed to X" / "guaranteed X" / "guaranteed."
  {
    name: "guaranteed",
    test: /\bguaranteed\b/gi,
    replace: () => "designed to help",
  },
  // "risk-free" / "risk free"
  {
    name: "risk_free",
    test: /\brisk[-\s]?free\b/gi,
    replace: () => "lower-risk",
  },
  // "will save you $X" / "will save X"
  {
    name: "will_save",
    test: /\bwill\s+save\b/gi,
    replace: () => "may help save",
  },
  // "will eliminate ..."
  {
    name: "will_eliminate",
    test: /\bwill\s+eliminate\b/gi,
    replace: () => "is designed to help eliminate",
  },
  // "must result in"
  {
    name: "must_result",
    test: /\bmust\s+result\s+in\b/gi,
    replace: () => "can support",
  },
  // "you will pay off ..."
  {
    name: "you_will_verb",
    test: /\byou\s+will\s+(pay off|eliminate|save|earn|make|double|triple|quadruple)\b/gi,
    replace: (_m, verb: string) => `you may ${verb}`,
  },
  // Blanket "results guaranteed"
  {
    name: "results_guaranteed",
    test: /\bresults?\s+guaranteed\b/gi,
    replace: () => "results depend on income, balances, interest rates, and execution",
  },
];

export interface ComplianceResult {
  text: string;
  changes: ComplianceChange[];
  score: number;   // 100 = zero risky phrases remaining, dropping by ~5 per residual match
}

const RESIDUAL = [
  /\bguaranteed\b/i,
  /\brisk[-\s]?free\b/i,
  /\bwill\s+save\b/i,
  /\bwill\s+eliminate\b/i,
  /\bmust\s+result\b/i,
  /\bsuccess\s+rate\b\s+(?:of|over|above|>)\s*\d/i,
];

export function lintCompliance(input: string): ComplianceResult {
  if (!input) return { text: "", changes: [], score: 100 };
  let text = input;
  const changes: ComplianceChange[] = [];

  for (const rule of RULES) {
    text = text.replace(rule.test, (match, ...rest) => {
      // Cast to string groups; the last two args from replace are offset & fullString.
      const groups = rest.slice(0, -2) as string[];
      const after = rule.replace(match, ...groups);
      if (after !== match) {
        // Only capture the first 8 changes per rule to keep the diff manageable.
        const dupeKey = `${rule.name}::${match.toLowerCase()}`;
        if (!changes.some((c) => `${c.rule}::${c.before.toLowerCase()}` === dupeKey)) {
          changes.push({ before: match, after, rule: rule.name });
        }
      }
      return after;
    });
  }

  // Residual scan — penalise 5 per remaining risky phrase, floor at 60.
  let residuals = 0;
  for (const r of RESIDUAL) if (r.test(text)) residuals++;
  const score = Math.max(60, 100 - residuals * 5);

  return { text, changes, score };
}

// Apply compliance to a set of chapter contents, returning per-chapter results.
export function lintChapters(chapters: { index: number; content: string }[]) {
  const perChapter = chapters.map((c) => {
    const r = lintCompliance(c.content);
    return { index: c.index, content: r.text, changes: r.changes, score: r.score };
  });
  const allChanges = perChapter.flatMap((c) => c.changes.map((ch) => ({ ...ch, chapter: c.index })));
  const worst = perChapter.reduce((min, c) => Math.min(min, c.score), 100);
  return { perChapter, changes: allChanges, score: worst };
}
