// V2 image fallback: try Runware first, fall back to Cloudflare Workers AI
// (@cf/black-forest-labs/flux-1-schnell) on billing-locked / insufficient-credit
// errors. Wired for both interior pages and covers so a Runware balance dip
// does not halt the coloring lane.
//
// Contract: same shape as runwareInference — returns Uint8Array image bytes.
// Cost/provider logging happens inside each underlying adapter.
// @ts-nocheck
import { runwareInference, type RunwareOpts } from "../runware.ts";
import { cloudflareFluxSchnell } from "../image-providers.ts";
import { FalBillingLockedError } from "../fal-billing.ts";

function isRecoverable(e: any): boolean {
  if (e instanceof FalBillingLockedError) return true;
  const msg = String(e?.message ?? e ?? "");
  return /insufficient|balance|credit|billing|payment required|402/i.test(msg);
}

export async function renderImageWithFallback(opts: RunwareOpts): Promise<Uint8Array> {
  try {
    return await runwareInference(opts);
  } catch (e) {
    if (!isRecoverable(e)) throw e;
    console.warn(`[v2 image-fallback] runware failed (${e?.message ?? e}); trying cloudflare flux-1-schnell`);
    // Cloudflare flux-1-schnell — supports 512..1280 dimensions and ~4 steps.
    const w = Math.max(512, Math.min(1280, opts.width ?? 1024));
    const h = Math.max(512, Math.min(1280, opts.height ?? 1024));
    return await cloudflareFluxSchnell({
      prompt: opts.prompt,
      width: w,
      height: h,
      num_inference_steps: 4,
      ebook_id: opts.ebook_id,
      step: (opts.step ?? "coloring_v2_fallback_cf") + "_cf_fallback",
    } as any);
  }
}
