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
import { FalBillingLockedError, isFalBillingLocked, markProviderBillingBlocked } from "./fal-billing.ts";
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

// Cloudflare Workers AI enforces a hard prompt length limit (2048 chars).
// Truncate defensively at the adapter boundary so long compound prompts
// still land on CF — the trailing detail our prompts append (learned
// prevention clauses, category glossary) is safe to clip.
const CF_MAX_PROMPT_CHARS = 2000;

export async function cloudflareFluxSchnell(opts: GenerateImageOpts): Promise<Uint8Array> {
  const creds = cfCreds();
  if (!creds) throw new ProviderUnconfiguredError("cloudflare_flux_schnell", "CF_ACCOUNT_ID + CF_API_TOKEN not set");
  const steps = Math.min(CF_MAX_STEPS, Math.max(1, opts.num_inference_steps ?? 4));
  const prompt = opts.prompt.length > CF_MAX_PROMPT_CHARS
    ? opts.prompt.slice(0, CF_MAX_PROMPT_CHARS)
    : opts.prompt;
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, num_steps: steps }),
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

/**
 * CF daily-quota latch: on the first Cloudflare 429/4006 of the day we set
 * generation_settings.coloring_autopilot.cf_billing_locked_until = next
 * 00:00 UTC (Cloudflare's daily neuron pool reset). Until that instant,
 * `readImageProviderPolicy` transparently swaps CF out (primary→fallback)
 * so we don't burn a wasted round-trip per page — only ONE per day.
 */
// deno-lint-ignore no-explicit-any
export async function readCfBillingLockedUntil(db: any): Promise<Date | null> {
  try {
    const { data } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
    const raw = cfg.cf_billing_locked_until as string | undefined;
    if (!raw) return null;
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return null;
    return dt > new Date() ? dt : null;
  } catch (_e) { return null; }
}

function nextUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

// deno-lint-ignore no-explicit-any
export async function latchCfBillingUntilNextUtcMidnight(db: any, ebook_id?: string): Promise<Date> {
  const until = nextUtcMidnight();
  try {
    const { data } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
    // Idempotent: don't rewrite if already latched further out.
    const existing = cfg.cf_billing_locked_until ? new Date(cfg.cf_billing_locked_until as string) : null;
    if (!existing || isNaN(existing.getTime()) || existing < until) {
      await db.from("generation_settings").update({
        coloring_autopilot: { ...cfg, cf_billing_locked_until: until.toISOString() },
      }).eq("id", 1);
    }
  } catch (_e) { /* best-effort */ }
  // Observability: one cost_log row marking the latch (cost 0).
  try {
    logAiCost(costDb(), {
      ebook_id,
      step: "cloudflare_quota_exhausted_latched",
      model: "@cf/black-forest-labs/flux-1-schnell",
      images: 0,
      cost_usd: 0,
      provider: "cloudflare_direct",
    });
  } catch (_e) { /* best-effort */ }
  return until;
}

/**
 * Read image_provider_policy from generation_settings.coloring_autopilot.
 * Applies per-provider health latches so a dry provider is transparently
 * skipped:
 *   - CF daily-quota latch (cf_billing_locked_until in future) → swap CF out.
 *   - FAL per-provider billing_blocked (provider_billing_blocked.fal.active)
 *     → swap FAL out.
 * The policy returned always reflects only providers that are currently
 * eligible to be called. If ALL configured providers are dry, primary stays
 * as-is so the caller surfaces a real error instead of silent inaction.
 */
// deno-lint-ignore no-explicit-any
export async function readImageProviderPolicy(db: any): Promise<ImageProviderPolicy> {
  let base = DEFAULT_IMAGE_PROVIDER_POLICY;
  let cfg: Record<string, unknown> = {};
  try {
    const { data } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    cfg = (data?.coloring_autopilot ?? {}) as Record<string, unknown>;
    const policy = cfg.image_provider_policy as Partial<ImageProviderPolicy> | undefined;
    const interiors = policy?.interiors;
    if (interiors?.primary) {
      base = {
        interiors: {
          primary: interiors.primary,
          fallback: interiors.fallback ?? DEFAULT_IMAGE_PROVIDER_POLICY.interiors.fallback,
        },
      };
    }
  } catch (_e) { /* fall through */ }

  const cfLatch = await readCfBillingLockedUntil(db);
  const cfBlocked = !!cfLatch
    || !!((cfg.provider_billing_blocked as any)?.cloudflare?.active);
  const falBlocked = !!((cfg.provider_billing_blocked as any)?.fal?.active)
    || !!(cfg.billing_blocked as any)?.active; // legacy mirror

  const dry = (p: ImageProviderId) =>
    (p === "cloudflare_flux_schnell" && cfBlocked) ||
    (p === "fal_flux_schnell" && falBlocked);

  const ordered: ImageProviderId[] = [];
  for (const p of [base.interiors.primary, base.interiors.fallback].filter(Boolean) as ImageProviderId[]) {
    if (!ordered.includes(p) && !dry(p)) ordered.push(p);
  }
  if (ordered.length === 0) {
    // Every configured provider is dry — return the original policy so the
    // caller sees the real provider error (don't fabricate a healthy path).
    return base;
  }
  return { interiors: { primary: ordered[0], fallback: ordered[1] ?? null } };
}

/**
 * Dispatch with automatic failover. Semantics:
 *   - Try `primary`. Success → return.
 *   - On ProviderUnconfiguredError OR any generic error/timeout → try `fallback`.
 *   - FalBillingLockedError from the LAST provider propagates up.
 *   - FalBillingLockedError from Cloudflare (when db provided) sets the
 *     daily latch so tomorrow's runs skip CF entirely until next 00:00 UTC.
 */
export async function generateImageWithFailover(
  opts: GenerateImageOpts,
  policy: { primary: ImageProviderId; fallback: ImageProviderId | null },
  // deno-lint-ignore no-explicit-any
  db?: any,
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
      lastErr = e;
      // Provider billing/quota lock → mark the specific provider blocked so
      // the next dispatch (and readImageProviderPolicy) skips it entirely
      // instead of freezing the lane. Cloudflare also latches for the day.
      if (e instanceof FalBillingLockedError && db) {
        if (providerId === "cloudflare_flux_schnell") {
          await latchCfBillingUntilNextUtcMidnight(db, opts.ebook_id);
          try { await markProviderBillingBlocked(db, "cloudflare", e); } catch (_e) { /* best-effort */ }
        } else if (providerId === "fal_flux_schnell") {
          try { await markProviderBillingBlocked(db, "fal", e); } catch (_e) { /* best-effort */ }
        }
      }
      if (e instanceof ProviderUnconfiguredError) continue;
      // A provider-billing lock on THIS provider is not fatal — keep trying
      // the next configured fallback rather than propagating up.
      if (e instanceof FalBillingLockedError) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

