// Blog hero image provider ladder — fail-closed.
// Order: Runware (Ideogram/Flux) → Cloudflare Workers AI (flux-1-schnell)
//        → Gemini 2.5 Flash Image (Nano Banana).
// Returns bytes + provider tag, or throws BlogHeroAllProvidersFailedError.

import { runwareInference, RUNWARE_MODELS } from "./runware.ts";

const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID") ?? Deno.env.get("CF_ACCOUNT_ID_2") ?? null;
const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN") ?? Deno.env.get("CF_API_TOKEN_2") ?? null;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? null;

export class BlogHeroAllProvidersFailedError extends Error {
  errors: Array<{ provider: string; message: string }>;
  constructor(errors: Array<{ provider: string; message: string }>) {
    super(`blog_hero_all_providers_failed: ${errors.map((e) => `${e.provider}=${e.message}`).join(" | ")}`);
    this.name = "BlogHeroAllProvidersFailedError";
    this.errors = errors;
  }
}

export interface HeroImageResult {
  bytes: Uint8Array;
  provider: "runware" | "cloudflare" | "gemini";
  contentType: "image/jpeg" | "image/png";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function tryRunware(prompt: string): Promise<HeroImageResult> {
  const bytes = await runwareInference({
    prompt,
    image_size: "landscape_16_9",
    model: RUNWARE_MODELS.line_art,
    step: "blog_hero",
  });
  return { bytes, provider: "runware", contentType: "image/jpeg" };
}

async function tryCloudflare(prompt: string): Promise<HeroImageResult> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) throw new Error("cf_not_configured");
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4 }),
  });
  if (!res.ok) throw new Error(`cf_${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  const b64 = j?.result?.image;
  if (!b64) throw new Error("cf_no_image_field");
  return { bytes: b64ToBytes(b64), provider: "cloudflare", contentType: "image/jpeg" };
}

async function tryGemini(prompt: string): Promise<HeroImageResult> {
  if (!GEMINI_KEY) throw new Error("gemini_not_configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p?.inlineData?.data ?? p?.inline_data?.data;
    if (data) return { bytes: b64ToBytes(data), provider: "gemini", contentType: "image/png" };
  }
  throw new Error("gemini_no_inline_data");
}

export async function generateBlogHero(prompt: string): Promise<HeroImageResult> {
  const errors: Array<{ provider: string; message: string }> = [];
  const providers: Array<[string, () => Promise<HeroImageResult>]> = [
    ["runware", () => tryRunware(prompt)],
    ["cloudflare", () => tryCloudflare(prompt)],
    ["gemini", () => tryGemini(prompt)],
  ];
  for (const [name, fn] of providers) {
    try {
      const r = await fn();
      if (r.bytes && r.bytes.byteLength > 1000) return r;
      errors.push({ provider: name, message: "empty_bytes" });
    } catch (e) {
      errors.push({ provider: name, message: (e as Error).message.slice(0, 200) });
    }
  }
  throw new BlogHeroAllProvidersFailedError(errors);
}
