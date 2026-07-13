// QC v2 — compute scores from evidence findings and decide sellable.
import { CATEGORY_FLOOR, CATEGORY_MIN, CATEGORY_WEIGHTS, OVERALL_MIN, QC_CATEGORIES, type QcCategory } from "./weights.ts";
import { isCritical } from "./critical.ts";

export interface Finding {
  rule_id: string;
  category: QcCategory | string;
  passed: boolean;
  severity: "critical" | "major" | "minor";
}

export interface QcVerdict {
  overall_score: number;
  category_scores: Record<QcCategory, number>;
  critical_errors: string[];
  failed_categories: string[];
  sellable: boolean;
  reasons: string[];
}

const PENALTY: Record<Finding["severity"], number> = {
  critical: 100, // one critical failure zeroes the category
  major: 25,
  minor: 8,
};

export function computeVerdict(findings: Finding[]): QcVerdict {
  const catScores: Record<QcCategory, number> = Object.fromEntries(
    QC_CATEGORIES.map((c) => [c, 100]),
  ) as Record<QcCategory, number>;

  for (const f of findings) {
    if (f.passed) continue;
    const cat = (QC_CATEGORIES as readonly string[]).includes(f.category)
      ? (f.category as QcCategory)
      : null;
    if (!cat) continue;
    catScores[cat] = Math.max(0, catScores[cat] - PENALTY[f.severity]);
  }

  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  const overall = Math.round(
    QC_CATEGORIES.reduce((sum, c) => sum + catScores[c] * CATEGORY_WEIGHTS[c], 0) / totalWeight,
  );

  const critical_errors = Array.from(
    new Set(findings.filter((f) => !f.passed && isCritical(f.rule_id)).map((f) => f.rule_id)),
  );

  const failed_categories: string[] = [];
  const reasons: string[] = [];

  for (const c of QC_CATEGORIES) {
    const min = CATEGORY_MIN[c] ?? CATEGORY_FLOOR;
    if (catScores[c] < min) {
      failed_categories.push(c);
      reasons.push(`${c} ${catScores[c]} < ${min}`);
    }
  }
  if (overall < OVERALL_MIN) reasons.push(`overall ${overall} < ${OVERALL_MIN}`);
  if (critical_errors.length) reasons.push(`critical: ${critical_errors.join(",")}`);

  const sellable = reasons.length === 0;

  return {
    overall_score: overall,
    category_scores: catScores,
    critical_errors,
    failed_categories,
    sellable,
    reasons,
  };
}
