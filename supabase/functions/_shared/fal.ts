// Fal.ai helper — call Flux Schnell (fast draft) and Recraft V3 (final quality).
// Returns raw PNG bytes so callers can upload to storage themselves.

const FAL_KEY = Deno.env.get("FAL_API_KEY");

type FalImageOpts = {
  prompt: string;
  image_url?: string;   // when set → image-to-image
  strength?: number;    // 0..1, default 0.65 (character fidelity)
  image_size?: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  negative_prompt?: string;
};

async function callFal(endpoint: string, body: Record<string, unknown>): Promise<Uint8Array> {
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
  return new Uint8Array(await imgRes.arrayBuffer());
}

/** Flux Schnell — ~4 steps, ~$0.003, good for drafts / character reference sheets. */
export function falFluxSchnell(opts: FalImageOpts): Promise<Uint8Array> {
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: opts.image_size ?? "square_hd",
    num_inference_steps: 4,
    num_images: 1,
    enable_safety_checker: true,
  };
  if (opts.image_url) {
    body.image_url = opts.image_url;
    body.strength = opts.strength ?? 0.65;
    return callFal("fal-ai/flux/schnell/image-to-image", body);
  }
  return callFal("fal-ai/flux/schnell", body);
}

/** Recraft V3 — higher quality illustration, ~$0.04. Use for finals + covers. */
export function falRecraftV3(opts: FalImageOpts & { style?: string }): Promise<Uint8Array> {
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: opts.image_size ?? "portrait_4_3",
    style: opts.style ?? "digital_illustration",
  };
  if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt;
  // Recraft V3 supports image-to-image via a different endpoint.
  if (opts.image_url) {
    body.image_url = opts.image_url;
    body.strength = opts.strength ?? 0.6;
    return callFal("fal-ai/recraft-v3/image-to-image", body);
  }
  return callFal("fal-ai/recraft-v3", body);
}
