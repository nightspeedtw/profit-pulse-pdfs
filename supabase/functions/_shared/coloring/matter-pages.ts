// matter-pages.ts — shared, deterministic front/back matter page renderer
// for the coloring lane. Zero extra AI cost per book: decoration comes from
// palette-tinted vector shapes + (optional) grayscaled interior vignette
// bytes the caller already has in memory.
//
// Owner order 2026-07-20: `matter_pages_design_v2`. Applies to BOTH v1
// (`coloring-book-assemble`) and v2 (`coloring-v2-pdf`) assemblers.
//
// Contract:
//   - Age-band styling: `resolveMatterStyle(ageMin, ageMax)` maps to
//     palette + font sizes (2-4 = biggest/warmest, 13-17 = cool/slate).
//   - Every page renderer accepts a page dim (square or portrait works).
//   - Matter pages remain EXEMPT from interior QC gates (caller must not
//     mix them into per-page sharpness/anatomy scoring).
//   - No network fetches. No AI calls. No new asset uploads.
//
// @ts-nocheck  Deno edge runtime
import { rgb } from "npm:pdf-lib@1.17.1";
import { drawFitText, drawFitParagraph } from "../pdf/shrink-to-fit.ts";
import {
  resolveMatterStyle,
  defaultCopyrightText,
  MATTER_PAGES_DESIGN_VERSION,
  type MatterPalette,
  type MatterStyle,
} from "./matter-pages-style.ts";

// Re-export the pure style API so callers only import this file.
export { resolveMatterStyle, defaultCopyrightText, MATTER_PAGES_DESIGN_VERSION };
export type { MatterPalette, MatterStyle };


// ── decorative primitives (pure pdf-lib) ────────────────────────────────

function c(rgbArr: [number, number, number]) {
  return rgb(rgbArr[0], rgbArr[1], rgbArr[2]);
}

/**
 * Draw a palette-tinted decorative border: outer soft wash rectangle,
 * inner double rule, and 4 corner "confetti dots" from the accent color.
 * Deterministic — no AI, no external assets.
 */
export function drawDecorativeBorder(
  page: any,
  opts: { pageW: number; pageH: number; palette: MatterPalette; inset?: number; heavy?: boolean },
) {
  const { pageW, pageH, palette } = opts;
  const inset = opts.inset ?? 28;
  const heavy = !!opts.heavy;

  // outer tint band (very soft)
  page.drawRectangle({
    x: 0, y: 0, width: pageW, height: pageH,
    color: c(palette.paper),
  });
  // outer border ring
  page.drawRectangle({
    x: inset, y: inset, width: pageW - 2 * inset, height: pageH - 2 * inset,
    borderColor: c(palette.primary), borderWidth: heavy ? 3.5 : 2.2,
    color: undefined,
  });
  // inner thin rule (double-line effect)
  const inset2 = inset + 8;
  page.drawRectangle({
    x: inset2, y: inset2, width: pageW - 2 * inset2, height: pageH - 2 * inset2,
    borderColor: c(palette.accent), borderWidth: 0.7,
    color: undefined,
  });

  // 4 confetti-dot corners: 3 dots each, decreasing in size
  const cornerDot = (cx: number, cy: number, dir: [1 | -1, 1 | -1]) => {
    for (let i = 0; i < 3; i++) {
      const r = (heavy ? 6 : 4.5) - i * 1.1;
      page.drawCircle({
        x: cx + dir[0] * (i * 9),
        y: cy + dir[1] * (i * 6),
        size: r,
        color: c(i === 0 ? palette.primary : palette.accent),
        opacity: 0.85 - i * 0.15,
      });
    }
  };
  cornerDot(inset + 18, pageH - inset - 18, [1, -1]);
  cornerDot(pageW - inset - 18, pageH - inset - 18, [-1, -1]);
  cornerDot(inset + 18, inset + 18, [1, 1]);
  cornerDot(pageW - inset - 18, inset + 18, [-1, 1]);
}

