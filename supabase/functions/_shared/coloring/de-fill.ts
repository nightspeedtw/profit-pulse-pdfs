// De-fill post-processor for coloring-book interior pages.
//
// OWNER LAW solid_black_defill_v1 (2026-07-19). Supersedes reroll-based
// solid-black repair. Rationale from owner Q&A:
//   > 255 rejections prove reroll doesn't converge.
//   > Stop re-rolling the dice; convert the #1 defect class from
//   > reject-retry (paid) to deterministic auto-repair (free, ms).
//
// Contract, per page, AFTER render, BEFORE the solid-black gate:
//   1. Decode raster.
//   2. Find every black cluster using 4-connected flood-fill.
//   3. For clusters whose area exceeds `max_cluster_ratio`, keep a
//      RING_PX-wide boundary (the outline) and set the interior to pure
//      white. The filled patch becomes a colorable region — better for a
//      coloring book.
//   4. Also clear medium-gray blobs (ground shadows) exceeding
//      `shadow_cluster_ratio` — those are always contamination on a
//      line-art page.
//   5. Re-run the solid-black gate on the processed image; it should now
//      pass. Persist both raw + processed hashes and the full report.
//
// Only reject-and-retry when de-fill cannot save the page — e.g. the
// processed image STILL exceeds the black_pixel_ratio floor (that means
// the whole page is majority-black garbage that the outline ring alone
// cannot rescue).
//
// Pure Deno; no native deps. Uses imagescript for decode/encode.

// @ts-nocheck  Deno runtime
import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { analyzeSolidBlack, DEFAULT_SOLID_BLACK_TH, type SolidBlackReport, type SolidBlackThresholds } from "./solid-black.ts";

export const DE_FILL_VERSION = "solid_black_defill_v1";

export interface DeFillThresholds {
  black_threshold: number;         // luminance <= → black
  white_threshold: number;         // luminance >= → white
  shadow_low: number;              // luminance in (black_threshold, shadow_low] treated as shadow
  ring_px: number;                 // width of the outline ring to preserve, in RAW pixels
  max_cluster_ratio: number;       // must match the gate — clusters above this get de-filled
  shadow_cluster_ratio: number;    // any medium-gray blob above this gets whitened entirely
  hard_giveup_black_ratio: number; // total black > this AFTER de-fill → garbage page
}

export const DEFAULT_DE_FILL_TH: DeFillThresholds = {
  black_threshold: 60,
  white_threshold: 235,
  shadow_low: 150,
  ring_px: 3,
  max_cluster_ratio: 0.04,          // mirrors DEFAULT_SOLID_BLACK_TH.max_cluster_ratio
  shadow_cluster_ratio: 0.015,      // shadows are usually smaller than filled bodies
  hard_giveup_black_ratio: 0.55,    // page is majority black even AFTER de-fill → reject
};

export interface DeFillReport {
  version: string;
  applied: boolean;
  saved_by_defill: boolean;         // gate failed before AND passed after
  ring_px: number;
  raw_hash?: string;
  processed_hash?: string;
  black_ratio_before: number;
  black_ratio_after: number;
  largest_cluster_before: number;
  largest_cluster_after: number;
  clusters_defilled: number;
  shadows_cleared: number;
  pixels_whitened: number;
  gate_before: { pass: boolean; reasons: string[] };
  gate_after: { pass: boolean; reasons: string[] };
  hard_giveup: boolean;             // true → do NOT trust processed image; reject page
  reason?: string;
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pure pixel-mask logic (BFS erosion + flood-fill cluster tagging) is
// factored into ./de-fill-mask.ts so Vitest under Node can import it
// without pulling in Deno-only https:// imports.
import { computeDeFillKeepMask, tagOversizedClusters } from "./de-fill-mask.ts";
export { computeDeFillKeepMask };

async function analyzeAndWhiten(
  img: any,
  th: DeFillThresholds,
): Promise<{ processed: any; report: Omit<DeFillReport, "version" | "raw_hash" | "processed_hash" | "gate_before" | "gate_after" | "saved_by_defill" | "hard_giveup" | "reason" | "applied"> }> {
  const w = img.width;
  const h = img.height;
  const total = w * h;
  const blackMask = new Uint8Array(total);
  const shadowMask = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const r = (px >> 24) & 0xff;
      const g = (px >> 16) & 0xff;
      const b = (px >> 8) & 0xff;
      const l = luminance(r, g, b);
      const idx = y * w + x;
      if (l <= th.black_threshold) blackMask[idx] = 1;
      else if (l <= th.shadow_low) shadowMask[idx] = 1;
    }
  }
  const black = tagOversizedClusters(w, h, blackMask, Math.max(1, Math.floor(th.max_cluster_ratio * total)));
  const shadow = tagOversizedClusters(w, h, shadowMask, Math.max(1, Math.floor(th.shadow_cluster_ratio * total)));

  // Keep only the ring of the oversized black clusters; whiten interiors.
  const keepBlack = computeDeFillKeepMask(w, h, blackMask, black.tag, th.ring_px);
  // For shadow blobs: whiten ENTIRELY (no ring — ground shadows are pure
  // contamination on a coloring page; there's no meaningful outline to keep).
  const zeroKeepShadow = new Uint8Array(total); // all-zero → whiten all in-cluster
  const keepShadow = computeDeFillKeepMask(w, h, shadowMask, shadow.tag, 0);

  let whitened = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const inBlackFill = black.tag[idx] && !keepBlack[idx];
      const inShadowBlob = shadow.tag[idx] && !keepShadow[idx];
      if (inBlackFill || inShadowBlob) {
        // Preserve original alpha, force RGB=white.
        const px = img.getPixelAt(x + 1, y + 1);
        const a = px & 0xff;
        const white = ((0xff << 24) | (0xff << 16) | (0xff << 8) | a) >>> 0;
        img.setPixelAt(x + 1, y + 1, white);
        whitened++;
      }
    }
  }

  return {
    processed: img,
    report: {
      ring_px: th.ring_px,
      black_ratio_before: 0, // filled by caller
      black_ratio_after: 0,
      largest_cluster_before: black.largest / total,
      largest_cluster_after: 0,
      clusters_defilled: black.count,
      shadows_cleared: shadow.count,
      pixels_whitened: whitened,
    },
  };
}

