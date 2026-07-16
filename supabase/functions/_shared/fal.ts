// Fal.ai helper — call Flux Schnell (fast draft) and Recraft V3 (final quality).
// Returns raw PNG bytes so callers can upload to storage themselves.
//
// Fal is already a direct-billing API (no gateway markup) so we just add
// cost_log accounting per call.

import { logAiCost, costDb } from "./cost-log.ts";

const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_KEY");

type FalImageOpts = {
  prompt: string;
  image_url?: string;
  strength?: number;
  image_size?: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  negative_prompt?: string;
  ebook_id?: string;
  step?: string;
  output_format?: "png" | "jpeg";
};

async function callFal(endpoint: string, body: Record<string, unknown>, meta?: { ebook_id?: string; step?: string; model: string }): Promise<Uint8Array> {
  if (!FAL_KEY) throw new Error("FAL_API_KEY not configured");
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fal ${endpoint} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();
  const url: string | undefined = j?.images?.[0]?.url ?? j?.image?.url;
  if (!url) throw new Error(`fal ${endpoint} returned no image url: ${JSON.stringify(j).slice(0, 300)}`);
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`fal image fetch ${imgRes.status}`);
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  if (meta) {
    logAiCost(costDb(), {
      ebook_id: meta.ebook_id,
      step: meta.step ?? "kids_fal_image",
      model: meta.model,
      images: 1,
      provider: "fal_direct",
    });
  }
  return bytes;
}

export function falFluxSchnell(opts: FalImageOpts): Promise<Uint8Array> {
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: opts.image_size ?? "square_hd",
    num_inference_steps: 4,
    num_images: 1,
    enable_safety_checker: true,
    output_format: opts.output_format ?? "jpeg",
  };
  return callFal("fal-ai/flux/schnell", body, { ebook_id: opts.ebook_id, step: opts.step, model: "fal-ai/flux/schnell" });
}

export async function falRecraftV3(opts: FalImageOpts & { style?: string }): Promise<Uint8Array> {
  if (opts.image_url) {
    return falFluxSchnell({
      prompt: opts.prompt,
      image_url: opts.image_url,
      strength: opts.strength ?? 0.6,
      image_size: opts.image_size,
      negative_prompt: opts.negative_prompt,
      ebook_id: opts.ebook_id,
      step: opts.step,
    });
  }
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: opts.image_size ?? "portrait_4_3",
    style: opts.style ?? "digital_illustration",
  };
  if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt;
  return callFal("fal-ai/recraft-v3", body, { ebook_id: opts.ebook_id, step: opts.step, model: "fal-ai/recraft-v3" });
}

/**
 * Ideogram v3 via Fal — industry-best model for text-in-image (~90% accuracy).
 * Used as the primary rung of the cover-title ladder.
 * Endpoint: fal-ai/ideogram/v3
 */
export async function falIdeogramV3(opts: {
  prompt: string;
  image_size?: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  style?: "AUTO" | "GENERAL" | "REALISTIC" | "DESIGN";
  negative_prompt?: string;
  seed?: number;
  rendering_speed?: "TURBO" | "BALANCED" | "QUALITY";
  ebook_id?: string;
  step?: string;
}): Promise<Uint8Array> {
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: opts.image_size ?? "square_hd",
    style: opts.style ?? "DESIGN",
    rendering_speed: opts.rendering_speed ?? "QUALITY",
    num_images: 1,
    expand_prompt: false,
  };
  if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt;
  if (typeof opts.seed === "number") body.seed = opts.seed;
  return callFal("fal-ai/ideogram/v3", body, {
    ebook_id: opts.ebook_id,
    step: opts.step ?? "kids_cover_ideogram_v3",
    model: "fal-ai/ideogram/v3",
  });
}