/**
 * Embed up to 2 grayscale-tinted interior vignettes in opposite corners.
 * Reuses page bytes the caller already has — zero new AI cost.
 * `vignettes` = pre-embedded pdf-lib images (caller does the embed once).
 */
export function drawCornerVignettes(
  page: any,
  opts: { pageW: number; pageH: number; style: MatterStyle; vignettes: any[]; opacity?: number },
) {
  const { pageW, pageH, style, vignettes } = opts;
  const opacity = opts.opacity ?? 0.14;
  if (!vignettes || vignettes.length === 0) return;
  const size = pageW * style.cornerVignetteFrac;
  const margin = 44;

  const positions: Array<{ x: number; y: number }> = [
    { x: margin, y: pageH - margin - size },              // top-left
    { x: pageW - margin - size, y: margin },              // bottom-right
  ];
  for (let i = 0; i < Math.min(2, vignettes.length); i++) {
    const img = vignettes[i];
    if (!img) continue;
    const iw = img.width, ih = img.height;
    const scale = Math.min(size / iw, size / ih);
    const w = iw * scale, h = ih * scale;
    page.drawImage(img, {
      x: positions[i].x + (size - w) / 2,
      y: positions[i].y + (size - h) / 2,
      width: w, height: h,
      opacity,
    });
  }
}

/**
 * OWNER LAW `matter_pages_brand_footer_v1` (2026-07-21):
 * Every matter page in the V2 assembler (Title / Copyright / How-to /
 * Certificate) must carry the SecretPDF branding footer: © line on the
 * bottom-left and the logo on the bottom-right. Applied uniformly to
 * avoid the recurring "logo missing on Terms page" defect.
 */
export function drawBrandFooter(
  ctx: { page: any; pageW: number; pageH: number; style: MatterStyle; font: any; logo?: any },
  opts: { copyrightLine?: string } = {},
) {
  const { page, pageW, style, font, logo } = ctx;
  const P = style.palette;
  const marginX = 30;
  const marginY = 22;
  const copyLine = opts.copyrightLine ?? `© ${new Date().getUTCFullYear()} SecretPDF Kids`;

  // © line, bottom-left
  drawFitText(page, {
    text: copyLine,
    x: marginX, y: marginY,
    maxWidth: pageW * 0.55,
    font, size: Math.max(7, style.tinyPt - 1), minSize: 6,
    color: c(P.ink), align: "left",
  });

  // Logo, bottom-right
  if (logo) {
    const maxLogoH = 22;
    const maxLogoW = pageW * 0.28;
    const scale = Math.min(maxLogoW / logo.width, maxLogoH / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, {
      x: pageW - marginX - lw,
      y: marginY - 4,
      width: lw, height: lh,
      opacity: 0.9,
    });
  }
}

// ── page renderers ──────────────────────────────────────────────────────

export interface MatterContext {
  page: any;
  pageW: number;
  pageH: number;
  style: MatterStyle;
  font: any;      // regular
  fontBold: any;
  vignettes?: any[]; // optional embedded pdf-lib images from interior pages
  logo?: any;        // optional embedded SecretPDF brand logo (pdf-lib image)
}


