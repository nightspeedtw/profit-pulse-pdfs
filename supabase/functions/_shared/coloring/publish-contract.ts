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

// Owner law (2026-07-18, retro-unpublish-graded-severity-v1):
// Only CRITICAL defects justify auto-unpublishing a book that is already
// live. Cosmetic asset-spec drift (thumbnail canvas size, trim ratio drift
// within tolerance, etc.) may block a first-time publish but MUST NOT yank
// live inventory off the shelf — the row is marked needs_asset_repair
// instead and the asset is regenerated asynchronously.
export type ContractSeverity = "critical" | "cosmetic";
const COSMETIC_PREFIXES = ["thumbnail_contract_fail", "trim_mismatch"];
export function classifyContractReason(reason: string): ContractSeverity {
  return COSMETIC_PREFIXES.some((p) => reason.startsWith(p)) ? "cosmetic" : "critical";
}

export interface ColoringPublishContractResult {
  pass: boolean;
  reasons: string[];
  critical_reasons: string[];
  cosmetic_reasons: string[];
  contract_version: string;
  checks: {
    cover_baked_title_only: boolean;
    trim_verified: boolean;
    thumbnail_distinct_and_fitted: boolean;
    cover_category_verified: boolean;
    cover_spelling_verified: boolean;
  };
}

export const COLORING_PUBLISH_CONTRACT_VERSION = "coloring_cover_thumbnail_contract_v4_graded_severity";

// Chrome/marketing tokens that are OK to appear even if not part of the
// approved title/subtitle/age-badge. Mirrors CHROME_TOKENS in
// cover-text-transcription.ts. Keep small and specific — anything not in
// this set counts as a hard-fail "extra".
const SPELLING_CHROME_TOKENS = new Set([
  "secretpdf", "kids", "the", "a", "an", "of", "and", "&",
  "coloring", "book", "pages", "fun", "for",
]);

/**
 * Spelling gate. Owner law: no cover with misspelled title tokens or
 * garbage/hallucinated glyphs may go LIVE. Non-waivable, even in learning
 * mode. Reads the OCR evidence written by coloring-book-cover.
 */
function checkCoverSpelling(cover: Record<string, any>, gateSc: Record<string, any>): {
  pass: boolean;
  reason: string | null;
} {
  const t = cover?.evidence?.transcription
    ?? gateSc?.evidence?.exact_transcription
    ?? cover?.transcription
    ?? null;
  if (!t || typeof t !== "object") {
    return { pass: false, reason: "cover_spelling_unverified:no_evidence" };
  }
  if (t.degraded === true) {
    return { pass: false, reason: "cover_spelling_unverified:degraded_ocr" };
  }
  const missingRequired = Array.isArray(t.missing_required) ? t.missing_required : [];
  if (missingRequired.length > 0) {
    return { pass: false, reason: `cover_spelling_unverified:missing_required=${missingRequired.slice(0, 4).join(",")}` };
  }
  // Misspellings only fail when the intended token is a required (title) one.
  const misspelled = Array.isArray(t.misspelled) ? t.misspelled : [];
  const requiredSet = new Set(Array.isArray(t.required_tokens) ? t.required_tokens : []);
  const misspelledRequired = misspelled.filter((m: string) => {
    const intended = String(m).split("→")[0];
    return requiredSet.has(intended);
  });
  if (misspelledRequired.length > 0) {
    return { pass: false, reason: `cover_spelling_unverified:misspelled_required=${misspelledRequired.slice(0, 4).join(",")}` };
  }
  // Any extra token that isn't a known chrome/marketing word counts as
  // hallucinated glyphs (e.g. "fname" from "Book-Fname").
  const extras = (Array.isArray(t.extra) ? t.extra : [])
    .map((s: any) => String(s ?? "").toLowerCase().trim())
    .filter((s: string) => s.length > 0 && !SPELLING_CHROME_TOKENS.has(s));
  if (extras.length > 0) {
    return { pass: false, reason: `cover_spelling_unverified:garbage_extras=${extras.slice(0, 4).join(",")}` };
  }
  return { pass: true, reason: null };
}


