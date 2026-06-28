// Single source of truth for Autopilot pipeline step names + labels.
// Shared by the edge tracker (compiled in Deno) and the React UI.

export type AutopilotStepName =
  | "start_run"
  | "generate_idea"
  | "title_and_hook"
  | "idea_qc"
  | "outline"
  | "outline_qc"
  | "chapter_writing"
  | "chapter_qc"
  | "manuscript_qc"
  | "cover"
  | "cover_qc"
  | "thumbnail"
  | "thumbnail_qc"
  | "pdf_layout"
  | "pdf_render"
  | "pdf_qc"
  | "pricing"
  | "product_copy"
  | "product_qc"
  | "shopify_draft"
  | "shopify_verify"
  | "complete";

export interface AutopilotStepDef {
  name: AutopilotStepName;
  label: string;
  order: number;
}

export const AUTOPILOT_STEPS: AutopilotStepDef[] = [
  { name: "start_run",         label: "Start run",                   order: 1 },
  { name: "generate_idea",     label: "Generate Idea",               order: 2 },
  { name: "title_and_hook",    label: "Writing Title & Hook",        order: 3 },
  { name: "idea_qc",           label: "Running Idea QC",             order: 4 },
  { name: "outline",           label: "Generating Outline",          order: 5 },
  { name: "outline_qc",        label: "Running Outline QC",          order: 6 },
  { name: "chapter_writing",   label: "Writing Chapters",            order: 7 },
  { name: "chapter_qc",        label: "Running Chapter QC",          order: 8 },
  { name: "manuscript_qc",     label: "Running Manuscript QC",       order: 9 },
  { name: "cover",             label: "Generating Cover",            order: 10 },
  { name: "cover_qc",          label: "Running Cover QC",            order: 11 },
  { name: "thumbnail",         label: "Generating Thumbnail",        order: 12 },
  { name: "thumbnail_qc",      label: "Running Thumbnail QC",        order: 13 },
  { name: "pdf_layout",        label: "Designing PDF",               order: 14 },
  { name: "pdf_render",        label: "Rendering PDF",               order: 15 },
  { name: "pdf_qc",            label: "Running PDF QC",              order: 16 },
  { name: "product_copy",      label: "Generating Product Copy",     order: 17 },
  { name: "product_qc",        label: "Running Product Page QC",     order: 18 },
  { name: "shopify_draft",     label: "Uploading Shopify Draft",     order: 19 },
  { name: "shopify_verify",    label: "Verifying Shopify Draft",     order: 20 },
  { name: "complete",          label: "Complete",                    order: 21 },
];

export const TOTAL_STEPS = AUTOPILOT_STEPS.length;

export function stepDef(name: string): AutopilotStepDef | undefined {
  return AUTOPILOT_STEPS.find((s) => s.name === name);
}

export function stepLabel(name: string | null | undefined): string {
  if (!name) return "—";
  return stepDef(name)?.label ?? name;
}

// Run status → UI badge text.
export const RUN_STATUS_LABEL: Record<string, string> = {
  starting: "Starting",
  running: "Running",
  auto_fixing: "Auto-Fixing",
  needs_admin: "Needs Admin Attention",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
};

// Per-step status → UI badge text.
export const STEP_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  passed: "Passed",
  auto_fixing: "Auto-Fixing",
  failed: "Failed",
  needs_admin: "Needs Admin",
  skipped: "Skipped",
};
