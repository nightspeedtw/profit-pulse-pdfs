// Shared cost estimator + fire-and-forget logger for the kids pipeline.
//
// Writes to public.cost_log so `ebook_costs` view can roll per-book totals up
// to the admin UI. NEVER throws — a failure to log must not break a build.
//
// Pricing sources (2026 rates, USD):
//   Google Gemini (direct)    per 1M tokens in / out
//   Fal image endpoints       per image or per MP
// Lovable Gateway markup ≈ 30-50% on top; we log the same base rate so the
// direct/gateway comparison is honest (small over-count on gateway is fine).

import { createClient } from "npm:@supabase/supabase-js@2";
type Db = ReturnType<typeof createClient>;

interface TokRate { in: number; out: number } // per 1M tokens
interface ImgRate { image: number }            // per image

type Rate = TokRate | ImgRate;

export const PRICE_TABLE: Record<string, Rate> = {
  // Text / chat / vision
  "google/gemini-3.1-pro-preview":     { in: 1.25, out: 10.00 },
  "google/gemini-2.5-pro":             { in: 1.25, out: 10.00 },
  "google/gemini-2.5-flash":           { in: 0.075, out: 0.30 },
  "google/gemini-2.5-flash-lite":      { in: 0.05,  out: 0.20 },
  "google/gemini-3-flash-preview":     { in: 0.075, out: 0.30 },
  "google/gemini-3.5-flash":           { in: 0.15,  out: 0.60 },
  "google/gemini-3.1-flash-lite":      { in: 0.05,  out: 0.20 },
  // Image
  "google/gemini-3.1-flash-image":     { image: 0.067 },
  "google/gemini-3.1-flash-lite-image":{ image: 0.020 },
  "google/gemini-2.5-flash-image":     { image: 0.039 },
  "google/gemini-3-pro-image":         { image: 0.120 },
  "fal-ai/flux/schnell":               { image: 0.003 },
  "fal-ai/recraft-v3":                 { image: 0.040 },
};

export interface EstimateInput {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  images?: number;
}

export function estimateCost({ model, input_tokens = 0, output_tokens = 0, images = 0 }: EstimateInput): number {
  const rate = PRICE_TABLE[model];
  if (!rate) return 0;
  if ("image" in rate) return images * rate.image;
  return (input_tokens / 1_000_000) * rate.in + (output_tokens / 1_000_000) * rate.out;
}

export interface LogAiCostRow {
  ebook_id?: string | null;
  idea_id?: string | null;
  step: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  images?: number;
  cost_usd?: number;
  provider?: "gateway" | "google_direct" | "fal_direct" | string;
}

/**
 * Fire-and-forget cost logger. Never throws.
 * Stores image count into `output_tokens` (per directive) so simple SUMs work.
 */
export function logAiCost(db: Db, row: LogAiCostRow): void {
  try {
    const cost_usd = row.cost_usd ?? estimateCost({
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      images: row.images,
    });
    const out_tok = row.output_tokens ?? (row.images ? row.images : 0);
    const insertRow = {
      ebook_id: row.ebook_id ?? null,
      idea_id: row.idea_id ?? null,
      step: row.step,
      model: row.model,
      input_tokens: row.input_tokens ?? 0,
      output_tokens: out_tok,
      cost_usd: Number(cost_usd.toFixed(6)),
      provider: row.provider ?? null,
    };
    // fire & forget
    void db.from("cost_log").insert(insertRow).then((r: { error: unknown }) => {
      if (r?.error) console.warn("logAiCost insert failed", (r.error as Error)?.message ?? r.error);
    }, (e: unknown) => console.warn("logAiCost promise rejected", (e as Error)?.message ?? e));
  } catch (e) {
    console.warn("logAiCost threw", (e as Error).message);
  }
}

/** Convenience factory when the caller already has SUPABASE_URL + service key. */
let _costDb: Db | null = null;
export function costDb(): Db {
  if (_costDb) return _costDb;
  _costDb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  return _costDb;
}

// ═══════════════════════════════════════════════════════════════════════
// V2 double-write: coloring_v2_provider_calls
// External-audit gap #2 — per-book daily_cost_ceiling + reproducibility
// audits are blind without input_hash / output_hash / seed / prompt_version
// populated for every provider call inside the V2 lane. Fire-and-forget;
// FK violations for non-v2 book_ids are swallowed.
// ═══════════════════════════════════════════════════════════════════════
export interface LogV2ProviderCallRow {
  book_id: string;
  provider: string;
  model: string;
  purpose: string;
  prompt_version?: string | null;
  seed?: number | null;
  input_hash?: string | null;
  output_hash?: string | null;
  latency_ms?: number | null;
  cost_usd?: number;
  success?: boolean;
  error_message?: string | null;
  meta?: Record<string, unknown>;
}

export function logColoringV2ProviderCall(db: Db, row: LogV2ProviderCallRow): void {
  try {
    if (!row.book_id) return;
    const insertRow = {
      book_id: row.book_id,
      provider: row.provider,
      model: row.model,
      purpose: row.purpose,
      prompt_version: row.prompt_version ?? null,
      seed: row.seed ?? null,
      input_hash: row.input_hash ?? null,
      output_hash: row.output_hash ?? null,
      latency_ms: row.latency_ms ?? null,
      cost_usd: Number((row.cost_usd ?? 0).toFixed(6)),
      success: row.success ?? true,
      error_message: row.error_message ?? null,
      meta: row.meta ?? {},
    };
    void db.from("coloring_v2_provider_calls").insert(insertRow).then(
      (r: { error: unknown }) => {
        if (r?.error) {
          const msg = (r.error as { message?: string })?.message ?? String(r.error);
          // FK violation = non-v2 book id; expected — swallow.
          if (!/foreign key|violates/i.test(msg)) {
            console.warn("logColoringV2ProviderCall insert failed", msg);
          }
        }
      },
      (e: unknown) => console.warn("logColoringV2ProviderCall promise rejected", (e as Error)?.message ?? e),
    );
  } catch (e) {
    console.warn("logColoringV2ProviderCall threw", (e as Error).message);
  }
}

/** Deterministic sha256 hex — used for input/output hashes. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
