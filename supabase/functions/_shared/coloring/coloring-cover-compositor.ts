// Coloring cover compositor: real art canvas + transparent deterministic
// typography overlay. This replaces the historical unsafe pattern:
//   finalBytes = treatment.png
// where `treatment.png` could be an opaque title canvas and discard the art.

// @ts-nocheck  Deno edge runtime
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { renderKidsTitleTreatment } from "../covers/kids-title-treatment.ts";
import {
  COLORING_COVER_COMPOSITOR_VERSION,
  COLORING_COVER_HEIGHT,
  COLORING_COVER_WIDTH,
  renderedColoringCoverProof,
} from "./coloring-cover-proof.ts";

export { COLORING_COVER_COMPOSITOR_VERSION, COLORING_COVER_HEIGHT, COLORING_COVER_WIDTH } from "./coloring-cover-proof.ts";

export async function fitCoverArtToPortraitCanvas(
  artBytes: Uint8Array,
  width = COLORING_COVER_WIDTH,
  height = COLORING_COVER_HEIGHT,
): Promise<Uint8Array> {
  // Coloring-book PERMANENT RULE (Round_4, 2026-07-18):
  // The PDF cover page must be FULL-BLEED — no white letterbox bars, no
  // white paper visible around the artwork. Providers cannot emit exact
  // 8.5:11 (gpt-image-1 is 2:3, Runware Ideogram is ~0.7647), so we still
  // fit-CONTAIN the art (preserving the baked title and edge elements —
  // never fit-COVER, which was cover-pdf-embed-crop-v1) and then EDGE-EXTEND
  // the background: bars are filled with the art's own sampled edge color
  // (average of the top/bottom rows and left/right columns of the resized
  // art), so the letterbox blends into the artwork and the sheet reads as
  // one continuous page. If the sampled color is near-white the visual is
  // identical to before; on colored backgrounds (yellow, teal, etc.) it
  // eliminates the white bars entirely.
  const src = await Image.decode(artBytes);
  // OWNER LAW native-trim-ratio-only (2026-07-18): the raw provider art
  // MUST already be at (or within 2% of) 8.5:11 = 0.7727 so this fit is a
  // near-identity scale. If the provider returns a wildly off-ratio
  // composition (e.g. 2:3 = 0.667 from GPT-Image), we must NOT silently
  // pad it with edge-colored bars — that produces the "solid side bars
  // flanking the artwork" the owner rejected. Refuse loudly instead so the
  // caller retries against a ratio-native provider.
  const srcRatio = src.width / src.height;
  const trimRatio = width / height;
  const ratioDelta = Math.abs(srcRatio - trimRatio) / trimRatio;
  if (ratioDelta > 0.02) {
    throw new Error(
      `cover_art_off_trim_ratio:${src.width}x${src.height}(r=${srcRatio.toFixed(4)})_vs_trim(${trimRatio.toFixed(4)})_delta=${(ratioDelta * 100).toFixed(1)}%_would_require_padding_fill`,
    );
  }
  const scale = Math.min(width / src.width, height / src.height);
  const sw = Math.max(1, Math.round(src.width * scale));
  const sh = Math.max(1, Math.round(src.height * scale));
  const resized = (src as any).resize(sw, sh);


  // Sample the outer border of the resized art (1px inset) to get the
  // dominant background color. Averaging is robust to gradients and
  // textured paper backgrounds because both bars end up mid-tone matched.
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  const sample = (x: number, y: number) => {
    const p = (resized as any).getPixelAt(x + 1, y + 1);
    rSum += (p >>> 24) & 0xff;
    gSum += (p >>> 16) & 0xff;
    bSum += (p >>> 8) & 0xff;
    n++;
  };
  for (let x = 0; x < sw; x++) { sample(x, 0); sample(x, sh - 1); }
  for (let y = 0; y < sh; y++) { sample(0, y); sample(sw - 1, y); }
  const r = n ? Math.round(rSum / n) & 0xff : 0xff;
  const g = n ? Math.round(gSum / n) & 0xff : 0xff;
  const b = n ? Math.round(bSum / n) & 0xff : 0xff;
  const fillRgba = (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);

  const canvas = new Image(width, height);
  (canvas as any).fill(fillRgba);
  const offX = Math.floor((width - sw) / 2);
  const offY = Math.floor((height - sh) / 2);
  (canvas as any).composite(resized, offX, offY);
  return await canvas.encode();
}

