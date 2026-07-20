// marketing-calendar-sync — ensures the next 90 days of seasonal campaigns
// exist in `campaigns` (draft/scheduled) from `seasonal_calendar_seed`.
// Idempotent: re-running produces zero writes when state matches.
//
// Trigger: daily cron OR from marketing-autopilot-tick.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveSeasonAnchor } from "../_shared/marketing/us-calendar.ts";

declare const Deno: any;

const LOOKAHEAD_DAYS = 90;

interface SeedRow {
  season_key: string;
  display_name: string;
  rule_kind: "fixed_date" | "us_holiday";
  anchor_month: number | null;
  anchor_day: number | null;
  us_holiday_tag: string | null;
  lead_days: number;
  duration_days: number;
  default_discount_pct: number;
  audience_age_bands: string[];
  audience_book_types: string[];
  priority: number;
  enabled: boolean;
}

function slugify(season: string, year: number) {
  return `season-${season}-${year}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400_000);

  const { data: seeds, error: seedErr } = await db
    .from("seasonal_calendar_seed")
    .select("*")
    .eq("enabled", true);
  if (seedErr) {
    return new Response(JSON.stringify({ error: seedErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const seed of (seeds ?? []) as SeedRow[]) {
    // Consider anchors for the current and next year so cross-year seasons
    // near Jan 1 are still handled.
    for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const rule =
        seed.rule_kind === "fixed_date"
          ? { kind: "fixed_date" as const, month: seed.anchor_month!, day: seed.anchor_day! }
          : { kind: "us_holiday" as const, tag: seed.us_holiday_tag! };
      const anchor = resolveSeasonAnchor(rule, year);
      if (!anchor) continue;

      const startsAt = new Date(anchor.getTime() - seed.lead_days * 86400_000);
      const endsAt = new Date(anchor.getTime() + seed.duration_days * 86400_000);

      // Skip if the entire window is behind us or entirely beyond horizon.
      if (endsAt.getTime() < now.getTime()) continue;
      if (startsAt.getTime() > horizon.getTime()) continue;

      const slug = slugify(seed.season_key, year);
      const { data: existing } = await db.from("campaigns").select("id, status").eq("slug", slug).maybeSingle();
      if (existing) {
        skipped.push(slug);
        continue;
      }
      const initialStatus = startsAt.getTime() <= now.getTime() ? "scheduled" : "scheduled";
      const { error: insErr } = await db.from("campaigns").insert({
        slug,
        name: `${seed.display_name} ${year}`,
        kind: "seasonal",
        season_key: seed.season_key,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: initialStatus,
        discount_pct: seed.default_discount_pct,
        min_price_floor_cents: 500,
        audience_age_bands: seed.audience_age_bands ?? [],
        audience_book_types: seed.audience_book_types ?? [],
        priority: seed.priority,
        auto_generated: true,
        metadata: { source: "calendar_sync", anchor: anchor.toISOString() },
      });
      if (insErr) {
        skipped.push(`${slug}:err:${insErr.message}`);
        continue;
      }
      created.push(slug);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      horizon_days: LOOKAHEAD_DAYS,
      created_count: created.length,
      created,
      skipped_count: skipped.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