/** Full-page title with warm frame, subtitle, and "This book belongs to" nameplate. */
export function drawColoringTitlePage(
  ctx: MatterContext,
  opts: { title: string; subtitle?: string; brand?: string },
) {
  const { page, pageW, pageH, style, font, fontBold, vignettes } = ctx;
  const P = style.palette;

  drawDecorativeBorder(page, { pageW, pageH, palette: P, inset: 24, heavy: true });
  drawCornerVignettes(page, { pageW, pageH, style, vignettes: vignettes ?? [], opacity: 0.12 });

  // Title zone (upper 55%)
  const titleY = pageH * 0.72;
  drawFitText(page, {
    text: opts.title,
    x: pageW / 2, y: titleY,
    maxWidth: pageW - 120,
    font: fontBold,
    size: style.titlePt,
    minSize: Math.max(18, style.titlePt - 12),
    color: c(P.primary),
    align: "center",
  });
  if (opts.subtitle) {
    drawFitText(page, {
      text: opts.subtitle,
      x: pageW / 2, y: titleY - style.titlePt - 6,
      maxWidth: pageW - 140,
      font, size: style.headingPt - 4,
      minSize: style.minPt,
      color: c(P.ink),
      align: "center",
    });
  }

  // ── "This book belongs to" nameplate ──
  const plateW = pageW * 0.72;
  const plateH = style.band === "teen" ? 88 : 108;
  const plateX = (pageW - plateW) / 2;
  const plateY = pageH * 0.30;

  // plate background
  page.drawRectangle({
    x: plateX, y: plateY, width: plateW, height: plateH,
    color: rgb(1, 1, 1), opacity: 0.85,
    borderColor: c(P.primary), borderWidth: 2,
  });
  // decorative corners inside plate
  const cornerLen = 14;
  const drawCornerAccent = (cx: number, cy: number, dx: number, dy: number) => {
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + dx * cornerLen, y: cy }, thickness: 1.6, color: c(P.accent) });
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + dy * cornerLen }, thickness: 1.6, color: c(P.accent) });
  };
  drawCornerAccent(plateX + 6, plateY + plateH - 6, 1, -1);
  drawCornerAccent(plateX + plateW - 6, plateY + plateH - 6, -1, -1);
  drawCornerAccent(plateX + 6, plateY + 6, 1, 1);
  drawCornerAccent(plateX + plateW - 6, plateY + 6, -1, 1);

  drawFitText(page, {
    text: "This book belongs to:",
    x: pageW / 2, y: plateY + plateH - 22,
    maxWidth: plateW - 30,
    font, size: style.bodyPt + 1, minSize: style.minPt,
    color: c(P.ink), align: "center",
  });
  // signature line
  const lineY = plateY + 26;
  page.drawLine({
    start: { x: plateX + 24, y: lineY },
    end:   { x: plateX + plateW - 24, y: lineY },
    thickness: 1.2, color: c(P.primary),
  });

  // Brand tagline
  if (opts.brand) {
    drawFitText(page, {
      text: opts.brand,
      x: pageW / 2, y: 52,
      maxWidth: pageW - 120,
      font, size: style.tinyPt, minSize: 7,
      color: c(P.ink), align: "center",
    });
  }
}

