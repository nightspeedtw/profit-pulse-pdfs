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

export const COLORING_V2_PRODUCTION_LOCK = "coloring_v2_one_book_production";
export const COLORING_V2_LOCK_TTL_SEC = 30 * 60;

export type ColoringV2Lock = {
  acquired: boolean;
  holder: string | null;
  expires_at: string | null;
};

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

export async function acquireColoringV2ProductionLock(bookId: string, ttlSec = COLORING_V2_LOCK_TTL_SEC): Promise<ColoringV2Lock> {
  const c = db();
  const { data, error } = await c.rpc("try_acquire_lock", {
    p_name: COLORING_V2_PRODUCTION_LOCK,
    p_holder: bookId,
    p_run_id: null,
    p_ttl_sec: ttlSec,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    acquired: row?.acquired === true,
    holder: row?.holder ?? null,
    expires_at: row?.expires_at ?? null,
  };
}

export async function readColoringV2ProductionLock(): Promise<ColoringV2Lock | null> {
  const c = db();
  const { data, error } = await c.from("production_locks")
    .select("holder_ebook_id, expires_at")
    .eq("name", COLORING_V2_PRODUCTION_LOCK)
    .maybeSingle();
  if (error) throw error;
  if (!data?.holder_ebook_id) return null;
  return {
    acquired: false,
    holder: data.holder_ebook_id,
    expires_at: data.expires_at ?? null,
  };
}

export function lockIsLive(lock: ColoringV2Lock | null): boolean {
  if (!lock?.holder || !lock.expires_at) return false;
  return new Date(lock.expires_at).getTime() > Date.now();
}

export async function requireColoringV2ProductionLock(bookId: string): Promise<ColoringV2Lock> {
  return await acquireColoringV2ProductionLock(bookId);
}

export async function releaseColoringV2ProductionLock(bookId: string): Promise<boolean> {
  const c = db();
  const { data, error } = await c.rpc("release_lock", {
    p_name: COLORING_V2_PRODUCTION_LOCK,
    p_holder: bookId,
  });
  if (error) throw error;
  return data === true;
}

export function chainOwnerMatches(bookId: string, chainOwner: unknown): boolean {
  return !chainOwner || String(chainOwner) === bookId;
}

export async function fireStage(next: string, body: Record<string, unknown>) {
  try {
    const nextBody = { ...body };
    if (nextBody.book_id && !nextBody.chain_owner_book_id) {
      nextBody.chain_owner_book_id = nextBody.book_id;
    }
    await fetch(`${SB_URL}/functions/v1/${next}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
        apikey: SB_KEY,
      },
      body: JSON.stringify(nextBody),
    }).catch(() => {});
  } catch { /* best-effort */ }
}

export function normalizeColoringV2TextModel(model: string): string {
  // 2026-07 provider churn: Gemini 2.0/2.5 Flash text endpoints now return
  // NOT_FOUND for this project. Coloring V2 text planning is low-risk JSON
  // generation, so route every retired Gemini text id to the live Flash tier.
  return model
    .replace(/^google\//, "")
    .replace(/^gemini-2\.(0|5)-(pro|flash|flash-lite)$/, "gemini-3.5-flash");
}

export async function callAiJson(prompt: string, system: string, model = "google/gemini-3.5-flash"): Promise<any> {
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
    const directModel = normalizeColoringV2TextModel(model);
    try {
      const out = await geminiDirectChat({ system, user: prompt, model: directModel, responseJson: true });
      return parseOrThrow(out.text);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      // Fall back to OpenAI direct on Gemini quota / prepay depletion / 429 / 5xx
      const shouldFallback = /429|RESOURCE_EXHAUSTED|prepayment|credits are depleted|quota|5\d\d/i.test(msg);
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!shouldFallback) throw e;
      if (openaiKey) {
        try {
          console.warn(`[callAiJson] gemini-direct failed (${msg.slice(0,120)}) — falling back to openai-direct`);
          const { openaiDirectChat } = await import("../openai-direct.ts");
          const oaiModel = /pro/i.test(model) ? "openai/gpt-4o" : "openai/gpt-4o-mini";
          const out = await openaiDirectChat({ system, user: prompt, model: oaiModel, responseJson: true });
          return parseOrThrow(out.text);
        } catch (e2) {
          const msg2 = (e2 as Error).message ?? "";
          const oaiExhausted = /429|insufficient_quota|quota|5\d\d/i.test(msg2);
          if (!oaiExhausted) throw e2;
          console.warn(`[callAiJson] openai-direct also exhausted (${msg2.slice(0,120)}) — falling back to lovable-gateway`);
          // fall through to gateway below
        }
      }
      // Last-resort: Lovable Gateway
      const key = Deno.env.get("LOVABLE_API_KEY");
      if (!key) throw e;
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`ai_gateway_fallback ${res.status}: ${txt.slice(0, 400)}`);
      const j = JSON.parse(txt);
      return parseOrThrow(j?.choices?.[0]?.message?.content ?? "");
    }
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
