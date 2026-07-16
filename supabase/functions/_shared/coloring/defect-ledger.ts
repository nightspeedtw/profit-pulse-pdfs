// Batch-learning defect ledger (owner law: batch_learning_rounds).
//
// After WAIVER_REPAIR_ATTEMPTS quick repair attempts fail on the same
// page/gate, the pipeline records the defect and PROCEEDS to the next
// stage with the best available asset. Measurement never stops — we
// keep the verdicts. Only the repair loop is capped.
//
// The ledger drives the round_report: aggregated class×stage×subject
// frequencies feed the consolidated-skill upgrade between rounds.
//
// Hard exceptions that can NEVER be waived (still enforced elsewhere):
//   - missing pdf_url / cover_url / zero-byte assets
//     (DB invariant `ebooks_kids_live_assets_guard` enforces these)

export const WAIVER_REPAIR_ATTEMPTS = 2;

export interface DefectLedgerEntry {
  stage: string;              // 'assemble' | 'render' | 'cover' | 'publish' | ...
  gate: string;               // 'anatomy' | 'sharpness' | 'text' | 'cover_gate' | ...
  page?: number | null;       // interior page number, null for cover/book-level
  reasons: string[];          // raw failure reasons
  attempts: number;           // how many repair cycles ran before waiver
  evidence_url?: string | null;
  waived_at: string;          // ISO
  round?: number | null;      // learning_round when waived
}

export function appendDefectLedger(
  meta: Record<string, unknown>,
  entry: Omit<DefectLedgerEntry, "waived_at"> & { waived_at?: string },
): DefectLedgerEntry[] {
  const existing = Array.isArray(meta.defect_ledger)
    ? (meta.defect_ledger as DefectLedgerEntry[])
    : [];
  // De-dupe by stage+gate+page — keep the latest reasons/attempts.
  const key = `${entry.stage}|${entry.gate}|${entry.page ?? ""}`;
  const filtered = existing.filter((e) => `${e.stage}|${e.gate}|${e.page ?? ""}` !== key);
  const stamped: DefectLedgerEntry = {
    waived_at: new Date().toISOString(),
    round: null,
    ...entry,
  };
  return [...filtered, stamped];
}

export function defectLedgerIsClean(meta: Record<string, unknown>): boolean {
  const ledger = Array.isArray(meta.defect_ledger)
    ? (meta.defect_ledger as DefectLedgerEntry[])
    : [];
  return ledger.length === 0;
}
