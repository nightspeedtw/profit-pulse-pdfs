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
