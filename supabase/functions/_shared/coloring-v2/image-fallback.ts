// V2 image provider order (OWNER LAW, 2026-07-20):
//   PRIMARY = Cloudflare Workers AI (@cf/black-forest-labs/flux-1-schnell) —
//   use free quota first.
//   FALLBACK = Runware (Ideogram / Flux) when Cloudflare is unconfigured,
//   quota-latched, or errors out.
//
// Contract: same shape as runwareInference — returns Uint8Array image bytes.
// Cost/provider logging happens inside each underlying adapter.
// @ts-nocheck
import { runwareInference, type RunwareOpts } from "../runware.ts";
import { cloudflareFluxSchnell, ProviderUnconfiguredError } from "../image-providers.ts";
import { FalBillingLockedError } from "../fal-billing.ts";

function isRecoverable(e: any): boolean {
  if (e instanceof FalBillingLockedError) return true;
  if (e instanceof ProviderUnconfiguredError) return true;
  const msg = String(e?.message ?? e ?? "");
  return /insufficient|balance|credit|billing|payment required|402|quota|unconfigured|not set/i.test(msg);
}

export async function renderImageWithFallback(opts: RunwareOpts): Promise<Uint8Array> {
  // Try Cloudflare first — cheap free quota.
  const w = Math.max(512, Math.min(1280, opts.width ?? 1024));
  const h = Math.max(512, Math.min(1280, opts.height ?? 1024));
  try {
    return await cloudflareFluxSchnell({
      prompt: opts.prompt,
      width: w,
      height: h,
      num_inference_steps: 4,
      ebook_id: opts.ebook_id,
      step: (opts.step ?? "coloring_v2_cf_primary"),
    } as any);
  } catch (e) {
    if (!isRecoverable(e)) throw e;
    console.warn(`[v2 image-fallback] cloudflare failed (${e?.message ?? e}); falling back to runware`);
    return await runwareInference(opts);
  }
}