/** Copyright page: small legal text at bottom, decorative top fill. */
export function drawColoringCopyrightPage(
  ctx: MatterContext,
  opts: { legalText: string },
) {
  const { page, pageW, pageH, style, font, fontBold, vignettes, logo } = ctx;
  const P = style.palette;

  drawDecorativeBorder(page, { pageW, pageH, palette: P, inset: 28 });

  // Top decoration: large greyed vignette fills the upper 45% at low opacity.
  if (vignettes && vignettes.length > 0) {
    const img = vignettes[0];
    const zone = { x: 60, y: pageH * 0.48, w: pageW - 120, h: pageH * 0.40 };
    const iw = img.width, ih = img.height;
    const scale = Math.min(zone.w / iw, zone.h / ih);
    const w = iw * scale, h = ih * scale;
    page.drawImage(img, {
      x: zone.x + (zone.w - w) / 2,
      y: zone.y + (zone.h - h) / 2,
      width: w, height: h,
      opacity: 0.10,
    });
  } else {
    // Fallback: palette-tinted dot pattern in the top half.
    const rows = 6, cols = 12;
    const topY = pageH * 0.55, spanH = pageH * 0.32;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        page.drawCircle({
          x: 70 + (col + (r % 2) * 0.5) * ((pageW - 140) / (cols - 1)),
          y: topY + r * (spanH / (rows - 1)),
          size: 3.5,
          color: c(P.accent),
          opacity: 0.35,
        });
      }
    }
  }

  // Legal box at bottom half
  const boxX = 70, boxY = 70, boxW = pageW - 140, boxH = pageH * 0.36;
  page.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    color: rgb(1, 1, 1), opacity: 0.92,
    borderColor: c(P.primary), borderWidth: 0.8,
  });

  // SecretPDF brand logo centered at the top of the legal panel
  let textTopPad = 22;
  if (logo) {
    const maxLogoW = boxW * 0.52;
    const maxLogoH = 54;
    const scale = Math.min(maxLogoW / logo.width, maxLogoH / logo.height);
    const lw = logo.width * scale, lh = logo.height * scale;
    const lx = boxX + (boxW - lw) / 2;
    const ly = boxY + boxH - lh - 12;
    page.drawImage(logo, { x: lx, y: ly, width: lw, height: lh });
    textTopPad = lh + 22;
  }

  drawFitParagraph(page, {
    text: opts.legalText,
    x: boxX + 18, y: boxY + boxH - textTopPad,
    maxWidth: boxW - 36,
    maxHeight: boxH - textTopPad - 12,
    font, size: style.tinyPt, minSize: 7,
    color: c(P.ink),
    lineHeightFactor: 1.45,
  });
}


/** "How to Use" page: numbered list with tiny icons + "test corner" swatch box. */
export function drawColoringHowToPage(
  ctx: MatterContext,
  opts: { totalPages: number },
) {
  const { page, pageW, pageH, style, font, fontBold, vignettes } = ctx;
  const P = style.palette;

  drawDecorativeBorder(page, { pageW, pageH, palette: P, inset: 28 });
  drawCornerVignettes(page, { pageW, pageH, style, vignettes: vignettes ?? [], opacity: 0.10 });

  // Heading
  drawFitText(page, {
    text: "How to Use This Book",
    x: pageW / 2, y: pageH - 88,
    maxWidth: pageW - 140,
    font: fontBold, size: style.headingPt,
    minSize: style.minPt + 2,
    color: c(P.primary), align: "center",
  });

  const tips = [
    "Pick your favorite crayons, markers, or colored pencils.",
    "Start with the outlines, then fill each shape with color.",
    "There's no right way — try wild colors!",
    "Take a break between pages. Rest your hand.",
    "Show a grown-up your finished masterpiece.",
    `Complete all ${opts.totalPages} pages to earn your certificate!`,
  ];

  // Numbered list with tiny star bullet
  const listX = 88;
  const listW = pageW - 176;
  const listTopY = pageH - 140;
  const rowH = Math.max(28, style.bodyPt * 2.0);
  for (let i = 0; i < tips.length; i++) {
    const y = listTopY - (i + 1) * rowH;
    // number badge
    page.drawCircle({ x: listX, y: y + style.bodyPt / 2 - 1, size: 10, color: c(P.primary) });
    drawFitText(page, {
      text: String(i + 1),
      x: listX, y: y + style.bodyPt / 2 - 4,
      maxWidth: 20, font: fontBold, size: 10, minSize: 8,
      color: rgb(1, 1, 1), align: "center",
    });
    // tip text
    drawFitText(page, {
      text: tips[i],
      x: listX + 22, y: y,
      maxWidth: listW - 32,
      font, size: style.bodyPt, minSize: style.minPt,
      color: c(P.ink), align: "left",
    });
  }

  // "Try your colors here!" swatch box
  const boxW = pageW - 176, boxH = 82;
  const boxX = 88, boxY = 92;
  page.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    color: rgb(1, 1, 1), opacity: 0.9,
    borderColor: c(P.primary), borderWidth: 1.4,
  });
  drawFitText(page, {
    text: "Try your colors here!",
    x: boxX + 12, y: boxY + boxH - 20,
    maxWidth: boxW - 24,
    font: fontBold, size: style.bodyPt, minSize: style.minPt,
    color: c(P.primary), align: "left",
  });
  // color swatches
  const swW = 26, swH = 26, swGap = 8, swY = boxY + 14;
  const swatches = P.swatch;
  const totalSwW = swatches.length * swW + (swatches.length - 1) * swGap;
  const swStartX = boxX + (boxW - totalSwW) / 2;
  for (let i = 0; i < swatches.length; i++) {
    page.drawRectangle({
      x: swStartX + i * (swW + swGap), y: swY,
      width: swW, height: swH,
      color: c(swatches[i]),
      borderColor: c(P.ink), borderWidth: 0.6,
    });
  }
}

