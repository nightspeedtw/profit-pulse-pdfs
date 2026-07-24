// Coloring funnel events — the popularity signals the daily repricer consumes.
// Event names MUST stay aligned with supabase/functions/coloring-repricer.
//
// Write path: anonymous INSERT into public.coloring_book_events via the anon
// key (RLS policy `anyone can insert funnel events`). Dedupe per session using
// sessionStorage so a single pageview / preview open counts once.
import { supabase } from "@/integrations/supabase/client";

export type ColoringEventType =
  | "view_product"
  | "open_preview"
  | "preview_opened"
  | "preview_page_turn"
  | "preview_page_viewed"
  | "sample_modal_opened"
  | "sample_email_submitted"
  | "sample_downloaded"
  | "sample_to_purchase_clicked"
  | "purchase_completed"
  | "click_buy";

const SESSION_KEY = "sp_session_id";
const DEDUPE_KEY = "sp_coloring_events_dedupe";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

function loadDedupe(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DEDUPE_KEY);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch { return {}; }
}
function saveDedupe(m: Record<string, number>) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(DEDUPE_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

function dedupeKey(type: ColoringEventType, ebookId: string, extra?: Record<string, unknown>): string {
  // page_index is the only per-event dimension we allow to bypass dedupe.
  if (type === "preview_page_turn" && extra && "page_index" in extra) {
    return `${type}:${ebookId}:p${extra.page_index}`;
  }
  return `${type}:${ebookId}`;
}

export interface EmitOpts {
  extra?: Record<string, unknown>;
  /** If true, ignore the once-per-session dedupe (e.g. click_buy). */
  force?: boolean;
}

export async function emitColoringEvent(
  type: ColoringEventType,
  ebookId: string,
  opts: EmitOpts = {},
): Promise<{ ok: boolean; deduped?: boolean; error?: string }> {
  if (!ebookId) return { ok: false, error: "missing_ebook_id" };
  const key = dedupeKey(type, ebookId, opts.extra);
  const dedupe = loadDedupe();
  if (!opts.force && dedupe[key]) return { ok: true, deduped: true };
  dedupe[key] = Date.now();
  saveDedupe(dedupe);

  const session_id = getSessionId();
  const metadata = opts.extra ?? {};
  try {
    const { error } = await supabase.from("coloring_book_events" as never).insert({
      ebook_kids_id: ebookId,
      event_type: type,
      session_id,
      metadata,
    } as never);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Test-only helper — clears sessionStorage dedupe state.
export function __resetColoringEventDedupeForTests() {
  if (typeof window !== "undefined") {
    try { window.sessionStorage.removeItem(DEDUPE_KEY); } catch { /* noop */ }
  }
}