/**
 * Run the de-fill pipeline against a rendered coloring-book interior page.
 * Never throws for a bad page — returns a report with `hard_giveup=true`
 * so the caller can reject-and-retry only when de-fill cannot save it.
 */
export async function deFillOversizedBlack(
  rawBytes: Uint8Array,
  gateTh: SolidBlackThresholds = DEFAULT_SOLID_BLACK_TH,
  defillTh: DeFillThresholds = DEFAULT_DE_FILL_TH,
): Promise<{ bytes: Uint8Array; report: DeFillReport }> {
  const gateBefore = await analyzeSolidBlack(rawBytes, gateTh);
  const rawHash = await sha256Hex(rawBytes);

  // Fast-path: the raw image already passes the gate — nothing to do.
  if (gateBefore.pass) {
    return {
      bytes: rawBytes,
      report: {
        version: DE_FILL_VERSION,
        applied: false,
        saved_by_defill: false,
        ring_px: defillTh.ring_px,
        raw_hash: rawHash,
        processed_hash: rawHash,
        black_ratio_before: gateBefore.black_pixel_ratio,
        black_ratio_after: gateBefore.black_pixel_ratio,
        largest_cluster_before: gateBefore.largest_black_cluster_ratio,
        largest_cluster_after: gateBefore.largest_black_cluster_ratio,
        clusters_defilled: 0,
        shadows_cleared: 0,
        pixels_whitened: 0,
        gate_before: { pass: true, reasons: [] },
        gate_after: { pass: true, reasons: [] },
        hard_giveup: false,
      },
    };
  }

  // Decode → whiten → re-encode.
  let img: any;
  try {
    img = await decode(rawBytes);
  } catch (e) {
    return {
      bytes: rawBytes,
      report: {
        version: DE_FILL_VERSION,
        applied: false,
        saved_by_defill: false,
        ring_px: defillTh.ring_px,
        raw_hash: rawHash,
        processed_hash: rawHash,
        black_ratio_before: gateBefore.black_pixel_ratio,
        black_ratio_after: gateBefore.black_pixel_ratio,
        largest_cluster_before: gateBefore.largest_black_cluster_ratio,
        largest_cluster_after: gateBefore.largest_black_cluster_ratio,
        clusters_defilled: 0,
        shadows_cleared: 0,
        pixels_whitened: 0,
        gate_before: { pass: false, reasons: gateBefore.reasons },
        gate_after: { pass: false, reasons: [`decode_failed:${(e as Error).message.slice(0, 80)}`] },
        hard_giveup: true,
        reason: "decode_failed",
      },
    };
  }

  const { processed, report: partial } = await analyzeAndWhiten(img, defillTh);
  let outBytes: Uint8Array;
  try {
    outBytes = await processed.encode(); // PNG
  } catch (e) {
    return {
      bytes: rawBytes,
      report: {
        version: DE_FILL_VERSION,
        applied: false,
        saved_by_defill: false,
        ring_px: defillTh.ring_px,
        raw_hash: rawHash,
        processed_hash: rawHash,
        black_ratio_before: gateBefore.black_pixel_ratio,
        black_ratio_after: gateBefore.black_pixel_ratio,
        largest_cluster_before: gateBefore.largest_black_cluster_ratio,
        largest_cluster_after: gateBefore.largest_black_cluster_ratio,
        clusters_defilled: 0,
        shadows_cleared: 0,
        pixels_whitened: 0,
        gate_before: { pass: false, reasons: gateBefore.reasons },
        gate_after: { pass: false, reasons: [`encode_failed:${(e as Error).message.slice(0, 80)}`] },
        hard_giveup: true,
        reason: "encode_failed",
      },
    };
  }

  const gateAfter = await analyzeSolidBlack(outBytes, gateTh);
  const processedHash = await sha256Hex(outBytes);

  // Hard-giveup: page is majority-black garbage even after de-fill.
  const hardGiveup = gateAfter.black_pixel_ratio > defillTh.hard_giveup_black_ratio;

  return {
    bytes: gateAfter.pass && !hardGiveup ? outBytes : rawBytes,
    report: {
      version: DE_FILL_VERSION,
      applied: true,
      saved_by_defill: gateAfter.pass && !gateBefore.pass && !hardGiveup,
      ring_px: defillTh.ring_px,
      raw_hash: rawHash,
      processed_hash: processedHash,
      black_ratio_before: gateBefore.black_pixel_ratio,
      black_ratio_after: gateAfter.black_pixel_ratio,
      largest_cluster_before: partial.largest_cluster_before || gateBefore.largest_black_cluster_ratio,
      largest_cluster_after: gateAfter.largest_black_cluster_ratio,
      clusters_defilled: partial.clusters_defilled,
      shadows_cleared: partial.shadows_cleared,
      pixels_whitened: partial.pixels_whitened,
      gate_before: { pass: gateBefore.pass, reasons: gateBefore.reasons },
      gate_after: { pass: gateAfter.pass, reasons: gateAfter.reasons },
      hard_giveup: hardGiveup,
      reason: hardGiveup ? "majority_black_after_defill" : undefined,
    },
  };
}
