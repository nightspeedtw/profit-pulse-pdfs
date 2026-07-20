// Shared "try direct providers first, gateway last" chat helper.
// Order: gemini-direct (if google/*) -> openai-direct (as second-tier for JSON/text
// judges) -> Lovable Gateway. This preserves behavior when direct keys are set
// AND automatically routes around the Gemini free-tier 20 req/day quota that
// causes silent fallback storms on the gateway.

import { hasGeminiDirect, geminiDirectChat } from "./gemini-direct.ts";
import { hasOpenAIDirect, openaiDirectChat } from "./openai-direct.ts";
import { assertGatewayAllowed } from "./gateway-guard.ts";

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");

// Cheap/pro OpenAI equivalents when a google model call fails and we need
// to keep the pipeline moving without touching the Lovable gateway.
function openaiEquivalent(googleModel: string): string {
  if (/pro/i.test(googleModel)) return "openai/gpt-4o";
  return "openai/gpt-4o-mini";
}

export interface SmartChatOpts {
  system: string;
  user: string;
  model: string;              // e.g. "google/gemini-2.5-flash" or "openai/gpt-4o-mini"
  responseJson?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface SmartChatResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  provider: "google_direct" | "openai_direct" | "gateway";
}

export async function smartChat(opts: SmartChatOpts): Promise<SmartChatResult> {
  const isGoogle = opts.model.startsWith("google/");
  const isOpenAI = opts.model.startsWith("openai/");

  // Tier 1: gemini-direct for google models.
  if (isGoogle && hasGeminiDirect()) {
    try {
      const r = await geminiDirectChat({
        system: opts.system, user: opts.user, model: opts.model, responseJson: opts.responseJson,
      });
      return { ...r, provider: "google_direct" };
    } catch (e) {
      console.warn(`[smartChat] gemini-direct failed (${(e as Error).message}) — trying openai-direct`);
    }
  }

  // Tier 2: openai-direct (either native openai/* model, or google fallback).
  if (hasOpenAIDirect()) {
    try {
      const model = isOpenAI ? opts.model : openaiEquivalent(opts.model);
      const r = await openaiDirectChat({
        system: opts.system, user: opts.user, model, responseJson: opts.responseJson,
        maxTokens: opts.maxTokens, timeoutMs: opts.timeoutMs,
      });
      return { ...r, provider: "openai_direct" };
    } catch (e) {
      console.warn(`[smartChat] openai-direct failed (${(e as Error).message}) — falling to gateway`);
    }
  }

  // Tier 3: Lovable Gateway (last resort — draws from workspace credit pool).
  if (!LOVABLE_KEY) throw new Error("no direct key succeeded and LOVABLE_API_KEY not set");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    ...(opts.responseJson ? { response_format: { type: "json_object" } } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };
  const controller = opts.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort("smart_chat_timeout"), opts.timeoutMs) : null;
  let r: Response;
  try {
    r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } finally { if (timer) clearTimeout(timer); }
  if (!r.ok) throw new Error(`gateway ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: j.choices?.[0]?.message?.content ?? "",
    input_tokens: j.usage?.prompt_tokens ?? 0,
    output_tokens: j.usage?.completion_tokens ?? 0,
    model: opts.model,
    provider: "gateway",
  };
}
