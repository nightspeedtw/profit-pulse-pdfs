// Coloring-book pre-publish contract. Three hard requirements, no bypass:
//
//   1. cover_baked_title_only
//      The stored cover.typography_source MUST be "ideogram_verified_integrated".
//      Any legacy "textless_art_plus_svg_overlay" or "*_overlay" cover is
//      REJECTED — owner rule: no flat text stamped on top of art.
//
//   2. trim_verified
//      Cover raster matches 8.5:11 within tolerance and PDF page geometry
//      is 612×792pt. Enforced via assertColoringTrim() upstream; here we
//      re-verify the persisted metadata evidence.
//
//   3. thumbnail_distinct_and_fitted
//      ebooks_kids.thumbnail_url MUST exist, MUST differ from cover_url,
//      MUST have thumbnail_render_meta.non_crop_pass = true, and MUST have
//      thumbnail_render_meta.canvas matching COLORING_TRIM.thumbnailPx.
//
// If any of these fail, publish is blocked; the book is demoted to draft
// with a specific blocker_reason so the autopilot can remedy the exact
// defect (typically: re-generate cover via ideogram, then run
// coloring-book-thumbnail).

import { COLORING_TRIM } from "./trim-lock.ts";

export interface ColoringPublishContractInput {
  book_type: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ColoringPublishContractResult {
  pass: boolean;
  reasons: string[];
  contract_version: string;
  checks: {
    cover_baked_title_only: boolean;
    trim_verified: boolean;
    thumbnail_distinct_and_fitted: boolean;
  };
}

export const COLORING_PUBLISH_CONTRACT_VERSION = "coloring_cover_thumbnail_contract_v1";

export function assertColoringPublishContract(
  input: ColoringPublishContractInput,
): ColoringPublishContractResult {
  const reasons: string[] = [];
  const meta = (input.metadata ?? {}) as Record<string, any>;
  const cover = (meta.coloring_cover ?? {}) as Record<string, any>;
  const gateSc = (meta.coloring_cover_gate?.scorecard
    ?? cover?.measured_gate?.scorecard
    ?? {}) as Record<string, any>;
  const treatment = cover.title_treatment ?? {};
  const thumbMeta = (meta.thumbnail_render_meta ?? {}) as Record<string, any>;

  // 1. Baked title only
  const typographySource = String(
    treatment.typography_source
      ?? cover.typography_source
      ?? gateSc?.evidence?.typography_source
      ?? "",
  );
  const overlayApplied = treatment.overlay_applied === true
    || String(cover?.evidence?.overlay_transcription?.reason ?? "")
      .includes("svg_overlay");
  const bakedOnly = typographySource === "ideogram_verified_integrated"
    && !overlayApplied;
  if (!bakedOnly) {
    reasons.push(
      `cover_style_violation:typography_source=${typographySource || "unknown"};overlay_applied=${overlayApplied}`,
    );
  }

  // 2. Trim verified
  const coverCanvas = cover.art_canvas ?? {};
  const cw = Number(coverCanvas.width ?? 0);
  const ch = Number(coverCanvas.height ?? 0);
  const expectedRatio = COLORING_TRIM.ratio;
  const trimOk = cw > 0 && ch > 0
    && Math.abs(cw / ch - expectedRatio) <= COLORING_TRIM.toleranceRatio;
  if (!trimOk) {
    reasons.push(`trim_mismatch:cover=${cw}x${ch};expected_ratio=${expectedRatio.toFixed(4)}`);
  }

  // 3. Distinct fitted thumbnail
  const distinct = !!input.thumbnail_url
    && !!input.cover_url
    && input.thumbnail_url !== input.cover_url;
  const nonCrop = thumbMeta.non_crop_pass === true;
  const canvasOk = Number(thumbMeta?.canvas?.width) === COLORING_TRIM.thumbnailPx.width
    && Number(thumbMeta?.canvas?.height) === COLORING_TRIM.thumbnailPx.height;
  const thumbOk = distinct && nonCrop && canvasOk;
  if (!thumbOk) {
    reasons.push(
      `thumbnail_contract_fail:distinct=${distinct};non_crop=${nonCrop};canvas_ok=${canvasOk}`,
    );
  }

  return {
    pass: reasons.length === 0,
    reasons,
    contract_version: COLORING_PUBLISH_CONTRACT_VERSION,
    checks: {
      cover_baked_title_only: bakedOnly,
      trim_verified: trimOk,
      thumbnail_distinct_and_fitted: thumbOk,
    },
  };
}
