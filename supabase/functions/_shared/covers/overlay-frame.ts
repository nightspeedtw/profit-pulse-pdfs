// Pure overlay-frame geometry for the coloring/kids cover title treatment.
//
// Owner defect (3rd occurrence, 2026-07-16): the "Ages 4-6" pill was
// clipped at the right edge and the SecretPDF logo clipped at the left
// edge. Root cause: the previous layout math clamped the pill origin at
// `safe + stroke` but reported the element bbox to the gate using
// `pill{X,Y} - stroke` / `pillW + 2*stroke`, so the reported bbox sat
// exactly on the safe-margin boundary and the SVG stroke rendered
// OUTSIDE the safe zone.
//
// Fix: bake stroke thickness into an `effectiveMargin = safe + stroke*2`
// used for BOTH origin clamping AND the reported bbox, so the gate can
// prove — before rasterization — that every overlay element sits fully
// inside the safe zone. This module lets vitest exercise the geometry
// deterministically (no WASM / no font fetches).

export interface OverlayFrameElement {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayFrame {
  width: number;
  height: number;
  safe_margin: number;
  elements: OverlayFrameElement[];
}

export interface OverlayLayoutInput {
  width: number;
  height: number;
  hasAgeBadge: boolean;
  hasLogo: boolean;
  hasSubtitle: boolean;
  /** Optional title-cluster bbox from the letter-art pass. */
  titleCluster?: OverlayFrameElement | null;
  /** Optional subtitle bbox. */
  subtitleBox?: OverlayFrameElement | null;
}

const PILL_STROKE = 5;
const LOGO_PANEL_PAD_X = 14;
const LOGO_PANEL_PAD_Y = 10;

export function computeOverlayLayout(input: OverlayLayoutInput): OverlayFrame {
  const W = input.width;
  const H = input.height;
  const safe = Math.max(72, Math.round(W * 0.05));
  const effectiveMargin = safe + PILL_STROKE * 2;

  const pillW = Math.min(Math.max(180, Math.round(W * 0.19)), W - 2 * effectiveMargin);
  const pillH = Math.max(60, Math.round(pillW * 0.32));
  const pillX = Math.max(effectiveMargin, W - effectiveMargin - pillW);
  const pillY = Math.max(effectiveMargin, H - effectiveMargin - pillH);

  const logoW = Math.min(Math.round(W * 0.12), W - 2 * effectiveMargin - LOGO_PANEL_PAD_X * 2);
  // Panel dims come from KIDS_BRAND_FOOTER_DIMS.h / w (approx 0.276 for the
  // current asset); we don't import to keep this file dep-free — the test
  // asserts on the pill and logo *panel bbox*, which is what the gate reads.
  const logoAspect = 0.276;
  const logoH = Math.round(logoW * logoAspect);
  const logoX = effectiveMargin + LOGO_PANEL_PAD_X;
  const logoY = H - effectiveMargin - logoH - LOGO_PANEL_PAD_Y;

  const elements: OverlayFrameElement[] = [];
  if (input.titleCluster) elements.push(input.titleCluster);
  if (input.hasSubtitle && input.subtitleBox) elements.push(input.subtitleBox);
  if (input.hasAgeBadge) {
    elements.push({
      name: "age_badge",
      x: pillX - PILL_STROKE,
      y: pillY - PILL_STROKE,
      w: pillW + PILL_STROKE * 2,
      h: pillH + PILL_STROKE * 2,
    });
  }
  if (input.hasLogo) {
    elements.push({
      name: "secretpdf_kids_logo",
      x: logoX - LOGO_PANEL_PAD_X,
      y: logoY - LOGO_PANEL_PAD_Y,
      w: logoW + LOGO_PANEL_PAD_X * 2,
      h: logoH + LOGO_PANEL_PAD_Y * 2,
    });
  }
  return { width: W, height: H, safe_margin: safe, elements };
}

export function assertOverlayInsideSafeMargin(frame: OverlayFrame): { pass: boolean; clipped: string[] } {
  const clipped: string[] = [];
  const min = frame.safe_margin;
  const maxX = frame.width - frame.safe_margin;
  const maxY = frame.height - frame.safe_margin;
  for (const el of frame.elements) {
    if (el.x < min || el.y < min || el.x + el.w > maxX || el.y + el.h > maxY) {
      clipped.push(el.name);
    }
  }
  return { pass: clipped.length === 0, clipped };
}
