// golden-path.ts — canonical coloring-book pipeline defaults (v1).
//
// Doctrine (2026-07-18, owner-approved): one proven template governs the
// coloring lane. Only theme/category varies per book. This module is the
// single source of truth for:
//   - category whitelist (categories with proven pass history)
//   - locked template constants (age band, page count, style contract id)
//   - two-strikes → rotate helper (never dead-end the line)
//   - "no mid-book calibration pause" flag for whitelisted categories
//
// Verified live-history whitelist (as of 2026-07-18):
//   Dinosaurs (3), Seasonal Holidays (2), Preschool and Toddler (2),
//   Sea Animals (2), Princess Fairy and Magic (1), Pets Cats and Dogs (1),
//   Unicorn Fantasy (1), Mermaid and Ocean Fantasy (1),
//   Farm and Woodland (1), Floral and Botanical (1).

export const GOLDEN_PATH_VERSION = "golden_path_coloring_v1";

/** Category keys (coloring_categories.category_key) proven to reach LIVE. */
export const GOLDEN_PATH_WHITELIST: readonly string[] = [
  "dinosaurs",
  "sea_animals",
  "farm_and_woodland",
  "pets_cats_dogs",
  "floral_botanical",
  "unicorn_fantasy",
  "princess_fairy_magic",
  "preschool_toddler",
  "seasonal_holidays",
  "mermaid_ocean_fantasy",
] as const;

export const GOLDEN_PATH_DEFAULTS = {
  age_band: "4-6" as const,
  page_count: 32 as const,
  style_contract_id: "DEFAULT_KIDS_4_6_STYLE" as const,
  interior_model: "runware:100@1" as const,     // flux schnell via failover chain
  cover_primary: "gpt_image_tier_1" as const,   // GPT Image → Ideogram fallback
  cover_max_invocations: 5 as const,
  anatomy_batch_size: 8 as const,               // one vision call per 8 pages
  qc_mode: "strict" as const,                   // golden-path books ship strict
} as const;

export const GOLDEN_PATH_MAX_GATE_STRIKES = 2;

export function isGoldenPathCategory(key: string | null | undefined): boolean {
  if (!key) return false;
  return GOLDEN_PATH_WHITELIST.includes(String(key));
}

/**
 * Two-strikes → rotate. Called when the same gate has failed
 * `GOLDEN_PATH_MAX_GATE_STRIKES` times on a book. Parks the row and
 * fire-and-forget queues a fresh whitelisted concept so the line never stalls.
 */
export async function parkAndRotate(
  db: any,
  opts: { ebook_id: string; gate: string; reasons: string[]; strikes: number },
): Promise<{ parked: boolean; queued_replacement: boolean }> {
  const now = new Date().toISOString();
  const { data: row } = await db.from("ebooks_kids")
    .select("metadata").eq("id", opts.ebook_id).maybeSingle();
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  await db.from("ebooks_kids").update({
    pipeline_status: "parked_rotated",
    blocker_reason: `two_strikes_${opts.gate}`,
    metadata: {
      ...meta,
      awaiting: null,
      focus_run: false,
      golden_path_park: {
        gate: opts.gate, reasons: opts.reasons.slice(0, 12),
        strikes: opts.strikes, at: now, version: GOLDEN_PATH_VERSION,
      },
      coloring_current_step_label: `Parked (rotate): ${opts.gate} failed x${opts.strikes}`,
    },
  }).eq("id", opts.ebook_id);
  // Queue a replacement — fire-and-forget.
  let queued = false;
  try {
    const url = (globalThis as any).Deno?.env?.get?.("SUPABASE_URL");
    const svc = (globalThis as any).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
    if (url && svc) {
      fetch(`${url}/functions/v1/coloring-autopilot-tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}`, apikey: svc },
        body: JSON.stringify({ manual: true, override_batch: 1, passcode: (globalThis as any).Deno?.env?.get?.("ADMIN_PASSCODE") ?? "453451" }),
      }).catch(() => {});
      queued = true;
    }
  } catch (_e) { /* best-effort */ }
  return { parked: true, queued_replacement: queued };
}
