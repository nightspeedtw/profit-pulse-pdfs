// royalty-record-book-sale — called by the purchase/download hook when
// a book sale happens. Writes an immutable ledger row and fans out
// pro-rata earnings to every current holder.
//
// Idempotent by (book_id, order_id) — a duplicate call is a no-op.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function money(n: number): number { return Math.round(n * 10000) / 10000; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const {
      book_id,
      order_id,
      sale_price_usd,
    } = await req.json() as { book_id?: string; order_id?: string; sale_price_usd?: number };

    if (!book_id || !sale_price_usd || sale_price_usd <= 0) {
      return json({ ok: false, error: 'book_id and sale_price_usd required' }, 400);
    }

    // Idempotency check
    if (order_id) {
      const { data: dup } = await admin
        .from('book_sales_ledger')
        .select('id')
        .eq('book_id', book_id)
        .eq('order_id', order_id)
        .maybeSingle();
      if (dup) return json({ ok: true, deduped: true, ledger_id: dup.id });
    }

    const { data: market } = await admin
      .from('book_royalty_markets')
      .select('*')
      .eq('book_id', book_id)
      .maybeSingle();
    if (!market) return json({ ok: false, error: 'market_not_found' }, 404);

    const vat = money(sale_price_usd * Number(market.sales_vat_rate));
    const fee = money((sale_price_usd + vat) * Number(market.sales_gateway_fee_rate));
    const net = money(sale_price_usd - vat - fee);
    const pool = money(net * Number(market.royalty_pool_percent));

    const { data: sale, error: sErr } = await admin
      .from('book_sales_ledger')
      .insert({
        book_id,
        order_id: order_id ?? null,
        sale_price_usd,
        vat_usd: vat,
        gateway_fee_usd: fee,
        net_revenue_usd: net,
        royalty_pool_usd: pool,
      })
      .select()
      .single();
    if (sErr) return json({ ok: false, error: sErr.message }, 500);

    // Fan out to holders
    const { data: holders } = await admin
      .from('royalty_holdings')
      .select('id, user_id, units_owned, ownership_percentage')
      .eq('book_id', book_id)
      .gt('units_owned', 0);

    let distributed = 0;
    for (const h of holders ?? []) {
      const ownershipPct = Number(h.ownership_percentage);
      const earning = Math.round(pool * (ownershipPct / 100) * 1000000) / 1000000;
      if (earning <= 0) continue;
      await admin.from('royalty_earnings_ledger').insert({
        user_id: h.user_id,
        book_id,
        holding_id: h.id,
        sale_ledger_id: sale.id,
        units_owned_at_sale: h.units_owned,
        ownership_percentage_at_sale: ownershipPct,
        distributable_royalty_pool_usd: pool,
        royalty_earned_usd: earning,
      });
      // Update denormalised totals on the holding.
      await admin.rpc('sql', {}).then(() => null).catch(() => null); // no-op; do updates below
      await admin.from('royalty_holdings')
        .update({
          lifetime_royalty_earned: Number((await admin.from('royalty_holdings').select('lifetime_royalty_earned').eq('id', h.id).single()).data?.lifetime_royalty_earned ?? 0) + earning,
        })
        .eq('id', h.id);
      distributed += earning;
    }

    return json({ ok: true, sale_ledger_id: sale.id, pool_usd: pool, distributed_usd: money(distributed), holders_paid: (holders ?? []).length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