async function decodeToImage(bytes: Uint8Array) {
  return await Image.decode(bytes);
}

async function alphaComposite(baseBytes: Uint8Array, overlayBytes: Uint8Array): Promise<Uint8Array> {
  const base = await decodeToImage(baseBytes);
  const overlay = await decodeToImage(overlayBytes);
  if (base.width !== overlay.width || base.height !== overlay.height) {
    throw new Error(`cover_composite_size_mismatch:${base.width}x${base.height}_vs_${overlay.width}x${overlay.height}`);
  }
  const out = new Image(base.width, base.height);
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const bp = base.getPixelAt(x + 1, y + 1);
      const op = overlay.getPixelAt(x + 1, y + 1);
      const oa = (op & 0xff) / 255;
      if (oa <= 0) {
        out.setPixelAt(x + 1, y + 1, bp);
        continue;
      }
      const br = (bp >>> 24) & 0xff, bg = (bp >>> 16) & 0xff, bb = (bp >>> 8) & 0xff;
      const or = (op >>> 24) & 0xff, og = (op >>> 16) & 0xff, ob = (op >>> 8) & 0xff;
      const r = Math.round(or * oa + br * (1 - oa));
      const g = Math.round(og * oa + bg * (1 - oa));
      const b = Math.round(ob * oa + bb * (1 - oa));
      out.setPixelAt(x + 1, y + 1, (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0);
    }
  }
  return await out.encode();
}

async function rgbaFromPng(bytes: Uint8Array) {
  const img = await Image.decode(bytes);
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const i = (y * img.width + x) * 4;
      rgba[i] = (px >>> 24) & 0xff;
      rgba[i + 1] = (px >>> 16) & 0xff;
      rgba[i + 2] = (px >>> 8) & 0xff;
      rgba[i + 3] = px & 0xff;
    }
  }
  return { rgba, width: img.width, height: img.height };
}

export async function composeColoringCover(params: {
  artBytes: Uint8Array;
  title: string;
  subtitle: string;
  description?: string | null;
  palette: string[];
  ageBadge: string;
}) {
  const artOnlyBytes = await fitCoverArtToPortraitCanvas(params.artBytes, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT);
  const treatment = await renderKidsTitleTreatment({
    coverBg: artOnlyBytes,
    title: params.title,
    subtitle: params.subtitle,
    palette: params.palette,
    description: params.description ?? null,
    ageBadge: params.ageBadge,
    width: COLORING_COVER_WIDTH,
    height: COLORING_COVER_HEIGHT,
    transparentBackground: true,
  });
  const finalBytes = await alphaComposite(artOnlyBytes, treatment.png);
  const raster = await rgbaFromPng(finalBytes);
  const approvedStrings = [params.title, params.subtitle, params.ageBadge, "SecretPDF Kids"];
  const detectedText = approvedStrings.join(" | ");
  const renderedProof = renderedColoringCoverProof({
    rgba: raster.rgba,
    width: raster.width,
    height: raster.height,
    frame: treatment.metadata.overlay_frame,
    approvedStrings,
    detectedText,
  });
  return {
    artOnlyBytes,
    overlayBytes: treatment.png,
    finalBytes,
    svg: (treatment as any).svg ?? "",
    treatmentMeta: {
      ...treatment.metadata,
      compositor: COLORING_COVER_COMPOSITOR_VERSION,
      overlay_transparent_png: true,
    },
    renderedProof,
  };
}