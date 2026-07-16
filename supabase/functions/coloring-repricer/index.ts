// coloring-repricer — daily popularity-based repricer for LIVE coloring
// books. Owner pricing law RULE 2: popular books become the MOST expensive.
// Per category: top 10% popularity → base +40%, top 25% → +20%, else base.
// Ceiling $12.99, floor = base. Never reprices more than once per book/day.
//
// Popularity signal today = purchases (kids_download_grants rows) over the
// configured lookback window. Weights + lookback + tier cutoffs are all
// configurable at generation_settings.coloring_autopilot.pricing.
//
// Invoked by the existing coloring-autopilot-tick 5-min cron (once per UTC
// day) or manually with the admin passcode. Idempotent same-day.

// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_PRICING_CONFIG,
  assignTiersForCategory,
  canReprice,
  computePrice,
  type PricingConfig,
  type PopularitySignal,
} from "../_shared/coloring/pricing.ts";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};
const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const startedAt = new Date();
  const result: Record<string, unknown> = { tick_at: startedAt.toISOString(), repriced: [], skipped: [] };

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* cron */ }
    const manual = !!body.manual;
    if (manual) {
      const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
      if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);
    }

    const { data: gs } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg: PricingConfig = {
      ...DEFAULT_PRICING_CONFIG,
      ...(((gs?.coloring_autopilot as any)?.pricing) ?? {}),
    };
    result.config = cfg;

    // Load every LIVE coloring book.
    const { data: books, error } = await db.from("ebooks_kids")
      .select("id, price_cents, storefront_meta, metadata")
      .eq("book_type", "coloring_book")
      .eq("listing_status", "live");
    if (error) throw error;
    result.candidate_count = books?.length ?? 0;
    if (!books || books.length === 0) return json(result);

    // Popularity signals over lookback window:
    //   - purchases: kids_download_grants rows (the strongest, ×10 weight)
    //   - views:     coloring_book_events.view_product
    //   - previews:  coloring_book_events.open_preview + preview_page_turn
    // Event names MUST match src/lib/coloringFunnelEvents.ts.
    const since = new Date(startedAt.getTime() - cfg.popularity.lookback_days * 86_400_000).toISOString();
    const bookIds = books.map((b: any) => b.id);
    const [{ data: grants }, { data: events }] = await Promise.all([
      db.from("kids_download_grants")
        .select("ebook_kids_id, created_at")
        .in("ebook_kids_id", bookIds)
        .gte("created_at", since),
      db.from("coloring_book_events")
        .select("ebook_kids_id, event_type, session_id")
        .in("ebook_kids_id", bookIds)
        .gte("created_at", since),
    ]);
    const purchases = new Map<string, number>();
    for (const g of grants ?? []) {
      const id = (g as any).ebook_kids_id;
      purchases.set(id, (purchases.get(id) ?? 0) + 1);
    }
    const views = new Map<string, number>();
    const previews = new Map<string, number>();
    for (const e of events ?? []) {
      const id = (e as any).ebook_kids_id;
      const t = (e as any).event_type as string;
      if (t === "view_product") views.set(id, (views.get(id) ?? 0) + 1);
      else if (t === "open_preview" || t === "preview_page_turn") previews.set(id, (previews.get(id) ?? 0) + 1);
      // click_buy: reserved — kids_download_grants is the authoritative purchase signal.
    }

    // Group by category_key.
    const byCat = new Map<string, PopularitySignal[]>();
    const bookMeta = new Map<string, any>();
    for (const b of books) {
      const catKey = ((b as any).storefront_meta?.category_key
        ?? (b as any).metadata?.coloring_category_key
        ?? "_uncategorized") as string;
      bookMeta.set(b.id, { catKey, row: b });
      const arr = byCat.get(catKey) ?? [];
      arr.push({
        book_id: b.id,
        category_key: catKey,
        views: views.get(b.id) ?? 0,
        previews: previews.get(b.id) ?? 0,
        purchases: purchases.get(b.id) ?? 0,
      });
      byCat.set(catKey, arr);
    }

    // Assign tiers per category.
    const tierByBook = new Map<string, "top10" | "top25" | "base">();
    for (const [, sigs] of byCat) {
      const tiers = assignTiersForCategory(sigs, cfg);
      for (const [id, t] of tiers) tierByBook.set(id, t);
    }

    // Apply.
    for (const b of books) {
      const meta = bookMeta.get(b.id);
      const priorPricing = (b as any).storefront_meta?.pricing ?? null;
      const lastAt = priorPricing?.computed_at ?? null;
      if (!canReprice(lastAt, cfg, startedAt)) {
        (result.skipped as any[]).push({ id: b.id, reason: "cooldown", last_computed_at: lastAt });
        continue;
      }
      // Checkout-in-progress guard: skip if metadata flags an active checkout.
      if ((b as any).metadata?.checkout_in_progress === true) {
        (result.skipped as any[]).push({ id: b.id, reason: "checkout_in_progress" });
        continue;
      }
      const pageCount = Number(
        (b as any).storefront_meta?.page_count
          ?? (b as any).metadata?.coloring_page_plan?.plan?.length
          ?? 32,
      );
      const tier = tierByBook.get(b.id) ?? "base";
      const breakdown = computePrice({ pageCount, tier, cfg, now: () => startedAt });
      const oldPrice = Number((b as any).price_cents ?? 0);
      if (oldPrice === breakdown.price_cents && priorPricing?.popularity_tier === tier) {
        (result.skipped as any[]).push({ id: b.id, reason: "unchanged", price_cents: oldPrice });
        continue;
      }
      const priorHistory = (priorPricing?.price_history ?? []) as any[];
      const nextHistory = oldPrice > 0
        ? [...priorHistory, { price_cents: oldPrice, at: startedAt.toISOString(), reason: "repricer" }].slice(-50)
        : priorHistory;
      const nextStorefront = {
        ...((b as any).storefront_meta ?? {}),
        pricing: {
          ...breakdown,
          source: "owner_pricing_law_v1",
          price_history: nextHistory,
        },
      };
      const { error: upErr } = await db.from("ebooks_kids").update({
        price_cents: breakdown.price_cents,
        storefront_meta: nextStorefront,
      }).eq("id", b.id);
      if (upErr) {
        (result.skipped as any[]).push({ id: b.id, reason: "update_failed", error: upErr.message });
        continue;
      }
      (result.repriced as any[]).push({
        id: b.id,
        category_key: meta.catKey,
        tier,
        old_price_cents: oldPrice,
        new_price_cents: breakdown.price_cents,
        page_count: pageCount,
      });
    }

    // Persist last-run telemetry.
    const priorAutopilot = (gs as any)?.coloring_autopilot ?? {};
    await db.from("generation_settings").update({
      coloring_autopilot: {
        ...priorAutopilot,
        pricing: {
          ...(priorAutopilot.pricing ?? {}),
          last_repricer_run_at: startedAt.toISOString(),
          last_repricer_summary: {
            repriced: (result.repriced as any[]).length,
            skipped: (result.skipped as any[]).length,
          },
        },
      },
    }).eq("id", 1);

    return json(result);
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    return json(result, 500);
  }
});
