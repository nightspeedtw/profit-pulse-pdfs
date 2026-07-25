// Pure helpers for Coloring V2 one-book-at-a-time dispatch.
// No Deno/runtime imports so Vitest can exercise the owner law directly.

export type ColoringV2BookCandidate = {
  id: string;
  stage: string;
  page_count?: number | null;
  stage_attempt_count?: number | null;
  updated_at?: string | null;
  final_pdf_asset_id?: string | null;
  interiors_done?: number | null;
};

export function coloringV2StageRank(stage: string): number {
  if (stage === "publish") return 0;
  if (stage === "pdf") return 1;
  if (stage === "qc") return 2;
  if (stage === "cover") return 3;
  if (stage === "interior_render") return 4;
  if (stage === "page_plan") return 5;
  if (stage === "style_bible") return 6;
  if (stage === "concept") return 7;
  if (stage === "queued") return 8;
  return 99;
}

export function pickClosestColoringV2Book<T extends ColoringV2BookCandidate>(rows: T[]): T | null {
  const sorted = [...rows].sort((a, b) => {
    const ar = a.final_pdf_asset_id ? 0 : coloringV2StageRank(a.stage);
    const br = b.final_pdf_asset_id ? 0 : coloringV2StageRank(b.stage);
    if (ar !== br) return ar - br;
    if (a.stage === "interior_render" && b.stage === "interior_render") {
      const interiorDelta = Number(b.interiors_done ?? 0) - Number(a.interiors_done ?? 0);
      if (interiorDelta !== 0) return interiorDelta;
    }
    const attemptDelta = Number(a.stage_attempt_count ?? 0) - Number(b.stage_attempt_count ?? 0);
    if (attemptDelta !== 0) return attemptDelta;
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
  });
  return sorted[0] ?? null;
}

export function shouldSpendForRenderPage(opts: {
  stage: string;
  lockAcquired: boolean;
  requestedPage: number;
  pageCount: number;
  pageAlreadyRendered: boolean;
}): { allowed: boolean; reason?: string } {
  if (opts.stage !== "interior_render") return { allowed: false, reason: "wrong_stage" };
  if (!opts.lockAcquired) return { allowed: false, reason: "waiting_for_lock" };
  if (!Number.isFinite(opts.requestedPage) || opts.requestedPage < 1 || opts.requestedPage > opts.pageCount) {
    return { allowed: false, reason: "render_page_out_of_range" };
  }
  if (opts.pageAlreadyRendered) return { allowed: false, reason: "page_already_rendered" };
  return { allowed: true };
}