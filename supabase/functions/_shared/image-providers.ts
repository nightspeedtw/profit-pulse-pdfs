// Multi-provider image adapter (P0-parallel, non-blocking).
//
// Contract: generateImage({ prompt, image_size, num_inference_steps, ... }) → bytes.
// Providers:
//   - cloudflare_flux_schnell — Cloudflare Workers AI REST
//     (@cf/black-forest-labs/flux-1-schnell). Requires CF_ACCOUNT_ID + CF_API_TOKEN.
//     Missing secrets → provider_unconfigured (skip silently, caller falls back).
//   - fal_flux_schnell — existing fal.ts path (same model family so style
//     contract holds).
//
// Policy: interiors default to `cloudflare` primary, `fal` fallback on ANY
// error/quota/timeout. The active policy is data-driven — read from
// generation_settings.coloring_autopilot.image_provider_policy — so an A/B
// pilot can flip primary without a redeploy.
//
// Rate/scale safety: Cloudflare 429/402/"quota"/"locked" responses are
// classified as the SAME provider_billing_locked class as fal, so they never
// burn page repair attempts. Daily budget cap in the caller covers BOTH
// providers (Cloudflare Workers AI free-neurons tier logs cost_usd=0; fal
// logs $0.003/img — the sum is what the cap enforces).

import { falFluxSchnell } from "./fal.ts";
import { FalBillingLockedError, isFalBillingLocked } from "./fal-billing.ts";
import { logAiCost, costDb } from "./cost-log.ts";

export type ImageProviderId = "cloudflare_flux_schnell" | "fal_flux_schnell";

export type ImageProviderPolicy = {
  interiors: {
    primary: ImageProviderId;
    fallback: ImageProviderId | null;
  };
};

export const DEFAULT_IMAGE_PROVIDER_POLICY: ImageProviderPolicy = {
  interiors: { primary: "cloudflare_flux_schnell", fallback: "fal_flux_schnell" },
};

export interface GenerateImageOpts {
  prompt: string;
  image_size?: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  num_inference_steps?: number;
  ebook_id?: string;
  step?: string;
}

export interface GenerateImageResult {
  bytes: Uint8Array;
  provider: ImageProviderId;
  attempts: Array<{ provider: ImageProviderId; ok: boolean; error?: string }>;
}

export class ProviderUnconfiguredError extends Error {
  readonly kind = "provider_unconfigured" as const;
  constructor(readonly provider: ImageProviderId, msg: string) { super(msg); }
}

// -------- Cloudflare Workers AI (Flux-1 Schnell) --------

const CF_MAX_STEPS = 8;

function cfCreds(): { accountId: string; token: string } | null {
  const accountId = Deno.env.get("CF_ACCOUNT_ID");
  const token = Deno.env.get("CF_API_TOKEN");
  if (!accountId || !token) return null;
  return { accountId, token };
}

/**
 * Classify a Cloudflare error like we classify Fal: 402/429-quota/"locked"
 * are provider_billing_locked (never burn page attempts). We reuse
 * FalBillingLockedError as the shared class so the lane guard treats them
 * identically.
 */
function classifyCloudflareError(status: number, body: string): Error {
  if (isFalBillingLocked(status, body)) {
    return new FalBillingLockedError(status, `cloudflare: ${body.slice(0, 240)}`);
  }
  return new Error(`cloudflare @cf/flux-1-schnell ${status}: ${body.slice(0, 400)}`);
}

export async function cloudflareFluxSchnell(opts: GenerateImageOpts): Promise<Uint8Array> {
  const creds = cfCreds();
  if (!creds) throw new ProviderUnconfiguredError("cloudflare_flux_schnell", "CF_ACCOUNT_ID + CF_API_TOKEN not set");
  const steps = Math.min(CF_MAX_STEPS, Math.max(1, opts.num_inference_steps ?? 4));
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: opts.prompt, num_steps: steps }),
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 800);
    throw classifyCloudflareError(res.status, txt);
  }
  // Response shape: { result: { image: "<base64 jpeg>" }, success: true, ... }
  const j = await res.json();
  const b64: string | undefined = j?.result?.image;
  if (!b64) throw new Error(`cloudflare returned no image: ${JSON.stringify(j).slice(0, 300)}`);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Cost log: Cloudflare Workers AI images run on the free-neurons tier for
  // our current volume → cost_usd 0. Still log the row so the per-page
  // provider attribution + daily-spend audit is complete.
  try {
    logAiCost(costDb(), {
      ebook_id: opts.ebook_id,
      step: opts.step ?? "coloring_interior_cloudflare",
      model: "@cf/black-forest-labs/flux-1-schnell",
      images: 1,
      cost_usd: 0,
      provider: "cloudflare_direct",
    });
  } catch (_e) { /* best-effort */ }
  return bytes;
}

// -------- Provider registry + dispatcher --------

export const PROVIDERS: Record<ImageProviderId, (o: GenerateImageOpts) => Promise<Uint8Array>> = {
  cloudflare_flux_schnell: cloudflareFluxSchnell,
  fal_flux_schnell: (o) => falFluxSchnell({
    prompt: o.prompt,
    image_size: o.image_size,
    num_inference_steps: o.num_inference_steps,
    ebook_id: o.ebook_id,
    step: o.step,
  }),
};

/** Read image_provider_policy from generation_settings.coloring_autopilot. */
// deno-lint-ignore no-explicit-any
export async function readImageProviderPolicy(db: any): Promise<ImageProviderPolicy> {
  try {
    const { data } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
    const policy = cfg.image_provider_policy as Partial<ImageProviderPolicy> | undefined;
    const interiors = policy?.interiors;
    if (interiors?.primary) {
      return {
        interiors: {
          primary: interiors.primary,
          fallback: interiors.fallback ?? DEFAULT_IMAGE_PROVIDER_POLICY.interiors.fallback,
        },
      };
    }
  } catch (_e) { /* fall through */ }
  return DEFAULT_IMAGE_PROVIDER_POLICY;
}

/**
 * Dispatch with automatic failover. Semantics:
 *   - Try `primary`. Success → return.
 *   - On ProviderUnconfiguredError OR any generic error/timeout → try `fallback`.
 *   - FalBillingLockedError propagates up (lane must halt for BOTH providers
 *     — daily budget cap covers the whole lane, not per-provider).
 */
export async function generateImageWithFailover(
  opts: GenerateImageOpts,
  policy: { primary: ImageProviderId; fallback: ImageProviderId | null },
): Promise<GenerateImageResult> {
  const attempts: GenerateImageResult["attempts"] = [];
  const order: ImageProviderId[] = policy.fallback && policy.fallback !== policy.primary
    ? [policy.primary, policy.fallback]
    : [policy.primary];

  let lastErr: unknown = null;
  for (const providerId of order) {
    const fn = PROVIDERS[providerId];
    if (!fn) {
      attempts.push({ provider: providerId, ok: false, error: "unknown_provider" });
      continue;
    }
    try {
      const bytes = await fn(opts);
      attempts.push({ provider: providerId, ok: true });
      return { bytes, provider: providerId, attempts };
    } catch (e) {
      const err = e as Error;
      attempts.push({ provider: providerId, ok: false, error: err?.message ?? String(e) });
      // A billing-lock from the LAST provider in the chain halts the lane.
      // From a non-last provider, we still try the fallback (the fallback
      // might be a different account and still work).
      lastErr = e;
      if (e instanceof ProviderUnconfiguredError) continue;
      // Any other error → try next provider.
    }
  }
  // All providers failed → surface the last error (preserves billing-lock class).
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
