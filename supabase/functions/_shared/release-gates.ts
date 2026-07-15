// Phase 9 — Release Gates (TypeScript port + assertion).
//
// Mirrors .agents/skills/secretpdf-production-suite/scripts/validate_release_manifest.py
// so the same non-negotiable contract is enforced both in-process (before we
// mark a book publishable) and out-of-band (CI / operator script).
//
// A book MAY only be flipped to `pipeline_status='published'` (or any state
// downstream of `final_pdf_ready`) if `validateReleaseManifest()` returns []
// — no errors. Any error is a release-blocking defect. NEVER weaken the
// thresholds; that is a gate bypass under the P0 standing rules.

// ---------------------------------------------------------------------------
// Contract constants (must stay in sync with the Python validator).
// ---------------------------------------------------------------------------

export const REQUIRED_ASSET_BOOLEANS: Readonly<Record<string, boolean>> = Object.freeze({
  cover_present: true,
  cover_blank: false,
  final_pdf_present: true,
  final_pdf_opens: true,
  thumbnail_present: true,
});

export const ZERO_DEFECTS: readonly string[] = Object.freeze([
  "duplicate_pages",
  "duplicate_text_blocks",
  "duplicate_image_hashes",
  "raw_markdown",
  "html_comments",
  "watermarks",
  "random_image_text",
  "truncated_text",
  "metadata_mismatches",
  "unverified_public_claims",
  "placeholder_assets",
]);

export const MIN_SCORES: Readonly<Record<string, number>> = Object.freeze({
  character_consistency: 95,
  cover_to_interior_match: 95,
  style_consistency: 95,
  page_continuity: 95,
  text_image_match: 95,
  story_chronology: 98,
  age_appropriateness: 95,
  typography_layout: 95,
  cover_quality: 90,
  thumbnail_quality: 90,
  sales_page_sanitization: 100,
  product_metadata_match: 100,
  final_sellable: 92,
});

export const REQUIRED_PROOF_BOOLEANS: readonly string[] = Object.freeze([
  "original_fixture_passed",
  "clean_install",
  "typecheck",
  "tests",
  "build",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReleaseManifest {
  final_status: "final_pdf_ready" | string;
  book_id?: string;
  assets: Record<string, boolean>;
  defect_counts: Record<string, number>;
  scores: Record<string, number>;
  proof: {
    original_fixture_passed?: boolean;
    clean_install?: boolean;
    typecheck?: boolean;
    tests?: boolean;
    build?: boolean;
    consecutive_fresh_books_passed?: number;
    manual_db_edits?: number;
    threshold_reductions?: number;
    gate_bypasses?: number;
    [k: string]: unknown;
  };
}

export class ReleaseBlocked extends Error {
  readonly errors: string[];
  readonly manifest: ReleaseManifest;
  constructor(errors: string[], manifest: ReleaseManifest) {
    super(`ReleaseBlocked: ${errors.length} gate error(s): ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "; …" : ""}`);
    this.name = "ReleaseBlocked";
    this.errors = errors;
    this.manifest = manifest;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

export function validateReleaseManifest(m: ReleaseManifest): string[] {
  const errors: string[] = [];

  if (m.final_status !== "final_pdf_ready") {
    errors.push("final_status must equal 'final_pdf_ready'");
  }

  const assets = m.assets;
  if (!assets || typeof assets !== "object") {
    errors.push("assets must be an object");
  } else {
    for (const [k, expected] of Object.entries(REQUIRED_ASSET_BOOLEANS)) {
      if (assets[k] !== expected) errors.push(`assets.${k} must be ${expected}`);
    }
  }

  const d = m.defect_counts;
  if (!d || typeof d !== "object") {
    errors.push("defect_counts must be an object");
  } else {
    for (const k of ZERO_DEFECTS) {
      const v = d[k];
      if (!isNumber(v)) errors.push(`defect_counts.${k} must be numeric`);
      else if (v !== 0) errors.push(`defect_counts.${k} must equal 0, got ${v}`);
    }
  }

  const s = m.scores;
  if (!s || typeof s !== "object") {
    errors.push("scores must be an object");
  } else {
    for (const [k, min] of Object.entries(MIN_SCORES)) {
      const v = s[k];
      if (!isNumber(v)) errors.push(`scores.${k} must be numeric`);
      else if (v < min) errors.push(`scores.${k} must be >= ${min}, got ${v}`);
    }
  }

  const p = m.proof;
  if (!p || typeof p !== "object") {
    errors.push("proof must be an object");
  } else {
    for (const k of REQUIRED_PROOF_BOOLEANS) {
      if ((p as Record<string, unknown>)[k] !== true) errors.push(`proof.${k} must be true`);
    }
    const fresh = p.consecutive_fresh_books_passed;
    if (typeof fresh !== "number" || !Number.isInteger(fresh) || fresh < 3) {
      errors.push("proof.consecutive_fresh_books_passed must be an integer >= 3");
    }
    for (const k of ["manual_db_edits", "threshold_reductions", "gate_bypasses"] as const) {
      const v = p[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v !== 0) {
        errors.push(`proof.${k} must be integer 0`);
      }
    }
  }

  return errors;
}

/** Throw ReleaseBlocked if the manifest fails any gate. Use before flipping to published. */
export function assertReleaseReady(m: ReleaseManifest): void {
  const errors = validateReleaseManifest(m);
  if (errors.length) throw new ReleaseBlocked(errors, m);
}
