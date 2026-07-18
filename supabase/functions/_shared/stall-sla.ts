// Global Stall SLA — pure logic used by the stall-watchdog function AND by
// vitest regression tests. No Deno imports.
//
// LAW (owner order, permanent):
//   Any ebooks_kids row in a non-terminal status whose progress evidence
//   has not advanced in STALL_THRESHOLD_MS is a STALL. The watchdog must:
//     1. Write a stall_event row BEFORE reacting (silent idle = impossible).
//     2. Apply exactly ONE wired reaction:
//          - "advance_regime"    → for coloring rows in 'failed' with dead
//                                  pages under a newer repair-regime version
//          - "resume_checkpoint" → for rows in a build/render stage whose
//                                  checkpoint (page count, cover, pdf) is
//                                  partial and can be resumed by
//                                  re-invoking the same stage function
//          - "surface_blocker"   → otherwise, tag the row with a
//                                  machine-readable blocker and stop
//                                  quietly retrying
//     3. If a pipeline_skills entry already claims this blocker_class is
//        fixed AND the stall fires again → set repeat_after_fix=true
//        (fake-fix alarm).

export const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
export const TERMINAL_STATUSES = new Set(["published", "retired"]);

export type Reaction = "advance_regime" | "resume_checkpoint" | "surface_blocker";

export interface StallCandidate {
  id: string;
  book_type: string;                 // 'coloring_book' | 'picture_book'
  pipeline_status: string;
  updated_at: string;                // last row mutation
  cover_url: string | null;
  pdf_url: string | null;
  listing_status: string | null;
  metadata: Record<string, unknown>;
}

export interface StallDecision {
  is_stalled: boolean;
  age_ms: number;
  blocker_class: string;
  reaction: Reaction;
  step_label: string | null;
  awaiting: string | null;
  regime_version: string | null;
  evidence: Record<string, unknown>;
}

/** Extract the most recent progress timestamp for a row. */
export function lastProgressAt(row: StallCandidate): number {
  const candidates: Array<string | undefined> = [row.updated_at];
  const meta = row.metadata ?? {};
  for (const k of [
    "coloring_render_started_at",
    "coloring_render_completed_at",
    "coloring_last_requeued_at",
    "coloring_calibration_approved_at",
    "coloring_calibration_completed_at",
    "kids_last_heartbeat_at",
    "kids_pdf_build_started_at",
  ]) {
    const v = (meta as Record<string, unknown>)[k];
    if (typeof v === "string") candidates.push(v);
  }
  const cover = (meta.coloring_cover_ladder as { updated_at?: string } | undefined)?.updated_at;
  if (cover) candidates.push(cover);
  let latest = 0;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}

/** Classify what kind of stall this is + which reaction fits. */
export function decideReaction(
  row: StallCandidate,
  now: number,
  currentColoringRegime: string,
): StallDecision {
  const meta = row.metadata ?? {};
  const step = (meta.coloring_current_step_label as string) ?? (meta.kids_current_step_label as string) ?? null;
  const awaiting = (meta.awaiting as string) ?? null;
  const lastReqRegime = (meta.coloring_last_requeued_regime_version as string | undefined) ?? null;
  const age_ms = now - lastProgressAt(row);
  // A published row missing pdf_url/cover_url or not listed live is
  // NON-terminal (DB invariant). Treat it as stallable like any other.
  const isFullyLive = row.pipeline_status === "published"
    && !!row.pdf_url && !!row.cover_url && row.listing_status === "live";
  const isTerminal = TERMINAL_STATUSES.has(row.pipeline_status) && (row.pipeline_status !== "published" || isFullyLive);
  const is_stalled = !isTerminal && age_ms >= STALL_THRESHOLD_MS;

  // Class 1: coloring row in 'failed' with dead pages, newer regime available.
  if (
    row.book_type === "coloring_book" &&
    row.pipeline_status === "failed" &&
    Array.isArray((meta as any).coloring_dead_pages) &&
    ((meta as any).coloring_dead_pages as number[]).length > 0 &&
    lastReqRegime !== currentColoringRegime
  ) {
    return {
      is_stalled, age_ms,
      blocker_class: "coloring_failed_with_newer_regime",
      reaction: "advance_regime",
      step_label: step, awaiting,
      regime_version: currentColoringRegime,
      evidence: {
        dead_pages: (meta as any).coloring_dead_pages,
        repair_attempts: (meta as any).coloring_repair_attempts ?? {},
        last_errors: ((meta as any).coloring_last_errors ?? []).slice(-5),
        last_requeued_regime_version: lastReqRegime,
      },
    };
  }

  // Class 2: mid-pipeline active status with no blocker AND no in-flight
  // owner — the "state nobody owns" family. This includes both partial
  // build stages (queued/generating/pdf_building with checkpoint data) and
  // handoff statuses (awaiting_cover / publishing / running) that a batch
  // update parked the row into but the dispatcher never picks up because
  // its eligibility filter is `pipeline_status='queued'` only.
  const inBuild = [
    "queued",
    "generating",
    "pdf_building",
    "awaiting_cover",
    "awaiting_render",
    "awaiting_publish",
    "publishing",
    "running",
  ].includes(row.pipeline_status);
  const hasPartial =
    (row.book_type === "coloring_book" && (
      ((meta as any).coloring_pages as unknown[] | undefined)?.length ??
        (meta as any).coloring_cover_ladder != null
    )) ||
    row.cover_url != null ||
    row.pdf_url != null;
  // For handoff statuses (awaiting_*, publishing, running) the row IS the
  // partial output — no extra evidence required to resume.
  const isHandoffStatus = ["awaiting_cover","awaiting_render","awaiting_publish","publishing","running"]
    .includes(row.pipeline_status);
  if (inBuild && (hasPartial || isHandoffStatus)) {
    return {
      is_stalled, age_ms,
      blocker_class: isHandoffStatus
        ? `handoff_status_no_owner:${row.pipeline_status}`
        : "build_stage_stale_heartbeat",
      reaction: "resume_checkpoint",
      step_label: step, awaiting,
      regime_version: (meta as any).coloring_regime_version ?? null,
      evidence: {
        awaiting,
        step_label: step,
        cover_ladder_index: ((meta as any).coloring_cover_ladder as any)?.next_index ?? null,
        stored_pages: ((meta as any).coloring_pages as unknown[] | undefined)?.length ?? 0,
        has_cover: row.cover_url != null,
        has_pdf: row.pdf_url != null,
      },
    };
  }


  // Class 3: everything else that has stalled — surface as blocker.
  return {
    is_stalled, age_ms,
    blocker_class: "unclassified_pipeline_stall",
    reaction: "surface_blocker",
    step_label: step, awaiting,
    regime_version: (meta as any).coloring_regime_version ?? null,
    evidence: {
      pipeline_status: row.pipeline_status,
      awaiting,
      step_label: step,
      last_errors: ((meta as any).coloring_last_errors ?? []).slice(-5),
    },
  };
}

/**
 * Decide whether this stall is a repeat-after-fix.
 * Input: pipeline_skills entries whose metadata.defect_class === blocker_class.
 * If any such skill exists AND the stall fires again, this is a fake-fix
 * alarm and we set repeat_after_fix=true so the panel can pause that class.
 */
export function isRepeatAfterFix(
  blocker_class: string,
  skills: Array<{ metadata: Record<string, unknown> | null }>,
): boolean {
  return skills.some((s) => (s.metadata ?? {})["defect_class"] === blocker_class);
}
