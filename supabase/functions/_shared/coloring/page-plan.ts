// Deterministic page-plan generator + validator for coloring books.
// The plan is written once (calibration lock) and stored on
// ebooks_kids.metadata.coloring_page_plan. Never regenerated per page.

import type { ColoringCategory } from "./category.ts";
import type { PagePlanEntry } from "./style-contract.ts";

// Scene taxonomy — every book distributes across these buckets so pages
// feel like a real book, not eight rotations of the same subject.
export const SCENE_TAXONOMY = [
  "portrait",
  "full_body",
  "environment",
  "action",
  "relationship",
  "celebration",
  "learning",
  "quiet",
] as const;
export type SceneBucket = typeof SCENE_TAXONOMY[number];

const COMPOSITIONS_BY_BUCKET: Record<SceneBucket, string> = {
  portrait: "single_subject_centered",
  full_body: "single_subject_centered",
  environment: "subject_in_environment",
  action: "action_pose",
  relationship: "two_subject_interaction",
  celebration: "group_scene_small",
  learning: "subject_with_props",
  quiet: "single_subject_centered",
};

const SCENE_TEMPLATES: Record<SceneBucket, (s: string) => string> = {
  portrait: (s) => `${s} friendly portrait, head and shoulders, warm expression`,
  full_body: (s) => `${s} standing full-body pose, whole body visible`,
  environment: (s) => `${s} exploring its natural habitat, simple background elements`,
  action: (s) => `${s} in a playful action pose, mid-movement`,
  relationship: (s) => `${s} interacting warmly with a friend of the same kind`,
  celebration: (s) => `${s} at a small celebration with festive props`,
  learning: (s) => `${s} discovering something new with a simple prop`,
  quiet: (s) => `${s} resting quietly in a calm moment`,
};

export interface PagePlanValidationIssue {
  page: number;
  code:
    | "OUT_OF_CATEGORY"
    | "FORBIDDEN_SUBJECT"
    | "DUPLICATE_CONCEPT"
    | "OVERUSED_SUBJECT"
    | "MISSING_FIELD"
    | "SCENE_TAXONOMY_UNDERCOVERED";
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
 * Deterministic distribution across SCENE_TAXONOMY.
 * Cycles subjects so none repeats more than ceil(count/allowed) times,
 * and every scene bucket appears at least floor(count/8) times.
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
    const bucket: SceneBucket = SCENE_TAXONOMY[i % SCENE_TAXONOMY.length];
    const composition = COMPOSITIONS_BY_BUCKET[bucket];
    const secondary = supporting.length && (bucket === "learning" || bucket === "celebration" || bucket === "relationship")
      ? [supporting[Math.floor(rand() * supporting.length)]]
      : [];
    plan.push({
      canonical_page_number: i + 1,
      primary_subject: primary,
      secondary_subjects: secondary,
      scene: SCENE_TEMPLATES[bucket](primary),
      complexity: bucket === "portrait" || bucket === "quiet" ? "simple" : "medium",
      required_elements: [primary],
      forbidden_elements: [],
      composition_type: composition,
      scene_bucket: bucket,
    } as PagePlanEntry);
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
 *   - Scene taxonomy: at least 5 of 8 buckets must be represented, and
 *     no single bucket may hold > 35% of pages.
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
  const bucketCounts = new Map<string, number>();

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
    const bucket = (p as any).scene_bucket as string | undefined;
    if (bucket) bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
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

  const distinctBuckets = bucketCounts.size;
  if (distinctBuckets > 0 && distinctBuckets < 5) {
    issues.push({
      page: 0,
      code: "SCENE_TAXONOMY_UNDERCOVERED",
      message: `only ${distinctBuckets}/8 scene buckets used; require ≥5`,
    });
  }
  const maxBucketShare = plan.length * 0.35;
  for (const [b, n] of bucketCounts) {
    if (n > maxBucketShare) {
      issues.push({
        page: 0,
        code: "SCENE_TAXONOMY_UNDERCOVERED",
        message: `scene bucket '${b}' has ${n} pages (>${Math.floor(maxBucketShare)} max = 35%)`,
      });
    }
  }
  return issues;
}
