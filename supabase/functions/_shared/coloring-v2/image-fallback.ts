// V2 image provider order (OWNER LAW, 2026-07-24):
//   PRIMARY = Cloudflare Workers AI (@cf/black-forest-labs/flux-1-schnell).
//   Runware fallback REMOVED — owner directive: interiors are Cloudflare-only.
//   If Cloudflare fails, throw and let the caller park the book / retry later.
//
// Contract: same shape as runwareInference — returns Uint8Array image bytes.
// @ts-nocheck
import type { RunwareOpts } from "../runware.ts";
import { cloudflareFluxSchnell } from "../image-providers.ts";

export async function renderImageWithFallback(opts: RunwareOpts): Promise<Uint8Array> {
  const w = Math.max(512, Math.min(1280, opts.width ?? 1024));
  const h = Math.max(512, Math.min(1280, opts.height ?? 1024));
  return await cloudflareFluxSchnell({
    prompt: opts.prompt,
    width: w,
    height: h,
    num_inference_steps: 4,
    ebook_id: opts.ebook_id,
    step: (opts.step ?? "coloring_v2_cf_only"),
  } as any);
}


