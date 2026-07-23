// Direct Google AI Studio API client — bypasses Lovable Gateway markup when
// GEMINI_API_KEY is present. Same models, same prompts, same output shape as
// used through the gateway (returns PNG bytes for image gen, OpenAI-shaped
// message JSON for chat).
//
// When BYPASS_LOVABLE_GATEWAY=1, this module MUST NOT fall back to the
// Lovable AI Gateway. Direct-provider quota/billing failures are returned as
// technical provider failures so the pipeline can rotate/park truthfully.

import { assertGatewayAllowed } from "./gateway-guard.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");

export function hasGeminiDirect(): boolean {
  return !!GEMINI_KEY && GEMINI_KEY.length > 10;
}

// Strip vendor prefix ("google/gemini-3.1-flash-image" -> "gemini-3.1-flash-image").
function normalize(model: string): string {
  return model.replace(/^google\//, "");
}

async function fetchImageAsB64(url: string): Promise<{ data: string; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ref fetch ${r.status}`);
  const mime = r.headers.get("content-type") ?? "image/png";
  const buf = new Uint8Array(await r.arrayBuffer());
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode(...buf.subarray(i, i + chunk));
  return { data: btoa(s), mime };
}

export interface GeminiImageMeta {
  finishReason: string | null;
  safetyRatings: unknown;
  partCount: number;
  bytesLen: number;
  provider: 'google_direct' | 'lovable_gateway';
  model: string;
  blockReason?: string | null;
}

/**
 * Reference-conditioned image generation via native Gemini generateContent.
 * Returns raw PNG bytes plus response metadata (finish reason, safety
 * ratings, part count) so callers can log WHY a black frame came back.
 */
export async function geminiDirectImageWithMeta(opts: {
  prompt: string;
  referenceUrls: string[];
  model?: string;
  seed?: number;
}): Promise<{ bytes: Uint8Array; meta: GeminiImageMeta }> {
  const bypass = (Deno.env.get("BYPASS_LOVABLE_GATEWAY") ?? "").match(/^(1|true|yes)$/i);
  if (!GEMINI_KEY) {
    if (bypass) throw new Error("GEMINI_API_KEY not set (BYPASS_LOVABLE_GATEWAY=1, gateway fallback disabled)");
    if (LOVABLE_KEY) return gatewayImageWithMeta(opts, "GEMINI_API_KEY not set");
    throw new Error("GEMINI_API_KEY not set");
  }
  const model = normalize(opts.model ?? "google/gemini-3.1-flash-image");
  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }];
  for (const u of opts.referenceUrls) {
    const { data, mime } = await fetchImageAsB64(u);
    parts.push({ inlineData: { mimeType: mime, data } });
  }
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE", "TEXT"] };
  if (typeof opts.seed === "number") generationConfig.seed = opts.seed;
  const body = { contents: [{ role: "user", parts }], generationConfig };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) {
    const directErr = `gemini-direct ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`;
    // When bypass is on, surface the true Google API error — do NOT throw the
    // misleading "Refusing Lovable AI Gateway call" bypass message.
    if (bypass) throw new Error(directErr);
    if (!LOVABLE_KEY) throw new Error(directErr);
    console.warn(`${directErr} — falling back to Lovable Gateway image model`);
    return gatewayImageWithMeta(opts, directErr);
  }
  const j = await r.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> }; finishReason?: string; safetyRatings?: unknown }>;
    promptFeedback?: { blockReason?: string; safetyRatings?: unknown };
  };
  const cand = j.candidates?.[0];
  const partList = cand?.content?.parts ?? [];
  const b64 = partList.find((p) => p.inlineData?.data)?.inlineData?.data;
  const meta: GeminiImageMeta = {
    finishReason: cand?.finishReason ?? null,
    safetyRatings: cand?.safetyRatings ?? j.promptFeedback?.safetyRatings ?? null,
    partCount: partList.length,
    bytesLen: 0,
    provider: 'google_direct',
    model: `google/${model}`,
    blockReason: j.promptFeedback?.blockReason ?? null,
  };
  if (!b64) {
    // Return an empty bytes buffer with meta so the luminance gate can classify
    // it as dead — callers don't need a special path for "no image in response".
    return { bytes: new Uint8Array(0), meta };
  }
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  meta.bytesLen = bytes.length;
  return { bytes, meta };
}

async function gatewayImageWithMeta(opts: {
  prompt: string;
  referenceUrls: string[];
  model?: string;
  seed?: number;
}, directErr: string): Promise<{ bytes: Uint8Array; meta: GeminiImageMeta }> {
  assertGatewayAllowed("geminiDirectImageWithMeta.gatewayImageWithMeta");
  if (!LOVABLE_KEY) throw new Error(directErr);
  const content: unknown[] = [{ type: "text", text: opts.prompt }];
  for (const u of opts.referenceUrls) content.push({ type: "image_url", image_url: { url: u } });
  const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      ...(typeof opts.seed === "number" ? { seed: opts.seed } : {}),
    }),
  });
  if (!r.ok) throw new Error(`${directErr}; gateway-image ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  let bytes = new Uint8Array(0);
  const b64 = j.data?.[0]?.b64_json;
  if (b64) bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  else if (j.data?.[0]?.url) {
    const img = await fetch(j.data[0].url!);
    if (!img.ok) throw new Error(`gateway image fetch ${img.status}`);
    bytes = new Uint8Array(await img.arrayBuffer());
  }
  return {
    bytes,
    meta: {
      finishReason: bytes.length ? "gateway_fallback" : "gateway_empty",
      safetyRatings: null,
      partCount: 1,
      bytesLen: bytes.length,
      provider: "lovable_gateway",
      model: "google/gemini-3-pro-image",
      blockReason: bytes.length ? null : "no_image_returned",
    },
  };
}

export async function geminiDirectImage(opts: {
  prompt: string;
  referenceUrls: string[];
  model?: string;
}): Promise<Uint8Array> {
  const { bytes } = await geminiDirectImageWithMeta(opts);
  if (bytes.length === 0) throw new Error(`gemini-direct ${opts.model ?? 'gemini-3.1-flash-image'}: no image in response`);
  return bytes;
}


/** Simple chat via native Gemini generateContent. Returns text + usage. */
export async function geminiDirectChat(opts: {
  system?: string;
  user: string;
  model?: string;
  responseJson?: boolean;
}): Promise<{ text: string; input_tokens: number; output_tokens: number; model: string }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
  const model = normalize(opts.model ?? "google/gemini-2.5-flash");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: opts.responseJson ? { responseMimeType: "application/json" } : {},
  };
  if (opts.system) (body as { systemInstruction?: unknown }).systemInstruction = { parts: [{ text: opts.system }] };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`gemini-direct chat ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    input_tokens: j.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: j.usageMetadata?.candidatesTokenCount ?? 0,
    model: `google/${model}`,
  };
}

/**
 * Vision chat via native Gemini generateContent — accepts remote image URLs
 * (fetched to inline base64) and returns text (typically JSON when
 * responseJson=true). Used to migrate raw-gateway vision QC callers
 * (kids-vision-qc, cover text transcription) off the Lovable Gateway to
 * google_direct, saving ~30-50% on Gemini pass-through fees.
 */
export async function geminiDirectVisionChat(opts: {
  system?: string;
  userText: string;
  imageUrls: string[];
  model?: string;
  responseJson?: boolean;
  timeoutMs?: number;
}): Promise<{ text: string; input_tokens: number; output_tokens: number; model: string }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
  const model = normalize(opts.model ?? "google/gemini-2.5-flash");
  const parts: Array<Record<string, unknown>> = [{ text: opts.userText }];
  for (const u of opts.imageUrls) {
    const { data, mime } = await fetchImageAsB64(u);
    parts.push({ inlineData: { mimeType: mime, data } });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: opts.responseJson ? { responseMimeType: "application/json" } : {},
  };
  if (opts.system) (body as { systemInstruction?: unknown }).systemInstruction = { parts: [{ text: opts.system }] };
  const controller = opts.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort("gemini_direct_vision_timeout"), opts.timeoutMs) : null;
  let r: Response;
  try {
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller?.signal },
    );
  } finally { if (timer) clearTimeout(timer); }
  if (!r.ok) throw new Error(`gemini-direct vision ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    input_tokens: j.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: j.usageMetadata?.candidatesTokenCount ?? 0,
    model: `google/${model}`,
  };
}
