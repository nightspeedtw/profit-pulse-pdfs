// marketing-bundle-composer — composes 2-3 book bundles per age band and
// theme. Skips if the same composition is already live.
//
// Bundle price = sum(effective_price) * (1 - bundle_discount), never below
// $5 * member_count * 0.6.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const BUNDLE_DISCOUNT = 0.2; // 20% off vs individual total
const MIN_PER_BOOK_CENTS = 500;
const MIN_FLOOR_MULT = 0.6;

function hashComposition(memberIds: string[]): string {
  return memberIds.slice().sort().join("|");
}

function slug(band: string, ids: string[]) {
  return `bundle-${band}-${hashComposition(ids).slice(0, 12).replace(/[^a-z0-9]/gi, "")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const results: any[] = [];

  const { data: books, error } = await db
    .from("ebooks_kids")
    .select("id, title, book_type, age_range_min, age_range_max, price_cents, cover_url, category_slug, created_at")
    .eq("listing_status", "live")
    .eq("sellable", true)
    .not("cover_url", "is", null)
    .order("created_at", { ascending: false });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Group by (age band, book_type) — one bundle per group.
  const groups = new Map<string, any[]>();
  for (const b of books ?? []) {
    const band = `${b.age_range_min ?? "?"}-${b.age_range_max ?? "?"}`;
    const key = `${band}::${b.book_type ?? "misc"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }

  for (const [key, members] of groups.entries()) {
    if (members.length < 2) continue;
    const [band, bookType] = key.split("::");
    const picks = members.slice(0, 3); // top-3 most recent as a starter heuristic
    const ids = picks.map((p) => p.id);
    const compHash = hashComposition(ids);

    // Skip if same composition already live.
    const { data: existing } = await db
      .from("bundles")
      .select("id, status")
      .eq("composition_hash", compHash)
      .eq("status", "live")
      .maybeSingle();
    if (existing) {
      results.push({ key, skipped: "already_live" });
      continue;
    }

    // Resolve effective per-member price from product_pricing (fallback to price_cents).
    const { data: pp } = await db
      .from("product_pricing")
      .select("product_id, effective_price_cents, regular_price_cents")
      .eq("product_kind", "ebook_kids")
      .eq("market", "US")
      .in("product_id", ids);
    const priceById = new Map<string, number>();
    for (const row of pp ?? []) {
      priceById.set(row.product_id, Number(row.effective_price_cents ?? row.regular_price_cents ?? 0));
    }

    let membersTotal = 0;
    for (const p of picks) {
      const c = priceById.get(p.id) ?? Number(p.price_cents ?? 999);
      membersTotal += Math.max(MIN_PER_BOOK_CENTS, c);
    }
    const floor = Math.round(MIN_PER_BOOK_CENTS * picks.length * MIN_FLOOR_MULT);
    const bundlePrice = Math.max(floor, Math.round(membersTotal * (1 - BUNDLE_DISCOUNT)));
    const savings = membersTotal - bundlePrice;
    const savingsPct = Number(((savings / membersTotal) * 100).toFixed(2));

    // Retire prior live bundles for the same age+type (only one live at a time).
    await db
      .from("bundles")
      .update({ status: "retired", retired_at: new Date().toISOString() })
      .eq("age_band", band)
      .eq("status", "live")
      .eq("member_kind", "ebook_kids");

    const title = `${picks.length}-Book ${prettifyType(bookType)} Pack · Ages ${band}`;
    const bundleSlug = slug(band, ids);
    const { data: inserted, error: insErr } = await db
      .from("bundles")
      .insert({
        slug: bundleSlug,
        title,
        subtitle: `Save ${savingsPct}% vs buying individually`,
        age_band: band,
        theme: bookType,
        member_kind: "ebook_kids",
        member_ids: ids,
        bundle_price_cents: bundlePrice,
        members_total_cents: membersTotal,
        savings_cents: savings,
        savings_pct: savingsPct,
        status: "live",
        cover_urls: picks.map((p) => p.cover_url).filter(Boolean),
        composition_hash: compHash,
        auto_generated: true,
        activated_at: new Date().toISOString(),
        metadata: { titles: picks.map((p) => p.title) },
      })
      .select("id")
      .single();

    if (insErr) {
      results.push({ key, error: insErr.message });
      await db.from("bundle_events").insert({
        event_kind: "failed",
        detail: { key, error: insErr.message, ids },
      });
      continue;
    }

    await db.from("bundle_events").insert({
      bundle_id: inserted.id,
      event_kind: "published",
      detail: { key, ids, bundlePrice, savings },
    });
    results.push({ key, bundleId: inserted.id, ids, bundlePrice });
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function prettifyType(t: string | undefined): string {
  if (!t) return "Kids";
  return t
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
