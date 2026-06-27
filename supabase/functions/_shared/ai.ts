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
function extractJson<T>(raw: string): T {
  let s = raw.replace(/^\uFEFF/, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const startIdx = s.search(/[\{\[]/);
  if (startIdx === -1) throw new Error("No JSON found in model response");
  const open = s[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Truncated JSON in model response");
  let candidate = s.slice(startIdx, end + 1);
  try { return JSON.parse(candidate) as T; }
  catch {
    candidate = candidate.replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    return JSON.parse(candidate) as T;
  }
}

export async function aiJSON<T>(opts: {
  system: string; user: string; model: string; schemaHint?: string;
}): Promise<AIResult<T>> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system + "\nRespond with valid JSON only. No markdown fences." },
      { role: "user", content: opts.user + (opts.schemaHint ? `\n\nJSON schema:\n${opts.schemaHint}` : "") },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 500)}`);
  }
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "{}";
  const usage = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
  const cost = (usage.prompt_tokens / 1_000_000) * rate.in + (usage.completion_tokens / 1_000_000) * rate.out;
  let parsed: T;
  try { parsed = JSON.parse(text); }
  catch {
    parsed = extractJson<T>(text);
  }
  return {
    data: parsed,
    usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, cost_usd: cost },
    model: opts.model,
  };
}

export async function aiText(opts: { system: string; user: string; model: string }): Promise<AIResult<string>> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "";
  const usage = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const rate = RATES[opts.model] ?? { in: 0.1, out: 0.4 };
  const cost = (usage.prompt_tokens / 1_000_000) * rate.in + (usage.completion_tokens / 1_000_000) * rate.out;
  return {
    data: text,
    usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, cost_usd: cost },
    model: opts.model,
  };
}

export async function logCost(db: ReturnType<typeof admin>, row: {
  ebook_id?: string | null; idea_id?: string | null; step: string;
  model: string; input_tokens: number; output_tokens: number; cost_usd: number;
}) {
  await db.from("cost_log").insert(row);
}

export async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Not authenticated");
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
