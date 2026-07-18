// Coloring-book TRIM CONTRACT — profile-driven per book.
//
// Phase A (2026-07-19, owner directive): coloring books now support TWO
// trim profiles. Every book row carries `metadata.trim_profile` and the
// pipeline must resolve dims from that stamp — NEVER from a global
// constant flip. Legacy 8.5×11 books stay on `letter_portrait`; new
// coloring books default to `square_8_5`.
//
// Owner law: missing/unknown profile FAILS LOUDLY for rows that could
// carry the stamp (created on or after the cutoff below). Rows that
// predate the field default to `letter_portrait`.

export type TrimProfileKey = "letter_portrait" | "square_8_5";

export interface TrimProfile {
  key: TrimProfileKey;
  widthIn: number;
  heightIn: number;
  ratio: number;
  toleranceRatio: number;
  pdf: { widthPt: number; heightPt: number };
  coverPx: { width: number; height: number };
  interiorPx: { width: number; height: number };
  thumbnailPx: { width: number; height: number };
  /** Runware Ideogram grid pick (native ratio + fallback pair). */
  runwareIdeogram: {
    width: number; height: number;
    fallbackWidth: number; fallbackHeight: number;
  };
  /** OpenAI gpt-image-1 supported size closest to the trim ratio. */
  gptImageSize: "1024x1024" | "1024x1536" | "1536x1024";
  /** Interior model image_size preset. */
  interiorImageSize: "square_hd" | "portrait_4_3";
  aspectLabel: string;
}

export const TRIM_PROFILES: Record<TrimProfileKey, TrimProfile> = {
  letter_portrait: {
    key: "letter_portrait",
    widthIn: 8.5, heightIn: 11, ratio: 8.5 / 11, toleranceRatio: 0.01,
    pdf: { widthPt: 612, heightPt: 792 },
    coverPx: { width: 1600, height: 2071 },
    interiorPx: { width: 1600, height: 2071 },
    thumbnailPx: { width: 600, height: 776 },
    runwareIdeogram: { width: 1088, height: 1408, fallbackWidth: 896, fallbackHeight: 1152 },
    gptImageSize: "1024x1536",
    interiorImageSize: "portrait_4_3",
    aspectLabel: "8.5x11_portrait",
  },
  square_8_5: {
    key: "square_8_5",
    widthIn: 8.5, heightIn: 8.5, ratio: 1, toleranceRatio: 0.01,
    pdf: { widthPt: 612, heightPt: 612 },
    coverPx: { width: 1600, height: 1600 },
    interiorPx: { width: 1600, height: 1600 },
    thumbnailPx: { width: 600, height: 600 },
    runwareIdeogram: { width: 1024, height: 1024, fallbackWidth: 1024, fallbackHeight: 1024 },
    gptImageSize: "1024x1024",
    interiorImageSize: "square_hd",
    aspectLabel: "8.5x8.5_square",
  },
};

/**
 * Rows whose `created_at` predates this ISO instant may omit
 * `metadata.trim_profile` and default to `letter_portrait`. Rows created
 * on/after this instant MUST carry a valid stamp — missing/unknown
 * profile is a hard error (persistence_contract_bug class).
 */
export const TRIM_PROFILE_CUTOFF_ISO = "2026-07-19T00:00:00Z";

export interface TrimProfileRowLike {
  metadata?: Record<string, any> | null;
  created_at?: string | Date | null;
}

export function resolveTrimProfileKey(row: TrimProfileRowLike): TrimProfileKey {
  const meta = (row?.metadata ?? {}) as Record<string, any>;
  const stamped = typeof meta?.trim_profile === "string" ? meta.trim_profile : null;
  if (stamped) {
    if (!(stamped in TRIM_PROFILES)) {
      throw new Error(
        `trim_profile_unknown:${stamped}:allowed=${Object.keys(TRIM_PROFILES).join("|")}`,
      );
    }
    return stamped as TrimProfileKey;
  }
  const raw = row?.created_at ?? null;
  const createdAt = raw ? new Date(raw as any) : null;
  if (createdAt && !isNaN(createdAt.getTime()) && createdAt < new Date(TRIM_PROFILE_CUTOFF_ISO)) {
    return "letter_portrait";
  }
  throw new Error(
    "trim_profile_missing:new_row_requires_metadata.trim_profile_stamp " +
    "(persistence_contract_bug: cannot mix trim sizes silently)",
  );
}

export function getTrimProfile(row: TrimProfileRowLike): TrimProfile {
  return TRIM_PROFILES[resolveTrimProfileKey(row)];
}

// Back-compat: legacy imports continue to work. Default = letter_portrait.
// New code MUST prefer getTrimProfile(row).
export const COLORING_TRIM = TRIM_PROFILES.letter_portrait;

export type ColoringTrimKind = "cover" | "interior" | "thumbnail" | "pdf_page";

export interface ColoringTrimAssertion {
  pass: boolean;
  kind: ColoringTrimKind;
  profile: TrimProfileKey;
  actual: { width: number; height: number; ratio: number };
  expected: { width: number; height: number; ratio: number };
  reason?: string;
}

/**
 * Assert a raster/PDF-page matches the coloring trim for the given kind
 * and profile. Callers with a row should pass `resolveTrimProfileKey(row)`;
 * legacy call sites without a row default to `letter_portrait` (safe for
 * pre-cutoff books, wrong for new square books — update the caller).
 */
export function assertColoringTrim(
  kind: ColoringTrimKind,
  width: number,
  height: number,
  profileKey: TrimProfileKey = "letter_portrait",
): ColoringTrimAssertion {
  const profile = TRIM_PROFILES[profileKey];
  const spec = kind === "pdf_page"
    ? { width: profile.pdf.widthPt, height: profile.pdf.heightPt }
    : kind === "interior"
    ? profile.interiorPx
    : kind === "thumbnail"
    ? profile.thumbnailPx
    : profile.coverPx;
  const expectedRatio = spec.width / spec.height;
  const actualRatio = width / height;
  const ratioDelta = Math.abs(actualRatio - expectedRatio);
  if (kind === "pdf_page") {
    if (width !== spec.width || height !== spec.height) {
      return {
        pass: false, kind, profile: profileKey,
        actual: { width, height, ratio: actualRatio },
        expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
        reason: `pdf_page_trim_mismatch[${profileKey}]: ${width}x${height}pt != ${spec.width}x${spec.height}pt`,
      };
    }
  } else if (ratioDelta > profile.toleranceRatio) {
    return {
      pass: false, kind, profile: profileKey,
      actual: { width, height, ratio: actualRatio },
      expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
      reason: `${kind}_trim_mismatch[${profileKey}]: ${width}x${height} (w/h=${actualRatio.toFixed(4)}) differs from ${profile.aspectLabel} (${expectedRatio.toFixed(4)}) by ${(ratioDelta * 100).toFixed(2)}%`,
    };
  }
  return {
    pass: true, kind, profile: profileKey,
    actual: { width, height, ratio: actualRatio },
    expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
  };
}
