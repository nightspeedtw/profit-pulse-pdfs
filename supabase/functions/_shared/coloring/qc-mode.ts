// Shared QC-mode gate helper.
//
// OWNER LAW (batch_learning_rounds, v2): in learning mode every book with a
// valid pdf_url + cover_url MUST proceed. Any gate failure is recorded to
// the defect_ledger (that is the learning fuel) — never a hard block.
//
// Strict mode restores the original QC-blocking semantics.
//
// All coloring gates (assemble weighted, assemble cover, publish release)
// route through waiveOrBlock() so no gate can leak a hard block again.

import { appendDefectLedger, type DefectLedgerEntry } from "./defect-ledger.ts";

export type QcMode = "learning" | "strict";

export async function readQcMode(db: any, ebookId?: string | null): Promise<{ qcMode: QcMode; round: number; autopilotCfg: Record<string, unknown> }> {
  const { data } = await db.from("generation_settings")
    .select("coloring_autopilot").eq("id", 1).maybeSingle();
  const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
  let qcMode: QcMode = ((cfg.qc_mode as string) ?? "learning") === "strict" ? "strict" : "learning";
  const round = Number((cfg.learning_round as number | undefined) ?? 1);
  // Per-book override: metadata.qc_mode_override='strict' pins this book to
  // strict QC regardless of the lane-wide setting. Used for focus runs where
  // we want a genuinely high-quality release while learning-mode batches
  // continue in the background.
  if (ebookId) {
    try {
      const { data: row } = await db.from("ebooks_kids")
        .select("metadata").eq("id", ebookId).maybeSingle();
      const override = (row?.metadata as any)?.qc_mode_override as string | undefined;
      if (override === "strict") qcMode = "strict";
      else if (override === "learning") qcMode = "learning";
    } catch (_e) { /* best-effort */ }
  }
  return { qcMode, round, autopilotCfg: cfg };
}

export interface WaiveResult {
  proceed: boolean;                     // true → pipeline continues
  waived: boolean;                      // true → gate failed but was waived
  ledgerEntries: DefectLedgerEntry[];   // full updated ledger to persist
  reasons: string[];
}

/**
 * Central gate outcome resolver — the ONLY place that decides whether a
 * failed gate blocks the pipeline. In learning mode every failure is
 * recorded to the ledger and the pipeline proceeds.
 */
export function waiveOrBlock(opts: {
  qcMode: QcMode;
  gatePass: boolean;
  reasons?: string[] | string | null;
  meta: Record<string, unknown>;
  stage: string;                      // 'assemble' | 'publish' | ...
  gate: string;                       // 'weighted' | 'cover' | 'release_gate' | ...
  page?: number | null;
  attempts?: number;
  evidence_url?: string | null;
  round?: number | null;
}): WaiveResult {
  const safeReasons = Array.isArray(opts.reasons)
    ? opts.reasons.map((r) => String(r ?? "")).filter(Boolean)
    : opts.reasons == null
      ? []
      : [String(opts.reasons)];
  if (opts.gatePass) {
    return {
      proceed: true, waived: false,
      ledgerEntries: (opts.meta.defect_ledger as DefectLedgerEntry[] | undefined) ?? [],
      reasons: [],
    };
  }
  if (opts.qcMode === "strict") {
    return { proceed: false, waived: false, ledgerEntries: (opts.meta.defect_ledger as DefectLedgerEntry[] | undefined) ?? [], reasons: safeReasons };
  }
  // Learning mode — ALWAYS record + proceed.
  const nextLedger = appendDefectLedger(opts.meta, {
    stage: opts.stage,
    gate: opts.gate,
    page: opts.page ?? null,
    reasons: safeReasons.slice(0, 20),
    attempts: opts.attempts ?? 1,
    evidence_url: opts.evidence_url ?? null,
    round: opts.round ?? null,
  });
  return { proceed: true, waived: true, ledgerEntries: nextLedger, reasons: safeReasons };
}