/** Certificate page: same palette-border treatment as title. */
export function drawColoringCertificatePage(
  ctx: MatterContext,
  opts: { title: string; totalPages: number; ageBadge: string; miniTestFooter?: string },
) {
  const { page, pageW, pageH, style, font, fontBold, vignettes } = ctx;
  const P = style.palette;

  drawDecorativeBorder(page, { pageW, pageH, palette: P, inset: 28, heavy: true });
  drawCornerVignettes(page, { pageW, pageH, style, vignettes: vignettes ?? [], opacity: 0.10 });

  // Ribbon-style header
  const ribbonY = pageH * 0.78;
  drawFitText(page, {
    text: "Certificate of Coloring",
    x: pageW / 2, y: ribbonY,
    maxWidth: pageW - 140,
    font: fontBold, size: style.titlePt - 4,
    minSize: Math.max(16, style.titlePt - 14),
    color: c(P.primary), align: "center",
  });
  drawFitText(page, {
    text: "Awarded to",
    x: pageW / 2, y: ribbonY - 42,
    maxWidth: pageW - 200,
    font, size: style.bodyPt + 2, minSize: style.minPt,
    color: c(P.ink), align: "center",
  });

  // signature line for name
  const lineWidth = pageW * 0.58;
  const lineX = (pageW - lineWidth) / 2;
  const lineY = ribbonY - 78;
  page.drawLine({
    start: { x: lineX, y: lineY }, end: { x: lineX + lineWidth, y: lineY },
    thickness: 1.5, color: c(P.primary),
  });

  drawFitText(page, {
    text: `for completing "${opts.title}"`,
    x: pageW / 2, y: lineY - 28,
    maxWidth: pageW - 140,
    font, size: style.bodyPt + 1, minSize: style.minPt,
    color: c(P.ink), align: "center",
  });
  drawFitText(page, {
    text: `${opts.totalPages} coloring pages · ${opts.ageBadge}`,
    x: pageW / 2, y: lineY - 50,
    maxWidth: pageW - 160,
    font, size: style.tinyPt + 1, minSize: 8,
    color: c(P.ink), align: "center",
  });

  drawFitText(page, {
    text: "Great job, artist!",
    x: pageW / 2, y: pageH * 0.22,
    maxWidth: pageW - 160,
    font: fontBold, size: style.headingPt,
    minSize: style.minPt + 2,
    color: c(P.primary), align: "center",
  });

  // star burst under "great job"
  const starY = pageH * 0.15;
  for (let i = -2; i <= 2; i++) {
    page.drawCircle({
      x: pageW / 2 + i * 22, y: starY,
      size: 5 - Math.abs(i) * 0.6,
      color: c(P.accent), opacity: 0.9,
    });
  }

  if (opts.miniTestFooter) {
    drawFitText(page, {
      text: opts.miniTestFooter,
      x: pageW / 2, y: 60,
      maxWidth: pageW - 140,
      font, size: style.tinyPt - 1, minSize: 6,
      color: c(P.ink), align: "center",
    });
  }
}

// defaultCopyrightText + MATTER_PAGES_DESIGN_VERSION are re-exported from
// ./matter-pages-style at the top of this file.

