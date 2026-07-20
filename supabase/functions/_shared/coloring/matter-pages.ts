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

// ── palette + style resolution ──────────────────────────────────────────

export interface MatterPalette {
  paper: [number, number, number];   // background wash
  primary: [number, number, number]; // decorative border + accents
  ink: [number, number, number];     // body text
  accent: [number, number, number];  // secondary decor (dots, stars)
  swatch: Array<[number, number, number]>; // "try your colors" test box
}

export interface MatterStyle {
  band: "toddler" | "preschool" | "early_reader" | "middle_grade" | "teen";
  ageMin: number;
  ageMax: number;
  titlePt: number;
  headingPt: number;
  bodyPt: number;
  tinyPt: number;
  minPt: number;
  palette: MatterPalette;
  cornerVignetteFrac: number; // 0-1 of page width
  lineHeightFactor: number;
}

const PALETTES: Record<MatterStyle["band"], MatterPalette> = {
  toddler: {
    paper: [1.0, 0.973, 0.918],
    primary: [0.95, 0.55, 0.30],
    ink: [0.24, 0.14, 0.08],
    accent: [0.98, 0.78, 0.35],
    swatch: [[0.96, 0.45, 0.42], [0.98, 0.78, 0.35], [0.55, 0.80, 0.55], [0.42, 0.68, 0.90], [0.75, 0.55, 0.85]],
  },
  preschool: {
    paper: [1.0, 0.965, 0.895],
    primary: [0.93, 0.48, 0.22],
    ink: [0.22, 0.14, 0.08],
    accent: [0.35, 0.68, 0.72],
    swatch: [[0.94, 0.42, 0.45], [0.98, 0.75, 0.32], [0.42, 0.75, 0.55], [0.32, 0.62, 0.88], [0.72, 0.45, 0.82]],
  },
  early_reader: {
    paper: [0.996, 0.973, 0.910],
    primary: [0.60, 0.35, 0.15],
    ink: [0.18, 0.12, 0.06],
    accent: [0.30, 0.55, 0.72],
    swatch: [[0.88, 0.38, 0.42], [0.94, 0.68, 0.28], [0.38, 0.68, 0.48], [0.28, 0.58, 0.84], [0.62, 0.40, 0.75]],
  },
  middle_grade: {
    paper: [0.98, 0.97, 0.94],
    primary: [0.30, 0.35, 0.55],
    ink: [0.14, 0.14, 0.18],
    accent: [0.85, 0.55, 0.28],
    swatch: [[0.82, 0.32, 0.40], [0.90, 0.62, 0.24], [0.32, 0.62, 0.42], [0.22, 0.48, 0.78], [0.55, 0.32, 0.68]],
  },
  teen: {
    // Cool slate + neon accent — matches YA Sci-Fi vibe from Neon Rebellion.
    paper: [0.965, 0.970, 0.980],
    primary: [0.20, 0.24, 0.34],
    ink: [0.10, 0.12, 0.16],
    accent: [0.20, 0.72, 0.68], // teal
    swatch: [[0.22, 0.72, 0.68], [0.85, 0.32, 0.55], [0.95, 0.60, 0.20], [0.42, 0.42, 0.85], [0.20, 0.24, 0.34]],
  },
};

export function resolveMatterStyle(ageMin: number, ageMax: number): MatterStyle {
  const min = Math.max(0, Math.min(18, ageMin | 0));
  const max = Math.max(min, Math.min(18, ageMax | 0));
  const mid = (min + max) / 2;
  let band: MatterStyle["band"];
  if (mid <= 3.5) band = "toddler";
  else if (mid <= 6.5) band = "preschool";
  else if (mid <= 9.5) band = "early_reader";
  else if (mid <= 12.5) band = "middle_grade";
  else band = "teen";

  const sizes: Record<MatterStyle["band"], Pick<MatterStyle, "titlePt" | "headingPt" | "bodyPt" | "tinyPt" | "minPt" | "lineHeightFactor" | "cornerVignetteFrac">> = {
    toddler:      { titlePt: 44, headingPt: 26, bodyPt: 17, tinyPt: 12, minPt: 11, lineHeightFactor: 1.7, cornerVignetteFrac: 0.18 },
    preschool:    { titlePt: 40, headingPt: 24, bodyPt: 15, tinyPt: 11, minPt: 10, lineHeightFactor: 1.6, cornerVignetteFrac: 0.17 },
    early_reader: { titlePt: 36, headingPt: 22, bodyPt: 13, tinyPt: 10, minPt: 9,  lineHeightFactor: 1.55, cornerVignetteFrac: 0.16 },
    middle_grade: { titlePt: 32, headingPt: 20, bodyPt: 12, tinyPt: 9,  minPt: 8,  lineHeightFactor: 1.5,  cornerVignetteFrac: 0.15 },
    teen:         { titlePt: 30, headingPt: 18, bodyPt: 11, tinyPt: 9,  minPt: 8,  lineHeightFactor: 1.45, cornerVignetteFrac: 0.14 },
  };

  return { band, ageMin: min, ageMax: max, palette: PALETTES[band], ...sizes[band] };
}

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

// ── page renderers ──────────────────────────────────────────────────────

export interface MatterContext {
  page: any;
  pageW: number;
  pageH: number;
  style: MatterStyle;
  font: any;      // regular
  fontBold: any;
  vignettes?: any[]; // optional embedded pdf-lib images from interior pages
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
  const { page, pageW, pageH, style, font, vignettes } = ctx;
  const P = style.palette;

  drawDecorativeBorder(page, { pageW, pageH, palette: P, inset: 28 });

  // Top decoration: large greyed vignette fills the upper 55% at low opacity.
  if (vignettes && vignettes.length > 0) {
    const img = vignettes[0];
    const zone = { x: 60, y: pageH * 0.42, w: pageW - 120, h: pageH * 0.48 };
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

  // Legal text at bottom quarter, small.
  const boxX = 70, boxY = 70, boxW = pageW - 140, boxH = pageH * 0.28;
  page.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    color: rgb(1, 1, 1), opacity: 0.9,
    borderColor: c(P.primary), borderWidth: 0.8,
  });
  drawFitParagraph(page, {
    text: opts.legalText,
    x: boxX + 18, y: boxY + boxH - 22,
    maxWidth: boxW - 36,
    maxHeight: boxH - 30,
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

// ── copy defaults ───────────────────────────────────────────────────────

export function defaultCopyrightText(): string {
  const year = new Date().getFullYear();
  return [
    `© ${year} secretpdf.co. All rights reserved.`,
    "",
    "This coloring book is licensed for personal, non-commercial use.",
    "Individual coloring pages may be copied for personal or classroom use.",
    "Not for resale, redistribution, or commercial reproduction.",
    "",
    "Visit secretpdf.co for more coloring books and kids' printables.",
  ].join("\n");
}

// Version marker recorded in pipeline_skills as `matter_pages_design_v2`.
export const MATTER_PAGES_DESIGN_VERSION = "matter_pages_design_v2";
