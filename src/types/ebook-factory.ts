// Premium Ebook Factory — Milestone 1 foundation types.
// Mirrors the SQL schema in supabase/migrations/*_premium_ebook_factory_foundation.sql.
// Auto-generated DB types live in src/integrations/supabase/types.ts and are
// regenerated on every migration; these hand-written types add semantic enums
// and convenience interfaces used across the factory pipeline.

// ---------------- Pipeline status enum ----------------
// Must stay in sync with the Postgres enum `public.pipeline_status`.
export const PIPELINE_STATUSES = [
  "idea_generated",
  "title_copywriting",
  "outline_generation",
  "writing",
  "chapter_qc",
  "pdf_design",
  "cover_design",
  "product_copy",
  "final_qc",
  "published",
  "rejected",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return typeof v === "string" && (PIPELINE_STATUSES as readonly string[]).includes(v);
}

// ---------------- QC score structure ----------------
// All scores are integers 0-100. DB enforces the range via CHECK constraints.
export interface QcScores {
  buyer_appeal_score: number | null;
  premium_score: number | null;
  hard_sell_strength_score: number | null;
  content_depth_score: number | null;
  cover_score: number | null;
  pdf_layout_score: number | null;
  compliance_safety_score: number | null;
  final_quality_score: number | null;
}

export const QC_SCORE_FIELDS: (keyof QcScores)[] = [
  "buyer_appeal_score",
  "premium_score",
  "hard_sell_strength_score",
  "content_depth_score",
  "cover_score",
  "pdf_layout_score",
  "compliance_safety_score",
  "final_quality_score",
];

// ---------------- Shared helpers ----------------
export type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];

export type JsonObject = { [k: string]: Json };

interface Timestamped {
  created_at: string;
  updated_at: string;
}

// ---------------- Table row types ----------------
export interface MarketIntelligenceRow extends Timestamped {
  id: string;
  category_id: string | null;
  source: string | null;
  topic: string | null;
  research_payload: JsonObject;
  trend_score: number | null;
  metadata: JsonObject;
}

export interface EbookIdeaFactoryFields {
  market_intelligence_id: string | null;
  outline: JsonObject;
  research_payload: JsonObject;
  metadata: JsonObject;
  pipeline_status: PipelineStatus;
}

export interface EbookFactoryFields extends QcScores {
  pipeline_status: PipelineStatus;
  outline: JsonObject;
  memory_state: JsonObject;
  visual_plan: JsonObject;
  product_copy: JsonObject;
  metadata: JsonObject;
}

export interface ProductionQueueRow extends Timestamped {
  id: string;
  ebook_id: string | null;
  idea_id: string | null;
  pipeline_status: PipelineStatus;
  priority: number;
  scheduled_at: string;
  attempts: number;
  last_error: string | null;
  payload: JsonObject;
  metadata: JsonObject;
}

export interface EbookChapterRow extends Timestamped {
  id: string;
  ebook_id: string;
  chapter_index: number;
  title: string;
  brief: string | null;
  content: string | null;
  word_count: number | null;
  pipeline_status: PipelineStatus;
  rewrite_count: number;
  qc_scores: Partial<QcScores> & JsonObject;
  metadata: JsonObject;
}

export type EbookAssetKind =
  | "cover"
  | "pdf"
  | "interior_image"
  | "thumbnail"
  | "preview"
  | (string & {});

export interface EbookAssetRow extends Timestamped {
  id: string;
  ebook_id: string;
  kind: EbookAssetKind;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  visual_plan: JsonObject;
  metadata: JsonObject;
}

export interface QcReportRow extends Timestamped, QcScores {
  id: string;
  ebook_id: string | null;
  idea_id: string | null;
  chapter_id: string | null;
  stage: PipelineStatus;
  passed: boolean | null;
  raw_report: JsonObject;
  metadata: JsonObject;
}

export interface AutomationScheduleRow extends Timestamped {
  id: string;
  name: string;
  description: string | null;
  cron_expression: string | null;
  scheduled_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  enabled: boolean;
  config: JsonObject;
  metadata: JsonObject;
}

export interface ApiCostRow extends Timestamped {
  id: string;
  ebook_id: string | null;
  idea_id: string | null;
  provider: string;
  model: string | null;
  operation: string | null;
  stage: PipelineStatus | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  request_response: JsonObject;
  metadata: JsonObject;
}
