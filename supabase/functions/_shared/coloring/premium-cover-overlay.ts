// Premium cover overlay — RETIRED.
//
// OWNER LAW `cover_bake_only_v6` (2026-07-21):
//   No SVG/typography overlay is ever composited on top of a coloring-book
//   cover. Ideogram bakes the title AND the "Ages X-Y" mark directly into
//   the illustration. If it fails, we retry the bake — we NEVER add text on
//   top afterward. This eliminates the popup-text failure class permanently.
//
//   The module is kept as a no-op stub so any lingering imports resolve, but
//   `renderPremiumCoverOverlayPng` returns a transparent 1x1 PNG and
//   `compositeOverlayOntoArt` returns the base bytes unchanged.
//
// SCOPE: coloring books only.
//
// @ts-nocheck  Deno edge runtime

export const COVER_OVERLAY_CONTRACT = "cover_bake_only_v6_no_overlay_ever" as const;

export function overlayIsCurrent(meta: Record<string, any> | null | undefined): boolean {
  return !!meta && meta.overlay === COVER_OVERLAY_CONTRACT;
}

export interface PremiumOverlayInput {
  width: number;
  height: number;
  ageBadge?: string;
  ribbonText?: string;
  showRibbon?: boolean;
  topLabel?: string;
  subtitle?: string;
  blurb?: string;
  fallbackTitle?: string;
}

/** Kept for backwards-compat inspection. Emits an empty SVG. */
export function buildOverlaySvg(input: PremiumOverlayInput): string {
  const W = input.width, H = input.height;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- ${COVER_OVERLAY_CONTRACT}: intentionally empty. Cover text is baked by Ideogram only. -->
</svg>`;
}

// Transparent 1x1 PNG bytes (base64-decoded once at module load).
const TRANSPARENT_1x1_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
), (c) => c.charCodeAt(0));

/** No-op: returns a transparent 1x1 PNG. Kept only so old imports resolve. */
export async function renderPremiumCoverOverlayPng(_input: PremiumOverlayInput): Promise<Uint8Array> {
  return TRANSPARENT_1x1_PNG;
}

/** No-op: returns the base art unchanged. */
export async function compositeOverlayOntoArt(
  artBytes: Uint8Array,
  _overlayPng: Uint8Array,
): Promise<Uint8Array> {
  return artBytes;
}
