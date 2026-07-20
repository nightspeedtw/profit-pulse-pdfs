// Royalty accrual engine. Idempotent per order_id.
// Callable by admins only. Hard-blocked when platform_settings.royalty_live = false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  order_id: string;
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "unauthorized" }, 401);
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.order_id) return json({ error: "order_id required" }, 400);

    // Kill switch
    const { data: settings } = await admin
      .from("platform_settings")
      .select("royalty_live")
      .limit(1)
      .maybeSingle();
    const live = settings?.royalty_live === true;
    if (!live) {
      return json({ skipped: true, reason: "royalty_live=false" }, 200);
    }

    // Idempotency: any ledger rows for this source already?
    const { count: existing } = await admin
      .from("roy_ledger")
      .select("entry_id", { count: "exact", head: true })
      .eq("source", "order")
      .eq("source_ref", body.order_id);
    if ((existing ?? 0) > 0) {
      return json({ idempotent_noop: true, existing_entries: existing }, 200);
    }

    // Load order + line items
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("*")
      .eq("id", body.order_id)
      .maybeSingle();
    if (orderErr || !order) return json({ error: "order not found" }, 404);

    const { data: items } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", body.order_id);
    if (!items || items.length === 0) {
      return json({ skipped: true, reason: "no line items" }, 200);
    }

    const results: any[] = [];
    const txnId = crypto.randomUUID();

    for (const item of items) {
      // Match product to a roy_book_config; product_kind mapping: assume item.product_kind + item.product_id
      const productKind = (item as any).product_kind ?? "kids";
      const productId = (item as any).product_id;
      if (!productId) continue;

      const bookKind =
        productKind === "coloring_v2" || productKind === "coloring"
          ? "coloring_v2"
          : productKind === "adult"
          ? "adult"
          : "kids";

      const { data: cfg } = await admin
        .from("roy_book_config")
        .select("*")
        .eq("book_id", productId)
        .eq("book_kind", bookKind)
        .eq("enabled", true)
        .maybeSingle();
      if (!cfg) continue;

      const gross = Number((item as any).amount_cents ?? 0);
      const fees = Number((item as any).fees_cents ?? 0);
      const refunds = Number((item as any).refunds_cents ?? 0);
      const netRevenue = Math.max(0, gross - fees - refunds);
      const poolAmount = Math.floor(netRevenue * Number(cfg.royalty_pct_of_net));
      if (poolAmount <= 0) continue;

      // Load holdings for distribution
      const { data: holdings } = await admin
        .from("roy_holdings")
        .select("user_id, shares")
        .eq("book_id", productId)
        .eq("book_kind", bookKind)
        .gt("shares", 0);

      const totalShares = Number(cfg.total_shares);
      const holderShares = (holdings ?? []).reduce((a, h) => a + Number(h.shares), 0);
      const reserveShares = Number(cfg.reserve_shares);
      // Reserve = configured reserve + unissued shares
      const effectiveReserve = Math.max(0, totalShares - holderShares);

      if (body.dry_run) {
        results.push({
          product_id: productId,
          book_kind: bookKind,
          net_revenue: netRevenue,
          pool_amount: poolAmount,
          holders: holdings?.length ?? 0,
          effective_reserve: effectiveReserve,
        });
        continue;
      }

      const rows: any[] = [];
      // Credit pool_income (income to the pool)
      rows.push({
        txn_id: txnId,
        account_type: "pool_income",
        user_id: null,
        book_id: productId,
        book_kind: bookKind,
        direction: "credit",
        amount_cents: poolAmount,
        source: "order",
        source_ref: body.order_id,
        memo: `pool from order ${body.order_id}`,
      });

      let distributed = 0;
      for (const h of holdings ?? []) {
        const share = Math.floor((poolAmount * Number(h.shares)) / totalShares);
        if (share <= 0) continue;
        distributed += share;
        rows.push({
          txn_id: txnId,
          account_type: "shareholder_accrued",
          user_id: h.user_id,
          book_id: productId,
          book_kind: bookKind,
          direction: "debit",
          amount_cents: share,
          source: "order",
          source_ref: body.order_id,
          memo: `accrual from order ${body.order_id}`,
        });
      }
      const reserveAmount = poolAmount - distributed;
      if (reserveAmount > 0) {
        rows.push({
          txn_id: txnId,
          account_type: "platform_reserve",
          user_id: null,
          book_id: productId,
          book_kind: bookKind,
          direction: "debit",
          amount_cents: reserveAmount,
          source: "order",
          source_ref: body.order_id,
          memo: `reserve residual (${effectiveReserve} unissued shares)`,
        });
      }

      const { error: ledgerErr } = await admin.from("roy_ledger").insert(rows);
      if (ledgerErr) throw ledgerErr;

      // Refresh summary for each holder
      for (const h of holdings ?? []) {
        const share = Math.floor((poolAmount * Number(h.shares)) / totalShares);
        if (share <= 0) continue;
        const { data: existingSum } = await admin
          .from("roy_accrual_summary")
          .select("id, accrued_cents")
          .eq("user_id", h.user_id)
          .eq("book_id", productId)
          .eq("book_kind", bookKind)
          .maybeSingle();
        if (existingSum) {
          await admin
            .from("roy_accrual_summary")
            .update({
              accrued_cents: Number(existingSum.accrued_cents) + share,
              shares: Number(h.shares),
            })
            .eq("id", existingSum.id);
        } else {
          await admin.from("roy_accrual_summary").insert({
            user_id: h.user_id,
            book_id: productId,
            book_kind: bookKind,
            shares: Number(h.shares),
            accrued_cents: share,
          });
        }
      }

      results.push({
        product_id: productId,
        book_kind: bookKind,
        net_revenue: netRevenue,
        pool_amount: poolAmount,
        distributed,
        reserve_residual: reserveAmount,
        holders: holdings?.length ?? 0,
      });
    }

    return json({ ok: true, txn_id: txnId, results }, 200);
  } catch (e) {
    console.error("[royalty-accrue-order] error", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
