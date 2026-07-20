// Frontend mirror of the cover-overlay contract.
//
// OWNER LAW `cover_bake_only_v6` (2026-07-21):
//   No SVG/HTML text is ever composited on top of a coloring cover. Ideogram
//   bakes the title AND the "Ages X-Y" mark directly. This module exists
//   only so frontend regression tests can assert the contract string and so
//   any legacy import path still resolves.

export const COVER_OVERLAY_CONTRACT = "cover_bake_only_v6_no_overlay_ever" as const;

export function overlayIsCurrent(meta: Record<string, any> | null | undefined): boolean {
  return !!meta && meta.overlay === COVER_OVERLAY_CONTRACT;
}

export interface PremiumOverlayInput {
  width: number;
  height: number;
  ageBadge?: string;
  fallbackTitle?: string;
}

/** Empty SVG — no overlay elements are ever drawn. */
export function buildOverlaySvg(input: PremiumOverlayInput): string {
  const W = input.width, H = input.height;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- ${COVER_OVERLAY_CONTRACT}: intentionally empty. -->
</svg>`;
}
