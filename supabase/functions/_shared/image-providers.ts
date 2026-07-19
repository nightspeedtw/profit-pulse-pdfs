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
import { FalBillingLockedError, isFalBillingLocked, markProviderBillingBlocked, type ProviderKey } from "./fal-billing.ts";
import { logAiCost, costDb } from "./cost-log.ts";
import { runwareInference, RUNWARE_MODELS } from "./runware.ts";

export type ImageProviderId =
  | "runware_flux_schnell"
  | "cloudflare_flux_schnell"
  | "fal_flux_schnell";

export type ImageProviderPolicy = {
  interiors: {
    primary: ImageProviderId;
    fallback: ImageProviderId | null;
    fallback2?: ImageProviderId | null;
  };
};

// PRIMARY = Runware. FALLBACK = Cloudflare. fal.ai is PERMANENTLY CUT
// (owner decision 2026-07-18: same FLUX model @ ~3x Runware cost). The
// adapter file `_shared/fal.ts` is retained for historical read/audit only;
// no chain, policy, or DB override may select `fal_flux_schnell` anymore —
// see `readImageProviderPolicy` which strips it defensively.
export const DEFAULT_IMAGE_PROVIDER_POLICY: ImageProviderPolicy = {
  interiors: {
    primary: "runware_flux_schnell",
    fallback: "cloudflare_flux_schnell",
    fallback2: null,
  },
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
  runware_flux_schnell: (o) => runwareInference({
    prompt: o.prompt,
    image_size: o.image_size,
    num_inference_steps: o.num_inference_steps,
    model: RUNWARE_MODELS.line_art,
    ebook_id: o.ebook_id,
    step: o.step,
  }),
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
export async function readImageProviderPolicy(db: any, call_class = "coloring_interior"): Promise<ImageProviderPolicy> {
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
          fallback2: interiors.fallback2 ?? DEFAULT_IMAGE_PROVIDER_POLICY.interiors.fallback2 ?? null,
        },
      };
    }
  } catch (_e) { /* fall through */ }

  const cfLatch = await readCfBillingLockedUntil(db);
  const pbb = (cfg.provider_billing_blocked as any) ?? {};
  const cfBlocked = !!cfLatch || !!pbb?.cloudflare?.active;
  const falBlocked = !!pbb?.fal?.active || !!(cfg.billing_blocked as any)?.active;
  const runwareBlocked = !!pbb?.runware?.active;
  const runwareUnconfigured = !Deno.env.get("RUNWARE_API_KEY");

  const dry = (p: ImageProviderId) =>
    p === "fal_flux_schnell" ||
    (p === "cloudflare_flux_schnell" && cfBlocked) ||
    (p === "runware_flux_schnell" && (runwareBlocked || runwareUnconfigured));

  // Owner doctrine "quality_at_the_source": route by MEASURED FPY when
  // history is thick enough. v_call_class_provider_fpy is refreshed
  // implicitly on every read. Providers with insufficient sample fall to
  // the configured chain order.
  let ordered: ImageProviderId[] = [];
  try {
    const { data: fpyRows } = await db.from("v_call_class_provider_fpy")
      .select("provider,attempts,fpy_pct").eq("call_class", call_class);
    const providerKeyToId: Record<string, ImageProviderId> = {
      runware_direct: "runware_flux_schnell",
      cloudflare_direct: "cloudflare_flux_schnell",
      fal_direct: "fal_flux_schnell",
      runware: "runware_flux_schnell",
      cloudflare: "cloudflare_flux_schnell",
      fal: "fal_flux_schnell",
      runware_flux_schnell: "runware_flux_schnell",
      cloudflare_flux_schnell: "cloudflare_flux_schnell",
      fal_flux_schnell: "fal_flux_schnell",
    };
    const ranked = (Array.isArray(fpyRows) ? fpyRows : [])
      .map((r: any) => ({
        id: providerKeyToId[r.provider] as ImageProviderId | undefined,
        attempts: r.attempts ?? 0,
        fpy: r.fpy_pct ?? 0,
      }))
      .filter((r: any) => r.id && r.attempts >= 5)
      .sort((a: any, b: any) => b.fpy - a.fpy)
      .map((r: any) => r.id as ImageProviderId);
    for (const p of ranked) if (!ordered.includes(p) && !dry(p)) ordered.push(p);
  } catch (_e) { /* fall through */ }

  const configuredChain = [base.interiors.primary, base.interiors.fallback, base.interiors.fallback2]
    .filter(Boolean) as ImageProviderId[];
  for (const p of configuredChain) if (!ordered.includes(p) && !dry(p)) ordered.push(p);
  if (ordered.length === 0) return base;
  const finalPolicy = {
    interiors: {
      primary: ordered[0],
      fallback: ordered[1] ?? null,
      fallback2: ordered[2] ?? null,
    },
  };
  console.log(`[image-providers] call_class=${call_class} chain=${ordered.join(",")} cf_blocked=${cfBlocked} fal_blocked=${falBlocked} runware_blocked=${runwareBlocked}`);
  return finalPolicy;
}

