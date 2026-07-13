// Canonical pipeline step model — single source of truth for the Phase 1
// Self-Healing Autopilot. Every producer, validator, and repair action keys
// off these identifiers.

export const CANONICAL_STEPS = [
  "start_run",
  "preflight_check",
  "generate_topic",
  "title_generation",
  "title_qc",
  "generate_outline",
  "outline_qc",
  "write_chapters",
  "chapter_qc",
  "build_manuscript",
  "reader_experience_qc",
  "manuscript_qc",
  "cover_strategy",
  "cover_generation",
  "cover_qc",
  "thumbnail_generation",
  "thumbnail_qc",
  "pdf_layout_generation",
  "pdf_rendering",
  "pdf_screenshot_qc",
  "pdf_qc",
  "product_copy_generation",
  "pricing_generation",
  "product_page_qc",
  "publish_live",
  "final_report",
] as const;

export type CanonicalStep = (typeof CANONICAL_STEPS)[number];

export const STEP_ORDER: Record<CanonicalStep, number> = Object.fromEntries(
  CANONICAL_STEPS.map((s, i) => [s, i + 1]),
) as Record<CanonicalStep, number>;

// Dependency graph (each step's REQUIRED direct dependencies).
export const STEP_DEPS: Record<CanonicalStep, CanonicalStep[]> = {
  start_run: [],
  preflight_check: ["start_run"],
  generate_topic: ["preflight_check"],
  title_generation: ["generate_topic"],
  title_qc: ["title_generation"],
  generate_outline: ["title_qc"],
  outline_qc: ["generate_outline"],
  write_chapters: ["outline_qc"],
  chapter_qc: ["write_chapters"],
  build_manuscript: ["chapter_qc"],
  reader_experience_qc: ["build_manuscript"],
  manuscript_qc: ["reader_experience_qc"],
  cover_strategy: ["manuscript_qc"],
  cover_generation: ["cover_strategy"],
  cover_qc: ["cover_generation"],
  thumbnail_generation: ["cover_qc"],
  thumbnail_qc: ["thumbnail_generation"],
  pdf_layout_generation: ["manuscript_qc", "cover_qc"],
  pdf_rendering: ["pdf_layout_generation"],
  pdf_screenshot_qc: ["pdf_rendering"],
  pdf_qc: ["pdf_screenshot_qc"],
  product_copy_generation: ["pdf_qc"],
  pricing_generation: ["product_copy_generation"],
  product_page_qc: ["pricing_generation"],
  publish_live: ["product_page_qc", "thumbnail_qc"],
  final_report: ["publish_live"],
};

// Canonical status vocabulary.
export const STATUSES = [
  "pending",
  "running",
  "passed",
  "passed_existing",
  "skipped_valid_existing",
  "auto_fixing",
  "repairing_dependency",
  "waiting_for_quota",
  "waiting_for_browserless_slot",
  "needs_code_fix",
  "needs_admin_attention",
  "failed_non_recoverable",
] as const;
export type CanonicalStatus = (typeof STATUSES)[number];

export const TERMINAL_PASS_STATUSES: CanonicalStatus[] = [
  "passed",
  "passed_existing",
  "skipped_valid_existing",
];

export const TERMINAL_FAIL_STATUSES: CanonicalStatus[] = [
  "needs_code_fix",
  "needs_admin_attention",
  "failed_non_recoverable",
];

export const WAITING_STATUSES: CanonicalStatus[] = [
  "waiting_for_quota",
  "waiting_for_browserless_slot",
];

export function isPassed(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_PASS_STATUSES as readonly string[]).includes(status);
}

export function isTerminalFail(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_FAIL_STATUSES as readonly string[]).includes(status);
}

export function stepLabel(step: CanonicalStep): string {
  return step.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
