// Shared helpers for ebook factory edge functions
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Cost per 1M tokens — approximate, used for budget display only.
const RATES: Record<string, { in: number; out: number }> = {
  "google/gemini-3-flash-preview": { in: 0.075, out: 0.30 },
  "google/gemini-3.1-flash-lite": { in: 0.05, out: 0.20 },
  "google/gemini-3.5-flash": { in: 0.15, out: 0.60 },
  "google/gemini-3.1-pro-preview": { in: 1.25, out: 5.00 },
  "google/gemini-2.5-pro": { in: 1.25, out: 5.00 },
  "google/gemini-3-pro-image": { in: 1.00, out: 40.00 },
};

function pickModel(mode: string, kind: "ideation" | "content" | "marketing" | "qc"): string {
  if (mode === "premium") return "google/gemini-3.1-pro-preview";
  if (mode === "low_cost") return kind === "ideation" ? "google/gemini-3.1-flash-lite" : "google/gemini-3-flash-preview";
  // hybrid
  if (kind === "marketing" || kind === "qc") return "google/gemini-3.1-pro-preview";
  return "google/gemini-3-flash-preview";
}
export { pickModel };

export type AIResult<T> = { data: T; usage: { input_tokens: number; output_tokens: number; cost_usd: number }; model: string };

// Robust JSON extractor: strips fences, finds the first {...} or [...] block by
// brace-matching (respecting strings/escapes), and parses it. Tolerates trailing
// text from the model after the JSON payload.
function extractJson<T>(raw: string, opts: { allowTruncated?: boolean } = {}): T {
  let s = raw.replace(/^\uFEFF/, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const startIdx = s.search(/[\{\[]/);
  if (startIdx === -1) throw new Error("No JSON found in model response");
  const open = s[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false, end = -1;
  const stack: string[] = [];
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { depth++; stack.push("}"); }
    else if (ch === "[") { depth++; stack.push("]"); }
    else if (ch === "}" || ch === "]") { depth--; stack.pop(); if (depth === 0 && ch === close) { end = i; break; } }
  }
  let candidate: string;
  if (end !== -1) {
    candidate = s.slice(startIdx, end + 1);
  } else if (opts.allowTruncated) {
    // Best-effort repair: drop trailing partial token, close open string,
    // then close remaining brackets in reverse. Handles finish_reason=length.
    let tail = s.slice(startIdx);
    if (inStr) tail += '"';
    // Trim trailing incomplete key/value like `,"foo` or `: 12`
    tail = tail.replace(/,\s*"[^"]*$/,'').replace(/,\s*[\d.\-eE+]*$/, '').replace(/:\s*[^,\}\]]*$/, ': null');
    while (stack.length) tail += stack.pop();
    candidate = tail;
  } else {
    throw new Error("Truncated JSON in model response");
  }
  try { return JSON.parse(candidate) as T; }
  catch {
    // Strip trailing commas and control chars, then retry.
    let cleaned = candidate.replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
    // Escape stray raw newlines/tabs inside string literals (common with
    // gemini-3.1-pro when a value contains a real \n). Walk the candidate and
    // only touch characters that appear inside a "..." string.
    let out = ""; let inStr2 = false; let esc2 = false;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr2) {
        if (esc2) { out += ch; esc2 = false; continue; }
        if (ch === "\\") { out += ch; esc2 = true; continue; }
        if (ch === '"') { out += ch; inStr2 = false; continue; }
        if (ch === "\n") { out += "\\n"; continue; }
        if (ch === "\r") { out += "\\r"; continue; }
        if (ch === "\t") { out += "\\t"; continue; }
        out += ch;
      } else {
        out += ch;
        if (ch === '"') inStr2 = true;
      }
    }
    return JSON.parse(out) as T;
  }
}

// ---------------------------------------------------------------------------
// Provider router
// ---------------------------------------------------------------------------
// For any `google/*` model, if GEMINI_API_KEY is set we try Google AI Studio
// direct (~30-50% cheaper). On any failure we automatically fall back to the
// Lovable Gateway path so the pipeline never stalls because of a key problem.
// The fallback is logged and each cost_log row is tagged with `provider`
// ('google_direct' | 'gateway') so savings are measurable.