/**
 * Dispatch with automatic failover across a chain of up to 3 providers.
 * On a per-provider billing lock the provider is latched and the loop
 * continues to the next healthy provider; only the LAST error propagates.
 */
export async function generateImageWithFailover(
  opts: GenerateImageOpts,
  policy: { primary: ImageProviderId; fallback: ImageProviderId | null; fallback2?: ImageProviderId | null },
  // deno-lint-ignore no-explicit-any
  db?: any,
): Promise<GenerateImageResult> {
  const attempts: GenerateImageResult["attempts"] = [];
  const chain = [policy.primary, policy.fallback, policy.fallback2 ?? null].filter(Boolean) as ImageProviderId[];
  const order: ImageProviderId[] = [];
  for (const p of chain) if (!order.includes(p)) order.push(p);

  const providerKey = (id: ImageProviderId): ProviderKey | null => {
    if (id === "cloudflare_flux_schnell") return "cloudflare";
    if (id === "fal_flux_schnell") return "fal";
    if (id === "runware_flux_schnell") return "runware" as ProviderKey;
    return null;
  };

  // Per-provider hard timeout. A hung provider (e.g. billing-locked account
  // that never returns) must never eat the whole dispatcher budget — that
  // is the "one provider hangs, whole queue stalls" regression class from
  // known-regressions.md. 45s covers a real cold-start Flux run with room
  // to spare while still forcing failover long before the gateway wall.
  const PROVIDER_TIMEOUT_MS = 45_000;
  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`provider_hard_timeout_${ms}ms:${label}`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });

  let lastErr: unknown = null;
  for (const providerId of order) {
    const fn = PROVIDERS[providerId];
    if (!fn) {
      attempts.push({ provider: providerId, ok: false, error: "unknown_provider" });
      continue;
    }
    try {
      const bytes = await withTimeout(fn(opts), PROVIDER_TIMEOUT_MS, providerId);
      attempts.push({ provider: providerId, ok: true });
      return { bytes, provider: providerId, attempts };
    } catch (e) {
      const err = e as Error;
      attempts.push({ provider: providerId, ok: false, error: err?.message ?? String(e) });
      lastErr = e;
      if (e instanceof FalBillingLockedError && db) {
        if (providerId === "cloudflare_flux_schnell") {
          await latchCfBillingUntilNextUtcMidnight(db, opts.ebook_id);
        }
        const key = providerKey(providerId);
        if (key) {
          try { await markProviderBillingBlocked(db, key, e); } catch (_e) { /* best-effort */ }
        }
      }
      if (e instanceof ProviderUnconfiguredError) continue;
      if (e instanceof FalBillingLockedError) continue;
      // Hard timeout → try next provider immediately (fail-fast).
      if (err?.message?.startsWith("provider_hard_timeout_")) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

