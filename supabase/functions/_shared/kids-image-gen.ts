// Reference-conditioned image generator for kids picture books.
//
// Path A (default): Lovable AI Gateway (Gemini image models).
// Path B (opt-in): Google AI Studio direct API if GEMINI_API_KEY is set
//                  — same models, same prompts, ~30-50% cheaper (bypasses
//                  gateway markup). Fires cost_log so the ebook_costs view
//                  reflects both routes.

import { hasGeminiDirect, geminiDirectImage } from "./gemini-direct.ts";
import { logAiCost, costDb } from "./cost-log.ts";
import "./gateway-guard.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

export type GeminiImageModel =
  | "google/gemini-3.1-flash-image"
  | "google/gemini-3.1-flash-lite-image"
  | "google/gemini-2.5-flash-image"
  | "google/gemini-3-pro-image";

export interface RefImageGenOpts {
  prompt: string;
  referenceUrls: string[];
  model?: GeminiImageModel;
  ebook_id?: string;
  step?: string;
}

async function gatewayImage(model: GeminiImageModel, opts: RefImageGenOpts): Promise<Uint8Array> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  for (const u of opts.referenceUrls) content.push({ type: "image_url", image_url: { url: u } });
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
  if (!r.ok) throw new Error(`gemini-image ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as { data?: Array<{ b64_json?: string }> };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error(`gemini-image ${model}: no b64_json in response`);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function generateWithReference(opts: RefImageGenOpts): Promise<Uint8Array> {
  const model = opts.model ?? "google/gemini-3.1-flash-image";
  const step = opts.step ?? "kids_image_gen";
  let provider: "google_direct" | "gateway" = "gateway";
  let bytes: Uint8Array;
  if (hasGeminiDirect()) {
    try {
      bytes = await geminiDirectImage({ prompt: opts.prompt, referenceUrls: opts.referenceUrls, model });
      provider = "google_direct";
    } catch (e) {
      console.warn("gemini-direct image failed, falling back to gateway:", (e as Error).message);
      bytes = await gatewayImage(model, opts);
    }
  } else {
    bytes = await gatewayImage(model, opts);
  }
  logAiCost(costDb(), { ebook_id: opts.ebook_id, step, model, images: 1, provider });
  return bytes;
}

export async function isReferenceModelAvailable(sampleReferenceUrl: string): Promise<boolean> {
  try {
    await generateWithReference({
      prompt: "Test: reproduce the same character in a simple standing pose on a plain background. No text.",
      referenceUrls: [sampleReferenceUrl],
      step: "kids_image_gen_probe",
    });
    return true;
  } catch (e) {
    console.warn("reference model unavailable:", (e as Error).message);
    return false;
  }
}
