// marketing-campaign-runner — state machine for `campaigns`.
//
// Every tick:
//   1. Flips `scheduled` → `live` when starts_at <= now.
//      • Materializes campaign_products for every eligible ebook_kids/coloring
//        book in scope (uses audience_age_bands + audience_book_types).
//      • Writes campaign_price_cents to product_pricing (floor $5) so the
//        pricing-resolver picks it up. Sets active_campaign_id + valid_from/to.
//      • Records price_history 'campaign' rows.
//   2. Flips `live` → `ended` when ends_at <= now.
//      • Restores product_pricing rows to regular_price_cents, clears
//        active_campaign_id. Records price_history 'restore' rows.
//
// Idempotent — safe to invoke every 5 minutes.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

// Owner directive: allow deep discounts landing final price in the $2–$5 range.
// Absolute floor is $2 (200¢); campaigns may set their own floor above this.
const MIN_PRICE_CENTS = 200;

interface Campaign {
  id: string;
  slug: string;
  status: string;
  starts_at: string;
  ends_at: string;
  discount_pct: number;
  min_price_floor_cents: number;
  audience_age_bands: string[];
  audience_book_types: string[];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const now = new Date();
  const activated: string[] = [];
  const ended: string[] = [];
  const errors: string[] = [];

  // -------------------------------- activate --------------------------------
  const { data: toActivate } = await db
    .from("campaigns")
    .select("*")
    .eq("status", "scheduled")
    .lte("starts_at", now.toISOString())
    .gt("ends_at", now.toISOString());

  for (const c of ((toActivate ?? []) as Campaign[])) {
    try {
      await activateCampaign(db, c);
      activated.push(c.slug);
    } catch (e) {
      errors.push(`activate:${c.slug}:${(e as Error).message}`);
    }
  }

  // ---------------------------------- end -----------------------------------
  const { data: toEnd } = await db
    .from("campaigns")
    .select("*")
    .eq("status", "live")
    .lte("ends_at", now.toISOString());

  for (const c of ((toEnd ?? []) as Campaign[])) {
    try {
      await endCampaign(db, c);
      ended.push(c.slug);
    } catch (e) {
      errors.push(`end:${c.slug}:${(e as Error).message}`);
    }
  }