import { hasGeminiDirect, geminiDirectChat } from "./gemini-direct.ts";
import { hasOpenAIDirect, openaiDirectChat } from "./openai-direct.ts";
import { logAiCost, costDb } from "./cost-log.ts";

function isGoogleModel(model: string): boolean {
  return model.startsWith("google/");
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith("openai/");
}

export async function aiJSON<T>(opts: {
  system: string; user: string; model: string; schemaHint?: string; maxTokens?: number; timeoutMs?: number;
  ebook_id?: string | null; step?: string;
}): Promise<AIResult<T>> {
  const key = Deno.env.get("LOVABLE_API_KEY");

  const stepTag = opts.step ?? "ai_json";
  const schemaSuffix = opts.schemaHint ? `\n\nJSON schema:\n${opts.schemaHint}` : "";

  // --- direct path ---
  if (isGoogleModel(opts.model) && hasGeminiDirect()) {
    try {
      const sys = opts.system + "\nRespond with valid JSON only. No markdown fences.";
      const r = await geminiDirectChat({
        system: sys,
        user: opts.user + schemaSuffix,
        model: opts.model,
        responseJson: true,
      });
      let parsed: T;
      try { parsed = JSON.parse(r.text); }
      catch { try { parsed = extractJson<T>(r.text); } catch { parsed = extractJson<T>(r.text, { allowTruncated: true }); } }
      const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
      const cost = (r.input_tokens / 1_000_000) * rate.in + (r.output_tokens / 1_000_000) * rate.out;
      logAiCost(costDb(), {
        ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
        input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        cost_usd: cost, provider: "google_direct",
      });
      return { data: parsed, usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: cost }, model: opts.model };
    } catch (e) {
      console.warn(`[ai-router] gemini-direct JSON failed, falling back to gateway: ${(e as Error).message}`);
    }
  }

  // --- openai direct path (activates when OPENAI_API_KEY is set). Also acts
  //     as cross-family fallback for google/* models whose gemini-direct call
  //     failed (typically Gemini free-tier quota exhaustion).
  const useOpenAIFallback = hasOpenAIDirect() && (isOpenAIModel(opts.model) || isGoogleModel(opts.model));
  if (useOpenAIFallback) {
    const oaModel = isOpenAIModel(opts.model)
      ? opts.model
      : (/pro/i.test(opts.model) ? "openai/gpt-4o" : "openai/gpt-4o-mini");
    try {
      const sys = opts.system + "\nRespond with valid JSON only. No markdown fences.";
      const r = await openaiDirectChat({
        system: sys,
        user: opts.user + schemaSuffix,
        model: oaModel,
        responseJson: true,
        maxTokens: opts.maxTokens,
        timeoutMs: opts.timeoutMs,
      });
      let parsed: T;
      try { parsed = JSON.parse(r.text); }
      catch { try { parsed = extractJson<T>(r.text); } catch { parsed = extractJson<T>(r.text, { allowTruncated: true }); } }
      const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
      const cost = (r.input_tokens / 1_000_000) * rate.in + (r.output_tokens / 1_000_000) * rate.out;
      logAiCost(costDb(), {
        ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
        input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        cost_usd: cost, provider: "openai_direct",
      });
      return { data: parsed, usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: cost }, model: opts.model };
    } catch (e) {
      console.warn(`[ai-router] openai-direct JSON failed, falling back to gateway: ${(e as Error).message}`);
    }
  }

  // --- gateway path ---
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  async function call(maxTokens: number) {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [
        { role: "system", content: opts.system + "\nRespond with valid JSON only. No markdown fences." },
        { role: "user", content: opts.user + schemaSuffix },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    };
    const controller = opts.timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort("ai_json_timeout"), opts.timeoutMs) : null;
    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI gateway ${res.status}: ${text.slice(0, 500)}`);
    }
    return await res.json();
  }

  const initial = opts.maxTokens ?? 8192;
  let j = await call(initial);
  let finish: string = j.choices?.[0]?.finish_reason ?? "stop";
  let text: string = j.choices?.[0]?.message?.content ?? "{}";
  if (finish === "length" && initial < 16000) {
    try {
      const j2 = await call(Math.min(initial * 2, 16000));
      finish = j2.choices?.[0]?.finish_reason ?? finish;
      text = j2.choices?.[0]?.message?.content ?? text;
      j = j2;
    } catch { /* keep first response */ }
  }
  const usage = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
  const cost = (usage.prompt_tokens / 1_000_000) * rate.in + (usage.completion_tokens / 1_000_000) * rate.out;
  let parsed: T;
  try { parsed = JSON.parse(text); }
  catch {
    try { parsed = extractJson<T>(text); }
    catch { parsed = extractJson<T>(text, { allowTruncated: true }); }
  }
  logAiCost(costDb(), {
    ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
    input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens,
    cost_usd: cost, provider: "gateway",
  });
  return {
    data: parsed,
    usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, cost_usd: cost },
    model: opts.model,
  };
}

export async function aiText(opts: {
  system: string; user: string; model: string; maxTokens?: number; timeoutMs?: number;
  ebook_id?: string | null; step?: string;
}): Promise<AIResult<string>> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const stepTag = opts.step ?? "ai_text";

  if (isGoogleModel(opts.model) && hasGeminiDirect()) {
    try {
      const r = await geminiDirectChat({ system: opts.system, user: opts.user, model: opts.model });
      const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
      const cost = (r.input_tokens / 1_000_000) * rate.in + (r.output_tokens / 1_000_000) * rate.out;
      logAiCost(costDb(), {
        ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
        input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        cost_usd: cost, provider: "google_direct",
      });
      return { data: r.text, usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: cost }, model: opts.model };
    } catch (e) {
      console.warn(`[ai-router] gemini-direct text failed, falling back to gateway: ${(e as Error).message}`);
    }
  }

  // --- openai direct path (activates when OPENAI_API_KEY is set). Also
  //     cross-family fallback for google/* whose gemini-direct call failed.
  const useOpenAIFallbackText = hasOpenAIDirect() && (isOpenAIModel(opts.model) || isGoogleModel(opts.model));
  if (useOpenAIFallbackText) {
    const oaModel = isOpenAIModel(opts.model)
      ? opts.model
      : (/pro/i.test(opts.model) ? "openai/gpt-4o" : "openai/gpt-4o-mini");
    try {
      const r = await openaiDirectChat({
        system: opts.system, user: opts.user, model: oaModel,
        maxTokens: opts.maxTokens, timeoutMs: opts.timeoutMs,
      });
      const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
      const cost = (r.input_tokens / 1_000_000) * rate.in + (r.output_tokens / 1_000_000) * rate.out;
      logAiCost(costDb(), {
        ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
        input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        cost_usd: cost, provider: "openai_direct",
      });
      return { data: r.text, usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: cost }, model: opts.model };
    } catch (e) {
      console.warn(`[ai-router] openai-direct text failed, falling back to gateway: ${(e as Error).message}`);
    }
  }

  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const controller = opts.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort("ai_text_timeout"), opts.timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "";
  const usage = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
  const cost = (usage.prompt_tokens / 1_000_000) * rate.in + (usage.completion_tokens / 1_000_000) * rate.out;
  logAiCost(costDb(), {
    ebook_id: opts.ebook_id ?? null, step: stepTag, model: opts.model,
    input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens,
    cost_usd: cost, provider: "gateway",
  });
  return {
    data: text,
    usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, cost_usd: cost },
    model: opts.model,
  };
}

export async function logCost(db: ReturnType<typeof admin>, row: {
  ebook_id?: string | null; idea_id?: string | null; step: string;
  model: string; input_tokens: number; output_tokens: number; cost_usd: number;
  provider?: string | null;
}) {
  await db.from("cost_log").insert(row);
}

export async function requireAdmin(req: Request) {
  // TEMP BYPASS (user requested) — when ADMIN_AUTH_BYPASS=1, skip all auth checks.
  if (Deno.env.get("ADMIN_AUTH_BYPASS") === "1") {
    return { id: "bypass-admin", email: "bypass@autopilot" } as { id: string; email: string };
  }
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Not authenticated");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && auth === `Bearer ${serviceKey}`) {
    return { id: "service-role", email: "service@autopilot" } as { id: string; email: string };
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: u } = await db.auth.getUser();
  if (!u?.user) throw new Error("Not authenticated");
  const a = admin();
  const { data: role } = await a.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) throw new Error("Not authorized (admin only)");
  return u.user;
}
