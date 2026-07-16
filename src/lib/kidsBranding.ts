// NOTE: keep in sync with supabase/functions/_shared/kids-branding-policy.ts (kids_branding v1).
// Kids-book branding policy — pure, runtime-neutral module.
//
// Owner order 2026-07-16: every kids interior page carries the SecretPDF Kids
// logo (bottom-right corner) and a "© secretpdf.co" caption (bottom-left).
// The layout engine — never the AI illustration — draws both. This module
// owns the constants and the deterministic heuristic that decides when the
// logo would harm a page's art (dark full-bleed scenes, climax spreads with
// a busy bottom-right) so the layout can gracefully omit it.
//
// This file has zero Deno / pdf-lib / DOM dependencies so it can be unit
// tested from vitest AND imported unchanged by the Supabase edge function.

/** Canonical CDN URLs for the kids brand assets (uploaded via lovable-assets). */
export const KIDS_BRAND_ASSETS = {
  // Full horizontal lockup — used in storefront headers and title page.
  full: "/__l5e/assets-v1/dd11326e-a17c-44fe-bc4b-e12316d162ec/secretpdf-kids-logo.png",
  // Whitespace-trimmed + white-to-transparent variant for corner footers.
  footer: "/__l5e/assets-v1/f42163b0-0dc9-44a2-b7ef-518b2f925ab5/secretpdf-kids-logo-footer.png",
  // Square crop (paper character + shield) — useful for chips / favicons.
  mark: "/__l5e/assets-v1/871ef258-5c41-4fd9-bb5f-57f03f6b742e/secretpdf-kids-mark.png",
} as const;

/** Native pixel dimensions of the trimmed footer PNG. Encoded here so the PDF
 *  drawer can compute the target rect without decoding the file. */
export const KIDS_BRAND_FOOTER_DIMS = { w: 1832, h: 505 } as const;

/** Layout constants — points, matching kids-book-format (612 × 612 pt page). */
export const KIDS_BRAND_LAYOUT = {
  /** Bottom-right logo target width, as fraction of page width. */
  logo_frac: 0.13,          // 13% — inside owner range 12–14%
  /** Minimum render width in pt (~1.33 pt = 1 px @96dpi). */
  logo_min_pt: 72,          // ≈ 96 px @96dpi
  /** Safe margin from trim (matches SKILL A safe-frame). */
  safe_margin_pt: 24,
  /** Copyright caption font size and text. */
  copyright_pt: 8,
  copyright_text: "© secretpdf.co",
} as const;

/**
 * Owner's aesthetic-exception heuristic. Given a summary of the bottom-right
 * corner of the AI illustration, decide whether the logo would sit cleanly.
 *
 * Inputs are the ones we can cheaply compute from `computeLuminance` sampled
 * over a corner sub-region:
 *   - `mean`   0..255 luminance
 *   - `variance` pixel variance on the sampled grid
 *
 * Returns:
 *   - `logo`      true when the logo is safe to draw
 *   - `copyright` true when the © line is safe to draw
 *   - `reason`    machine-readable reason when either is skipped
 *
 * The copyright line uses warm-ink on translucent panel and is legible on
 * almost anything — we only skip it on catastrophic contrast (extremely dark
 * AND high-variance). The logo is more sensitive: its multi-hue glyphs clash
 * with dark scenes and get lost on busy scenes.
 */
export interface CornerStats { mean: number; variance: number }
export interface BrandingDecision {
  logo: boolean;
  copyright: boolean;
  reason: string | null;
}

export function decideBrandingForCorner(stats: CornerStats): BrandingDecision {
  const { mean, variance } = stats;
  // Copyright line — skip only when the corner is nearly black AND noisy.
  const copyright = !(mean < 20 && variance > 1500);
  // Logo — skip if:
  //  - corner is dark (dark hues would swallow the mostly-dark-blue wordmark)
  //  - corner is extremely busy (variance > 3500) which means dense art
  //  - corner is extremely bright (mean > 245) — logo has light strokes that vanish
  let logo = true;
  let reason: string | null = null;
  if (mean < 45) { logo = false; reason = "corner_too_dark"; }
  else if (mean > 245) { logo = false; reason = "corner_too_bright"; }
  else if (variance > 3500) { logo = false; reason = "corner_too_busy"; }
  return { logo, copyright, reason: (logo && copyright) ? null : (reason ?? "copyright_skipped") };
}

/** Which interior page kinds carry branding. Cover is always excluded. */
export type KidsPageKind =
  | "cover"
  | "title"
  | "copyright"
  | "story"
  | "spot_the_clues"
  | "talk_about_story"
  | "the_end";

export function pageKindAllowsBranding(kind: KidsPageKind): boolean {
  return kind !== "cover";
}

/** Compute a corner rect (in page-pt coords, origin bottom-left) for the logo. */
export function computeLogoRect(pageWpt: number, pageHpt: number) {
  const L = KIDS_BRAND_LAYOUT;
  const targetW = Math.max(L.logo_min_pt, pageWpt * L.logo_frac);
  const scale = targetW / KIDS_BRAND_FOOTER_DIMS.w;
  const w = targetW;
  const h = KIDS_BRAND_FOOTER_DIMS.h * scale;
  const x = pageWpt - L.safe_margin_pt - w;
  const y = L.safe_margin_pt;
  return { x, y, w, h };
}
