// Coloring V2 pipeline state helpers.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import "../gateway-guard.ts";

declare const Deno: any;

export const SB_URL = Deno.env.get("SUPABASE_URL")!;
export const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function db() {
  return createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
}

export const STAGES = [
  "queued", "concept", "style_bible", "page_plan",
  "interior_render", "cover", "qc", "pdf", "publish", "failed",
] as const;
export type Stage = typeof STAGES[number];

export async function advance(bookId: string, from: Stage, to: Stage, patch: Record<string, unknown> = {}) {
  const c = db();
  const { data, error } = await c.rpc("coloring_v2_advance_stage", {
    p_book: bookId, p_from: from, p_to: to, p_patch: patch,
  });
  if (error) throw error;
  return data === true;
}

export async function recordError(bookId: string, stage: Stage, err: unknown) {
  // Serialize Error, PostgrestError, plain-object payloads, and strings alike.
  let msg: string;
  if (err instanceof Error) msg = err.message;
  else if (err && typeof err === "object") {
    const e = err as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    msg = String(e.message ?? e.error ?? e.details ?? e.hint ?? "");
    if (!msg || msg === "[object Object]") {
      try { msg = JSON.stringify(err).slice(0, 780); } catch { msg = "unserializable_error"; }
    }
    if (e.code) msg = `[${String(e.code)}] ${msg}`;
  } else msg = String(err);
  try {
    await db().rpc("coloring_v2_record_error", { p_book: bookId, p_stage: stage, p_error: msg });
  } catch { /* best-effort */ }
  return msg;
}

export async function fetchBook(bookId: string) {
  const c = db();
  const { data, error } = await c.from("coloring_v2_books").select("*").eq("id", bookId).single();
  if (error) throw error;
  return data;
}

export async function fireStage(next: string, body: Record<string, unknown>) {
  try {
    await fetch(`${SB_URL}/functions/v1/${next}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
        apikey: SB_KEY,
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch { /* best-effort */ }
}

export async function callAiJson(prompt: string, system: string, model = "google/gemini-2.0-flash"): Promise<any> {
  // Owner directive (2026-07-20): BYPASS_LOVABLE_GATEWAY forces every LLM
  // call in the coloring-v2 lane through google_direct so the gateway 403
  // (workspace credit limit) can never stall page_plan / concept / style_bible.
  const bypass = (Deno.env.get("BYPASS_LOVABLE_GATEWAY") ?? "").match(/^(1|true|yes)$/i);
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  const parseOrThrow = (content: string) => {
    if (!content) throw new Error(`ai_response empty content`);
    try { return JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error(`ai_response non-json: ${content.slice(0, 300)}`);
    }
  };

  if (bypass || geminiKey) {
    if (!geminiKey) throw new Error("GEMINI_API_KEY missing (BYPASS_LOVABLE_GATEWAY=1 requires direct provider)");
    const { geminiDirectChat } = await import("../gemini-direct.ts");
    // Normalize gateway-style ids; force flash tier for cost.
    const directModel = model.replace(/^google\//, "").replace("gemini-2.5-pro", "gemini-2.5-flash");
    const out = await geminiDirectChat({ system, user: prompt, model: directModel, responseJson: true });
    return parseOrThrow(out.text);
  }

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`ai_gateway ${res.status}: ${txt.slice(0, 400)}`);
  const j = JSON.parse(txt);
  return parseOrThrow(j?.choices?.[0]?.message?.content ?? "");
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export async function uploadAsset(
  bookId: string,
  kind: string,
  bytes: Uint8Array,
  ext: string,
  meta: Record<string, unknown> = {},
  pageNumber: number | null = null,
): Promise<{ id: string; storage_path: string; sha256: string }> {
  const c = db();
  const sha = await sha256Hex(bytes);
  const path = `${bookId}/${kind}${pageNumber != null ? `-p${String(pageNumber).padStart(3, "0")}` : ""}-${sha.slice(0, 12)}.${ext}`;
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "png" ? "image/png"
    : ext === "pdf" ? "application/pdf"
    : "application/octet-stream";
  const { error: upErr } = await c.storage.from("coloring-v2").upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) throw upErr;
  const { data, error } = await c.from("coloring_v2_assets").insert({
    book_id: bookId,
    page_number: pageNumber,
    kind,
    storage_path: path,
    mime,
    sha256: sha,
    meta,
  }).select("id, storage_path, sha256").single();
  if (error) throw error;
  return data as any;
}

export async function signedUrl(storagePath: string, seconds = 3600): Promise<string> {
  const c = db();
  const { data, error } = await c.storage.from("coloring-v2").createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
