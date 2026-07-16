// Deterministic page-plan generator + validator for coloring books.
// The plan is written once (calibration lock) and stored on
// ebooks_kids.metadata.coloring_page_plan. Never regenerated per page.

import type { ColoringCategory } from "./category.ts";
import type { PagePlanEntry } from "./style-contract.ts";

const COMPOSITIONS = [
  "single_subject_centered",
  "subject_with_props",
  "two_subject_interaction",
  "subject_in_environment",
  "action_pose",
  "group_scene_small",
] as const;

const SCENES_TEMPLATE = [
  (s: string) => `${s} swimming through open water`,
  (s: string) => `${s} resting near coral`,
  (s: string) => `${s} playing with bubbles`,
  (s: string) => `${s} exploring a shipwreck`,
  (s: string) => `${s} hiding among seaweed`,
  (s: string) => `${s} peeking from behind a rock`,
];

export interface PagePlanValidationIssue {
  page: number;
  code:
    | "OUT_OF_CATEGORY"
    | "FORBIDDEN_SUBJECT"
    | "DUPLICATE_CONCEPT"
    | "OVERUSED_SUBJECT"
    | "MISSING_FIELD";
  message: string;
}

export interface PagePlan {
  plan: PagePlanEntry[];
  category_key: string;
  generated_at: string;
}

export interface GeneratePlanOptions {
  seed?: number;
}

// Simple deterministic pseudo-random from seed (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic distribution: cycle through allowed_subjects so no subject
 * is used more than ceil(count/allowed) times. Vary composition + scene so
 * pages are meaningfully different even when a subject repeats.
 */
export function generatePagePlan(
  category: Pick<
    ColoringCategory,
    "category_key" | "allowed_subjects" | "allowed_supporting_elements" | "coloring_page_count"
  >,
  count: number = category.coloring_page_count,
  opts: GeneratePlanOptions = {},
): PagePlan {
  if (!category.allowed_subjects.length) {
    throw new Error(`category ${category.category_key} has no allowed_subjects`);
  }
  const rand = rng(opts.seed ?? 1);
  const subjects = [...category.allowed_subjects];
  const supporting = [...category.allowed_supporting_elements];
  const plan: PagePlanEntry[] = [];
  for (let i = 0; i < count; i++) {
    const primary = subjects[i % subjects.length];
    const secondaryCount = supporting.length ? (i % 3 === 0 ? 1 : 0) : 0;
    const secondary = supporting.length && secondaryCount
      ? [supporting[Math.floor(rand() * supporting.length)]]
      : [];
    const composition = COMPOSITIONS[i % COMPOSITIONS.length];
    const sceneMaker = SCENES_TEMPLATE[i % SCENES_TEMPLATE.length];
    plan.push({
      canonical_page_number: i + 1,
      primary_subject: primary,
      secondary_subjects: secondary,
      scene: sceneMaker(primary),
      complexity: i < 4 ? "simple" : i < count - 4 ? "medium" : "medium",
      required_elements: [primary],
      forbidden_elements: [],
      composition_type: composition,
    });
  }
  return {
    plan,
    category_key: category.category_key,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Validate a page plan against a category. Returns [] when fully compliant.
 * Rules:
 *   - Each primary_subject must be in allowed_subjects
 *   - No primary_subject may match any forbidden_subjects entry
 *   - No two pages may share (primary_subject, scene, composition_type)
 *   - No single subject may exceed ceil(count / distinct_subjects) + 1
 */
export function validatePagePlan(
  plan: PagePlanEntry[],
  category: Pick<ColoringCategory, "allowed_subjects" | "forbidden_subjects">,
): PagePlanValidationIssue[] {
  const issues: PagePlanValidationIssue[] = [];
  const allowed = category.allowed_subjects.map((s) => s.toLowerCase());
  const forbidden = category.forbidden_subjects.map((s) => s.toLowerCase());
  const seen = new Set<string>();
  const subjectCounts = new Map<string, number>();

  for (const p of plan) {
    if (!p.primary_subject || !p.scene || !p.composition_type) {
      issues.push({ page: p.canonical_page_number, code: "MISSING_FIELD", message: "primary_subject/scene/composition_type required" });
      continue;
    }
    const s = p.primary_subject.toLowerCase();
    if (forbidden.some((f) => s.includes(f))) {
      issues.push({ page: p.canonical_page_number, code: "FORBIDDEN_SUBJECT", message: `'${p.primary_subject}' is forbidden` });
    }
    if (!allowed.some((a) => s === a || s.includes(a))) {
      issues.push({ page: p.canonical_page_number, code: "OUT_OF_CATEGORY", message: `'${p.primary_subject}' not in allowed_subjects` });
    }
    const key = `${s}|${p.scene.toLowerCase()}|${p.composition_type}`;
    if (seen.has(key)) {
      issues.push({ page: p.canonical_page_number, code: "DUPLICATE_CONCEPT", message: `duplicate (subject,scene,composition)` });
    }
    seen.add(key);
    subjectCounts.set(s, (subjectCounts.get(s) ?? 0) + 1);
  }

  const distinct = Math.max(1, new Set(plan.map((p) => p.primary_subject.toLowerCase())).size);
  const maxAllowed = Math.ceil(plan.length / distinct) + 1;
  for (const [subj, n] of subjectCounts) {
    if (n > maxAllowed) {
      issues.push({
        page: 0,
        code: "OVERUSED_SUBJECT",
        message: `'${subj}' used ${n}× exceeds cap of ${maxAllowed}`,
      });
    }
  }
  return issues;
}
