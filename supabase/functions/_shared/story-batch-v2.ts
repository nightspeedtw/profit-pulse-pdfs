// Shared helpers for the Story Batch V2 isolated pipeline.
// Cost ledger enforcement + Lovable AI chat + budget guard.
// Nothing here touches existing production tables or paths.

import { createClient } from "npm:@supabase/supabase-js@2";
import "./gateway-guard.ts";

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export const STORY_BATCH_V2_TAG = "[STORY_BATCH_V2]";

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Cheapest capable text model + cover model. Interior model comes online later.
export const MODELS = {
  cheapText: "google/gemini-2.5-flash-lite",
  strongText: "google/gemini-2.5-pro",
  cover: "openai/gpt-image-2",       // quality: high
  interior: "openai/gpt-image-2",    // quality: medium
} as const;

// Conservative per-request cost estimates (in USD cents). Real cost is
// written back to ledger from provider metadata when available.
export const COST_ESTIMATE_CENTS = {
  concept_planner: 6,     // one large flash-lite call for 50 concepts
  story_bible: 2,
  manuscript_page: 1,     // per page, flash-lite
  cover_image: 15,        // gpt-image-2 high square
  interior_image: 6,      // gpt-image-2 medium square
} as const;

export interface BatchBudgetState {
  budget_cents: number;
  actual_cents: number;
  remaining_cents: number;
  repair_reserve_cents: number;
  spendable_cents: number; // remaining minus reserve
}

export async function readBudget(batchId: string): Promise<BatchBudgetState> {
  const supa = adminClient();
  const { data: batch, error } = await supa
    .from("story_batch_v2_batches")
    .select("budget_usd_cents, actual_cost_cents, repair_reserve_pct")
    .eq("id", batchId)
    .single();
  if (error || !batch) throw new Error(`batch not found: ${batchId}`);
  const budget = batch.budget_usd_cents;
  const actual = batch.actual_cost_cents ?? 0;
  const reserve = Math.floor((budget * Number(batch.repair_reserve_pct)) / 100);
  const remaining = budget - actual;
  const spendable = Math.max(0, remaining - reserve);
  return {
    budget_cents: budget,
    actual_cents: actual,
    remaining_cents: remaining,
    repair_reserve_cents: reserve,
    spendable_cents: spendable,
  };
}

/**
 * Hard budget guard. Throws BudgetCeilingError if the next request would
 * exceed the batch's spendable budget. Include the repair reserve so we
 * never drain the whole ceiling on the first pass.
 */
export class BudgetCeilingError extends Error {
  constructor(public batchId: string, public estimate_cents: number, public state: BatchBudgetState) {
    super(`budget_ceiling: batch=${batchId} would spend ${estimate_cents}c, spendable=${state.spendable_cents}c`);
    this.name = "BudgetCeilingError";
  }
}

export async function assertBudget(batchId: string, estimateCents: number, allowReserve = false) {
  const state = await readBudget(batchId);
  const cap = allowReserve ? state.remaining_cents : state.spendable_cents;
  if (estimateCents > cap) throw new BudgetCeilingError(batchId, estimateCents, state);
  return state;
}

export async function recordCost(opts: {
  batchId: string;
  bookId?: string | null;
  provider: string;
  model: string;
  kind: "text" | "image_cover" | "image_interior" | "image_ref" | "other";
  costCents: number;
  units?: number;
  meta?: Record<string, unknown>;
  providerRequestId?: string;
}) {
  const supa = adminClient();
  await supa.from("story_batch_v2_cost_ledger").insert({
    batch_id: opts.batchId,
    book_id: opts.bookId ?? null,
    provider: opts.provider,
    model: opts.model,
    kind: opts.kind,
    cost_cents: opts.costCents,
    units: opts.units ?? null,
    meta: opts.meta ?? null,
    provider_request_id: opts.providerRequestId ?? null,
  });
  // Increment batch actual atomically via RPC-less update.
  await supa.rpc as unknown; // no rpc; fall back to select+update below
  const { data: cur } = await supa
    .from("story_batch_v2_batches")
    .select("actual_cost_cents")
    .eq("id", opts.batchId)
    .single();
  const next = (cur?.actual_cost_cents ?? 0) + opts.costCents;
  await supa.from("story_batch_v2_batches").update({ actual_cost_cents: next }).eq("id", opts.batchId);
  if (opts.bookId) {
    const { data: b } = await supa
      .from("story_batch_v2_books")
      .select("cost_cents")
      .eq("id", opts.bookId)
      .single();
    await supa
      .from("story_batch_v2_books")
      .update({ cost_cents: (b?.cost_cents ?? 0) + opts.costCents })
      .eq("id", opts.bookId);
  }
}

/**
 * OpenAI-compatible chat completion through Lovable AI Gateway.
 * Returns parsed JSON when `json` is true (via response_format json_object).
 */
export async function chat(opts: {
  model: string;
  system?: string;
  user: string;
  json?: boolean;
  temperature?: number;
}): Promise<{ text: string; parsed?: unknown; raw: Record<string, unknown> }> {
  // Route through smartChat so BYPASS_LOVABLE_GATEWAY=1 forces direct providers.
  const { smartChat } = await import("./direct-fallback.ts");
  const r = await smartChat({
    system: opts.system ?? "",
    user: opts.user,
    model: opts.model,
    responseJson: !!opts.json,
  });
  const text = r.text ?? "";
  let parsed: unknown;
  if (opts.json) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Strip markdown fences and retry
      const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }
  }
  const raw: Record<string, unknown> = {
    provider: r.provider,
    model: r.model,
    usage: { prompt_tokens: r.input_tokens, completion_tokens: r.output_tokens },
  };
  return { text, parsed, raw };
}

// Age-band contract used by every downstream stage.
export const AGE_BAND_CONTRACT = {
  age_2_4:   { pageCount: 24, storyPages: 19, wordsPerPage: [5, 20],   tone: "warm, gentle, bedtime-safe, uncluttered" },
  age_4_6:   { pageCount: 24, storyPages: 19, wordsPerPage: [15, 40],  tone: "clear problem→solution, page-turn questions" },
  age_6_8:   { pageCount: 24, storyPages: 19, wordsPerPage: [30, 70],  tone: "adventure, motivation, consequences" },
  age_8_12:  { pageCount: 32, storyPages: 27, wordsPerPage: [50, 120], tone: "layered mystery/fantasy, midpoint escalation" },
  age_13_17: { pageCount: 36, storyPages: 31, wordsPerPage: [70, 160], tone: "premium YA, twist, high-stakes climax, no explicit content" },
} as const;

export type AgeBand = keyof typeof AGE_BAND_CONTRACT;

// Book cost projection (used at preflight and per-book budgeting).
export function projectBookCostCents(age: AgeBand): number {
  const c = AGE_BAND_CONTRACT[age];
  const interior = c.storyPages - 1; // last story spread reuses layout
  return (
    COST_ESTIMATE_CENTS.story_bible +
    COST_ESTIMATE_CENTS.manuscript_page * c.storyPages +
    COST_ESTIMATE_CENTS.cover_image +
    COST_ESTIMATE_CENTS.interior_image * interior
  );
}

export function projectBatchCostCents(targetsByAge: Record<AgeBand, number>): number {
  const conceptOverhead = COST_ESTIMATE_CENTS.concept_planner * 5; // planner + 4 refinement rounds
  let total = conceptOverhead;
  for (const [age, n] of Object.entries(targetsByAge) as [AgeBand, number][]) {
    total += projectBookCostCents(age) * n;
  }
  return total;
}
