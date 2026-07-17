// Direct OpenAI API client — bypasses Lovable Gateway markup when
// OPENAI_API_KEY is present. Mirrors _shared/gemini-direct.ts pattern:
// callers ALWAYS check `hasOpenAIDirect()` first and fall back to the
// gateway path on missing key or on error, so behavior is identical when
// the key is not configured. This gives us a zero-risk bypass path that
// activates the moment an OPENAI_API_KEY secret is added.
//
// Scope: chat only (aiText / aiJSON). Image gen for OpenAI is not wired
// because covers go through Runware/Ideogram and the current pipeline
// does not use OpenAI image models.

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

export function hasOpenAIDirect(): boolean {
  return !!OPENAI_KEY && OPENAI_KEY.length > 10;
}

// Strip vendor prefix ("openai/gpt-5.1-mini" -> "gpt-5.1-mini").
function normalize(model: string): string {
  return model.replace(/^openai\//, "");
}

export async function openaiDirectChat(opts: {
  system?: string;
  user: string;
  model: string;
  responseJson?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; input_tokens: number; output_tokens: number; model: string }> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const model = normalize(opts.model);
  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  const body: Record<string, unknown> = {
    model,
    messages,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.responseJson ? { response_format: { type: "json_object" } } : {}),
  };
  const controller = opts.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort("openai_direct_timeout"), opts.timeoutMs) : null;
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!r.ok) {
    throw new Error(`openai-direct ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  }
  const j = await r.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = j.choices?.[0]?.message?.content ?? "";
  return {
    text,
    input_tokens: j.usage?.prompt_tokens ?? 0,
    output_tokens: j.usage?.completion_tokens ?? 0,
    model: `openai/${model}`,
  };
}

/**
 * Direct OpenAI image generation (gpt-image-1, gpt-image-2). Wired for the
 * cover-model evaluation path: owner asked to test GPT Image's exact-text
 * accuracy against Ideogram's before deciding whether to swap. Zero-risk —
 * throws "OPENAI_API_KEY not set" when the key is absent so callers cleanly
 * fall back to the Runware/Ideogram path.
 */
export async function openaiDirectImage(opts: {
  prompt: string;
  model?: string;                                    // default "gpt-image-1"
  size?: "1024x1024" | "1024x1536" | "1536x1024";    // portrait for covers = 1024x1536
  quality?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<{ bytes: Uint8Array; model: string }> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const model = opts.model ?? "gpt-image-1";
  const controller = opts.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort("openai_direct_image_timeout"), opts.timeoutMs) : null;
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        size: opts.size ?? "1024x1536",
        quality: opts.quality ?? "medium",
        n: 1,
      }),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!r.ok) {
    throw new Error(`openai-direct-image ${model} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  }
  const j = await r.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = j.data?.[0];
  if (!first) throw new Error(`openai-direct-image ${model}: empty data`);
  let bytes: Uint8Array;
  if (first.b64_json) {
    const bin = atob(first.b64_json);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else if (first.url) {
    const imgRes = await fetch(first.url);
    if (!imgRes.ok) throw new Error(`openai-direct-image download ${imgRes.status}`);
    bytes = new Uint8Array(await imgRes.arrayBuffer());
  } else {
    throw new Error(`openai-direct-image ${model}: no image payload`);
  }
  return { bytes, model };
}
