// Reference-conditioned image generator for kids picture books.
//
// Uses Lovable AI Gateway's Gemini image models (google/gemini-3.1-flash-image,
// aka "Nano Banana 2") which accept one or more reference images inside the
// chat-shape body with modalities: ["image","text"]. This lets us pass the
// cover master + (optionally) a locked Luna reference on every spread call, so
// character identity, palette, line quality, and world style stay tight
// across the whole book — the exact thing Fal Flux Schnell text-to-image
// could not do.
//
// If the Gateway call fails or is unavailable, callers can fall back to Fal
// (text-only) — see kids-interior.ts for the strategy switch.

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

export type GeminiImageModel =
  | "google/gemini-3.1-flash-image"
  | "google/gemini-3.1-flash-lite-image"
  | "google/gemini-2.5-flash-image"
  | "google/gemini-3-pro-image";

export interface RefImageGenOpts {
  prompt: string;
  referenceUrls: string[];    // cover master + optional character sheet
  model?: GeminiImageModel;
}

/**
 * Generate an image conditioned on one or more reference images.
 * Returns raw PNG bytes. Uses the /v1/images/generations endpoint with the
 * Gemini chat-shape body (messages + modalities). Non-streaming: response is
 * the normalized OpenAI images shape with data[0].b64_json.
 */
export async function generateWithReference(opts: RefImageGenOpts): Promise<Uint8Array> {
  const model = opts.model ?? "google/gemini-3.1-flash-image";
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: opts.prompt },
  ];
  for (const u of opts.referenceUrls) {
    content.push({ type: "image_url", image_url: { url: u } });
  }
  const body = {
    model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
  };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 400);
    throw new Error(`gemini-image ${model} ${r.status}: ${txt}`);
  }
  const j = await r.json() as { data?: Array<{ b64_json?: string }> };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error(`gemini-image ${model}: no b64_json in response`);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Probe availability once — returns true if a tiny reference-conditioned call
 * succeeds. Cheap safety net for the pipeline to decide strategy.
 */
export async function isReferenceModelAvailable(sampleReferenceUrl: string): Promise<boolean> {
  try {
    await generateWithReference({
      prompt: "Test: reproduce the same character in a simple standing pose on a plain background. No text.",
      referenceUrls: [sampleReferenceUrl],
    });
    return true;
  } catch (e) {
    console.warn("reference model unavailable:", (e as Error).message);
    return false;
  }
}