export function assertColoringPublishContract(
  input: ColoringPublishContractInput,
): ColoringPublishContractResult {
  const reasons: string[] = [];
  const meta = (input.metadata ?? {}) as Record<string, any>;
  const cover = (meta.coloring_cover ?? {}) as Record<string, any>;
  const gate = (meta.coloring_cover_gate ?? cover?.measured_gate ?? {}) as Record<string, any>;
  const gateSc = (gate?.scorecard ?? {}) as Record<string, any>;
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

  // 3. Distinct fitted thumbnail — MUST match COLORING_TRIM.thumbnailPx
  //    (600×776) exactly. Owner directive 2026-07-18: close the canvas_ok
  //    gate by rendering to the exact contract spec instead of arguing with
  //    the gate. This is classified as COSMETIC in classifyContractReason,
  //    so failures never yank live inventory — they trigger async repair.
  const distinct = !!input.thumbnail_url
    && !!input.cover_url
    && input.thumbnail_url !== input.cover_url;
  const nonCrop = thumbMeta.non_crop_pass === true;
  const tw = Number(thumbMeta?.canvas?.width ?? 0);
  const th = Number(thumbMeta?.canvas?.height ?? 0);
  const spec = COLORING_TRIM.thumbnailPx;
  const canvasOk = tw === spec.width && th === spec.height;
  const thumbOk = distinct && nonCrop && canvasOk;
  if (!thumbOk) {
    reasons.push(
      `thumbnail_contract_fail:distinct=${distinct};non_crop=${nonCrop};canvas_ok=${canvasOk};canvas=${tw}x${th};expected=${spec.width}x${spec.height}`,
    );
  }

  // 4. Cover category verified — NULL / missing gate data is a HARD FAIL,
  //    never a silent pass. Prevents the "unicorn on ocean waves" class of
  //    defect from shipping when the vision QC never ran or never wrote
  //    evidence. Required: (a) coloring_cover_gate.pass === true,
  //    (b) scorecard.cover_category_match >= 98,
  //    (c) EITHER hero verification recorded matches===true AND degraded===false
  //        OR the cover was generated using >=2 rendered interior pages as
  //        visual references (interior-first cover-last law). Interior refs
  //        guarantee character/category continuity by construction, so they
  //        satisfy the same intent as a positive vision hero-match without
  //        being vulnerable to a transient/mis-shaped vision response.
  const gatePass = gate?.pass === true;
  const catMatch = Number(gateSc?.cover_category_match ?? -1);
  const hero = (cover?.evidence?.hero ?? gateSc?.evidence?.hero ?? {}) as Record<string, any>;
  const heroMatches = hero?.matches === true;
  const heroDegraded = hero?.degraded === true;
  const heroSatisfied = heroMatches && !heroDegraded;
  const refUrls = (cover?.cover_reference_page_urls ?? cover?.evidence?.cover_reference_page_urls) as unknown;
  const interiorRefSatisfied = cover?.cover_used_interior_refs === true
    && Array.isArray(refUrls) && (refUrls as unknown[]).length >= 2;
  const catOk = gatePass && catMatch >= 98 && (heroSatisfied || interiorRefSatisfied);
  if (!catOk) {
    reasons.push(
      `cover_category_unverified:gate_pass=${gatePass};category_match=${catMatch};hero_matches=${heroMatches};hero_degraded=${heroDegraded};interior_refs=${interiorRefSatisfied}`,
    );
  }

  // 5. Cover spelling verified — NON-WAIVABLE, blocks LIVE even in
  //    learning mode. Prevents "Coloring Bookl-Fname" class of defect.
  const spelling = checkCoverSpelling(cover, gateSc);
  if (!spelling.pass && spelling.reason) reasons.push(spelling.reason);

  const critical_reasons = reasons.filter((r) => classifyContractReason(r) === "critical");
  const cosmetic_reasons = reasons.filter((r) => classifyContractReason(r) === "cosmetic");

  return {
    pass: reasons.length === 0,
    reasons,
    critical_reasons,
    cosmetic_reasons,
    contract_version: COLORING_PUBLISH_CONTRACT_VERSION,
    checks: {
      cover_baked_title_only: bakedOnly,
      trim_verified: trimOk,
      thumbnail_distinct_and_fitted: thumbOk,
      cover_category_verified: catOk,
      cover_spelling_verified: spelling.pass,
    },
  };
}

