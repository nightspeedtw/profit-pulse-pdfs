// PDF-side branding helpers. Consumes pure policy from
// `src/lib/kidsBranding.ts` and adds:
//   - a corner-region luminance sampler
//   - a pdf-lib drawer that stamps the logo + © line onto a page
//   - a small cache so the logo bytes + PDFImage are loaded once per doc.
//
// Called by kids-picture-pdf.ts on every interior page (excluding cover).

import type { PDFDocument, PDFFont, PDFImage } from "npm:pdf-lib@1.17.1";
import { StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';
import {
  KIDS_BRAND_ASSETS,
  KIDS_BRAND_LAYOUT,
  computeLogoRect,
  decideBrandingForCorner,
  pageKindAllowsBranding,
  type BrandingDecision,
  type CornerStats,
  type KidsPageKind,
} from "../../../src/lib/kidsBranding.ts";

export {
  KIDS_BRAND_ASSETS,
  KIDS_BRAND_LAYOUT,
  decideBrandingForCorner,
  pageKindAllowsBranding,
} from "../../../src/lib/kidsBranding.ts";
export type { KidsPageKind, BrandingDecision } from "../../../src/lib/kidsBranding.ts";

/** Bytes for the trimmed footer logo — fetched once per process. */
let cachedLogoBytes: Uint8Array | null = null;
export async function loadKidsFooterLogoBytes(baseUrl?: string): Promise<Uint8Array> {
  if (cachedLogoBytes) return cachedLogoBytes;
  const abs = baseUrl
    ? new URL(KIDS_BRAND_ASSETS.footer, baseUrl).toString()
    : `https://profit-pulse-pdfs.lovable.app${KIDS_BRAND_ASSETS.footer}`;
  const r = await fetch(abs);
  if (!r.ok) throw new Error(`kids_brand_logo_fetch_${r.status}`);
  cachedLogoBytes = new Uint8Array(await r.arrayBuffer());
  return cachedLogoBytes;
}

/** Per-doc cache so a single PDFDocument embeds the logo image exactly once. */
const embedCache = new WeakMap<PDFDocument, Promise<PDFImage>>();
export function embedKidsFooterLogo(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const hit = embedCache.get(doc);
  if (hit) return hit;
  const p = doc.embedPng(bytes);
  embedCache.set(doc, p);
  return p;
}

/**
 * Sample the bottom-right corner of an illustration and return the stats
 * the branding heuristic needs. Corner is the bottom-right 25% × 25% region.
 */
export async function sampleCornerStats(imgBytes: Uint8Array): Promise<CornerStats> {
  const img = await Image.decode(imgBytes);
  const w = img.width, h = img.height;
  const x0 = Math.floor(w * 0.75);
  const y0 = Math.floor(h * 0.75);
  const step = Math.max(1, Math.floor(Math.min(w - x0, h - y0) / 32));
  const samples: number[] = [];
  for (let y = y0; y < h; y += step) {
    for (let x = x0; x < w; x += step) {
      const px = img.getPixelAt(x + 1, y + 1);
      const r = (px >>> 24) & 0xff;
      const g = (px >>> 16) & 0xff;
      const b = (px >>> 8) & 0xff;
      samples.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  const n = samples.length || 1;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return { mean, variance };
}

export interface BrandingReport extends BrandingDecision {
  page_kind: KidsPageKind;
  page_index: number;
  logo_rect?: { x: number; y: number; w: number; h: number };
  corner?: CornerStats;
}

/**
 * Draw branding on a single page. Cover pages are always skipped. For
 * non-story pages (title/copyright/bonus/the_end) which have a solid
 * background the logo/copyright always render. For story pages the
 * corner-luminance heuristic can suppress the logo — the © line is
 * only suppressed on catastrophic contrast.
 */
export async function drawKidsBrandingOnPage(opts: {
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  pageKind: KidsPageKind;
  pageIndex: number;
  pageW: number;
  pageH: number;
  logoImage: PDFImage;
  /** Only required for story pages — used for the luminance heuristic. */
  underlyingImageBytes?: Uint8Array | null;
}): Promise<BrandingReport> {
  const {
    doc: _doc, page, pageKind, pageIndex, pageW, pageH, logoImage, underlyingImageBytes,
  } = opts;
  if (!pageKindAllowsBranding(pageKind)) {
    return { page_kind: pageKind, page_index: pageIndex, logo: false, copyright: false, reason: "cover_excluded" };
  }

  // Non-story pages have controlled backgrounds — always brand.
  let decision: BrandingDecision = { logo: true, copyright: true, reason: null };
  let corner: CornerStats | undefined;
  if (pageKind === "story" && underlyingImageBytes) {
    corner = await sampleCornerStats(underlyingImageBytes);
    decision = decideBrandingForCorner(corner);
  }

  const rect = computeLogoRect(pageW, pageH);

  if (decision.logo) {
    page.drawImage(logoImage, { x: rect.x, y: rect.y, width: rect.w, height: rect.h, opacity: 1 });
  }
  if (decision.copyright) {
    const font: PDFFont = await _doc.embedFont(StandardFonts.Helvetica);
    const size = KIDS_BRAND_LAYOUT.copyright_pt;
    const text = KIDS_BRAND_LAYOUT.copyright_text;
    const tw = font.widthOfTextAtSize(text, size);
    // Small translucent panel behind the © so it stays legible on any art.
    page.drawRectangle({
      x: KIDS_BRAND_LAYOUT.safe_margin_pt - 4,
      y: KIDS_BRAND_LAYOUT.safe_margin_pt - 3,
      width: tw + 8,
      height: size + 5,
      color: rgb(1, 0.98, 0.94),
      opacity: 0.55,
    });
    page.drawText(text, {
      x: KIDS_BRAND_LAYOUT.safe_margin_pt,
      y: KIDS_BRAND_LAYOUT.safe_margin_pt,
      size,
      font,
      color: rgb(0.22, 0.15, 0.10),
    });
  }

  return {
    page_kind: pageKind,
    page_index: pageIndex,
    logo: decision.logo,
    copyright: decision.copyright,
    reason: decision.reason,
    logo_rect: decision.logo ? rect : undefined,
    corner,
  };
}