  // ------------------------------- reprice ----------------------------------
  // Owner tool: `?reprice=all` re-runs the price anchor snapping for every
  // currently-live campaign so recent pricing-law changes propagate without
  // waiting for a new campaign activation.
  const repriced: string[] = [];
  const reqUrl = new URL(req.url);
  if (reqUrl.searchParams.get("reprice") === "all") {
    const { data: live } = await db
      .from("campaigns")
      .select("*")
      .eq("status", "live");
    for (const c of ((live ?? []) as Campaign[])) {
      try {
        await activateCampaign(db, c);
        repriced.push(c.slug);
      } catch (e) {
        errors.push(`reprice:${c.slug}:${(e as Error).message}`);
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      tick_at: now.toISOString(),
      activated,
      ended,
      repriced,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

async function activateCampaign(db: any, c: Campaign) {
  // 1) Discover eligible ebook_kids rows in scope.
  let q = db
    .from("ebooks_kids")
    .select("id, book_type, age_min, age_max, price_cents")
    .eq("listing_status", "live");
  if (c.audience_book_types && c.audience_book_types.length > 0) {
    q = q.in("book_type", c.audience_book_types);
  }
  const { data: books, error } = await q;
  if (error) throw error;

  const eligible = (books ?? []).filter((b: any) => {
    if (!c.audience_age_bands || c.audience_age_bands.length === 0) return true;
    // Match if the book's age range overlaps any listed band. Bands are freeform
    // strings like '0-3', '4-6', '5-7' etc.
    const bookBand = `${b.age_min ?? ""}-${b.age_max ?? ""}`;
    return c.audience_age_bands.includes(bookBand);
  });

  // 2) For each book, upsert product_pricing with the campaign price.
  for (const b of eligible) {
    const { data: pp } = await db
      .from("product_pricing")
      .select("regular_price_cents")
      .eq("product_kind", "ebook_kids")
      .eq("product_id", b.id)
      .eq("market", "US")
      .maybeSingle();

    const regular = Math.max(
      MIN_PRICE_CENTS,
      Number(pp?.regular_price_cents ?? b.price_cents ?? 999),
    );
    // Owner law: storefront prices must look natural and varied — not all the
    // same $2 or $5. Snap each product's discounted price to a psychological
    // charm-price anchor between $1.99 and $9.99. The choice is deterministic
    // per (campaign, product) so prices stay stable across ticks but differ
    // between neighbouring SKUs.
    const PRICE_ANCHORS_CENTS = [
      199, 249, 279, 299, 349, 379, 399, 449, 479, 499,
      549, 579, 599, 649, 679, 699, 749, 799, 849, 899, 949, 999,
    ];
    const seed = `${c.id}:${b.id}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const floor = Math.max(MIN_PRICE_CENTS, c.min_price_floor_cents || MIN_PRICE_CENTS);
    // Target discount 40–75% off, then snap to nearest usable anchor.
    const targetPct = 40 + (h % 36);
    const rawTarget = Math.round(regular * (1 - targetPct / 100));
    const usable = PRICE_ANCHORS_CENTS.filter((a) => a >= floor && a < regular);
    if (usable.length === 0) continue;
    let campaignPrice = usable.reduce(
      (best, a) => (Math.abs(a - rawTarget) < Math.abs(best - rawTarget) ? a : best),
      usable[0],
    );
    // 30% of products take a wobble anchor so neighbours don't collide on the
    // same price point.
    if ((h >>> 11) % 10 < 3) {
      campaignPrice = usable[(h >>> 5) % usable.length];
    }
    if (campaignPrice >= regular) continue;

    const validFrom = c.starts_at;
    const validTo = c.ends_at;

    await db
      .from("product_pricing")
      .upsert(
        {
          product_kind: "ebook_kids",
          product_id: b.id,
          market: "US",
          regular_price_cents: regular,
          campaign_price_cents: campaignPrice,
          effective_price_cents: campaignPrice,
          active_campaign_id: c.id,
          campaign_valid_from: validFrom,
          campaign_valid_to: validTo,
        },
        { onConflict: "product_kind,product_id,market" },
      );

    // Preflight compare-at legitimacy — regular must have been active >=30 days
    const { data: legit } = await db.rpc("is_compare_at_price_legitimate", {
      p_product_kind: "ebook_kids",
      p_product_id: b.id,
      p_market: "US",
      p_compare_at_cents: regular,
      p_campaign_start_at: validFrom,
      p_min_days: 30,
    });

    await db.from("campaign_products").upsert(
      {
        campaign_id: c.id,
        product_kind: "ebook_kids",
        product_id: b.id,
        market: "US",
        campaign_price_cents: campaignPrice,
        compare_at_cents: legit === true ? regular : null,
        compare_at_valid: legit === true,
      },
      { onConflict: "campaign_id,product_kind,product_id,market" },
    );

    await db.from("price_history").insert({
      product_kind: "ebook_kids",
      product_id: b.id,
      market: "US",
      price_type: "campaign",
      new_price_cents: campaignPrice,
      effective_from: validFrom,
      effective_to: validTo,
      metadata: { campaign_id: c.id, campaign_slug: c.slug },
    });
  }

  await db
    .from("campaigns")
    .update({ status: "live", activated_at: new Date().toISOString() })
    .eq("id", c.id);
}

async function endCampaign(db: any, c: Campaign) {
  const { data: rows } = await db
    .from("campaign_products")
    .select("product_kind, product_id, market")
    .eq("campaign_id", c.id);

  for (const r of rows ?? []) {
    const { data: pp } = await db
      .from("product_pricing")
      .select("regular_price_cents, active_campaign_id")
      .eq("product_kind", r.product_kind)
      .eq("product_id", r.product_id)
      .eq("market", r.market)
      .maybeSingle();
    if (!pp) continue;
    // Only restore if we still own this row (guards against a stacked campaign).
    if (pp.active_campaign_id && pp.active_campaign_id !== c.id) continue;
    const regular = Math.max(MIN_PRICE_CENTS, Number(pp.regular_price_cents ?? 999));
    await db
      .from("product_pricing")
      .update({
        campaign_price_cents: null,
        effective_price_cents: regular,
        active_campaign_id: null,
        campaign_valid_from: null,
        campaign_valid_to: null,
      })
      .eq("product_kind", r.product_kind)
      .eq("product_id", r.product_id)
      .eq("market", r.market);

    await db.from("price_history").insert({
      product_kind: r.product_kind,
      product_id: r.product_id,
      market: r.market,
      price_type: "restore",
      new_price_cents: regular,
      effective_from: new Date().toISOString(),
      metadata: { campaign_id: c.id, campaign_slug: c.slug, reason: "campaign_ended" },
    });
  }

  await db
    .from("campaigns")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", c.id);
}
