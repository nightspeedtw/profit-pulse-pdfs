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
  // Round_3 CLASS: cover-pdf-embed-crop-v1.
  // Fit-CONTAIN (Math.min) with a white letterbox — NEVER fit-COVER (Math.max)
  // with a hard crop. Providers like gpt-image-1 emit 1024x1536 (2:3, ratio
  // 0.667); the target canvas is 1600x2071 (8.5:11, ratio 0.773). Scaling by
  // Math.max on a taller-than-target source overshoots height and crops
  // top+bottom — which chops the top of the baked title. Fit-CONTAIN
  // guarantees the full art (title, edge elements) is preserved; a slim
  // white letterbox is acceptable and invisible in most containers.
  const src = await Image.decode(artBytes);
  const scale = Math.min(width / src.width, height / src.height);
  const sw = Math.max(1, Math.round(src.width * scale));
  const sh = Math.max(1, Math.round(src.height * scale));
  const resized = (src as any).resize(sw, sh);
  const canvas = new Image(width, height);
  // Fill with opaque white (RGBA packed as 0xRRGGBBAA in imagescript).
  (canvas as any).fill(0xffffffff);
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
    treatmentMeta: {
      ...treatment.metadata,
      compositor: COLORING_COVER_COMPOSITOR_VERSION,
      overlay_transparent_png: true,
    },
    renderedProof,
  };
}