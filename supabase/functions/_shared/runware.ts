// Runware.ai image-inference adapter.
//
// Contract: runwareInference({ prompt, ... }) → Uint8Array (image bytes).
// Auth:     Bearer $RUNWARE_API_KEY. Missing key → ProviderUnconfiguredError-like
//           behavior (thrown as generic Error; the caller's failover picks the
//           next provider). We keep this file free of a hard dependency on
//           image-providers.ts to avoid an import cycle.
//
// Pricing:  Runware bills per-request; each task's `cost` is returned in the
//           response and logged to cost_log with provider='runware_direct'.
// Errors:   402/403 balance/billing-locked responses raise FalBillingLockedError
//           (shared class) so the lane treats runware the same as fal/cloudflare
//           for per-provider latching + parked-book handling.

import { FalBillingLockedError, isFalBillingLocked } from "./fal-billing.ts";
import { logAiCost, costDb } from "./cost-log.ts";
import { coerceForProviderPayload } from "./coloring/payload-guard.ts";

// One place for model IDs — anything scattered elsewhere is a bug.
// Runware uses the AIR identifier system: <ecosystem>:<modelId>@<version>.
export const RUNWARE_MODELS = {
  // Fast, cheap, clean line-art friendly — for coloring interiors + character refs.
  line_art: "runware:100@1",     // FLUX.1 [schnell]
  // Higher fidelity for covers + hero art.
  cover:    "runware:101@1",     // FLUX.1 [dev]
} as const;

export type RunwareModelKey = keyof typeof RUNWARE_MODELS;

const RUNWARE_ENDPOINT = "https://api.runware.ai/v1";
const RUNWARE_MAX_PROMPT_CHARS = 3000;

function key(): string | null {
  return Deno.env.get("RUNWARE_API_KEY") ?? null;
}

function sizeToWH(size?: string): { width: number; height: number } {
  switch (size) {
    case "portrait_4_3":   return { width: 768,  height: 1024 };
    case "portrait_16_9":  return { width: 720,  height: 1280 };
    case "landscape_4_3":  return { width: 1024, height: 768 };
    case "landscape_16_9": return { width: 1280, height: 720 };
    case "square_hd":
    default:               return { width: 1024, height: 1024 };
  }
}

// Runware wants width/height as multiples of 64, in [512, 2048].
function clampDim(n: number): number {
  const r = Math.round(n / 64) * 64;
  return Math.max(512, Math.min(2048, r));
}

function uuid(): string {
  // deno-lint-ignore no-explicit-any
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export interface RunwareOpts {
  prompt: string;
  image_size?: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  num_inference_steps?: number;
  model?: string;                  // AIR id; defaults to RUNWARE_MODELS.line_art
  ebook_id?: string;
  step?: string;
}

/** Run one imageInference task and return raw bytes. */
export async function runwareInference(opts: RunwareOpts): Promise<Uint8Array> {
  const k = key();
  if (!k) throw new Error("runware: RUNWARE_API_KEY not set");

  const model = opts.model || RUNWARE_MODELS.line_art;
  const { width, height } = sizeToWH(opts.image_size);
  const prompt = opts.prompt.length > RUNWARE_MAX_PROMPT_CHARS
    ? opts.prompt.slice(0, RUNWARE_MAX_PROMPT_CHARS)
    : opts.prompt;

  const task = {
    taskType: "imageInference",
    taskUUID: uuid(),
    positivePrompt: prompt,
    model,
    width: clampDim(width),
    height: clampDim(height),
    steps: Math.max(1, Math.min(50, opts.num_inference_steps ?? 4)),
    numberResults: 1,
    outputType: ["base64Data"],
    outputFormat: "JPEG",
    includeCost: true,
  };

  const safeTask = coerceForProviderPayload(task, "runware_interior");
  const res = await fetch(RUNWARE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([safeTask]),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    if (isFalBillingLocked(res.status, bodyText) || res.status === 402
        || /balance|credit|insufficient|billing|payment required/i.test(bodyText)) {
      throw new FalBillingLockedError(res.status, `runware: ${bodyText.slice(0, 240)}`);
    }
    throw new Error(`runware ${res.status}: ${bodyText.slice(0, 400)}`);
  }

  // deno-lint-ignore no-explicit-any
  let j: any;
  try { j = JSON.parse(bodyText); } catch {
    throw new Error(`runware: non-JSON response: ${bodyText.slice(0, 200)}`);
  }
  // API-level error payloads may return 200 with { errors: [...] }.
  if (Array.isArray(j?.errors) && j.errors.length > 0) {
    const msg = j.errors.map((e: { message?: string; error?: string }) => e.message || e.error || JSON.stringify(e)).join("; ");
    if (/balance|credit|insufficient|billing|payment/i.test(msg)) {
      throw new FalBillingLockedError(402, `runware: ${msg.slice(0, 240)}`);
    }
    throw new Error(`runware errors: ${msg.slice(0, 400)}`);
  }
  const data = (j?.data ?? []) as Array<{ imageBase64Data?: string; imageURL?: string; cost?: number }>;
  const first = data[0];
  if (!first) throw new Error(`runware: empty data: ${bodyText.slice(0, 200)}`);

  let bytes: Uint8Array;
  if (first.imageBase64Data) {
    const bin = atob(first.imageBase64Data);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else if (first.imageURL) {
    const imgRes = await fetch(first.imageURL);
    if (!imgRes.ok) throw new Error(`runware image fetch ${imgRes.status}`);
    bytes = new Uint8Array(await imgRes.arrayBuffer());
  } else {
    throw new Error(`runware: no image in response: ${bodyText.slice(0, 200)}`);
  }

  try {
    logAiCost(costDb(), {
      ebook_id: opts.ebook_id,
      step: opts.step ?? "coloring_interior_runware",
      model,
      images: 1,
      cost_usd: Number(first.cost ?? 0) || 0,
      provider: "runware_direct",
    });
  } catch (_e) { /* best-effort */ }

  return bytes;
}
