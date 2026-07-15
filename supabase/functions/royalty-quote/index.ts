// royalty-quote — validate + compute a fresh quote from DB, write a
// `royalty_purchase_quotes` row (status='quoted', 15-min expiry). Never
// trusts client-supplied unit price, VAT/fee rates, or totals.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeQuote, type MarketRow } from '../_shared/royalty-math.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'auth required' }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await db.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ ok: false, error: 'auth required' }, 401);

    const body = await req.json() as {
      book_id?: string;
      amount_usd?: number;
      units?: number;
    };
    if (!body.book_id) return json({ ok: false, error: 'book_id required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: market, error: mErr } = await admin
      .from('book_royalty_markets')
      .select('*')
      .eq('book_id', body.book_id)
      .maybeSingle();
    if (mErr) return json({ ok: false, error: mErr.message }, 500);
    if (!market) return json({ ok: false, error: 'book not listed for royalty' }, 404);
    if (market.status !== 'active') return json({ ok: false, error: 'market_inactive' }, 400);

    const marketRow: MarketRow = {
      total_units: Number(market.total_units),
      units_available: Number(market.units_available),
      current_indicative_unit_price_usd: Number(market.current_indicative_unit_price_usd),
      royalty_pool_percent: Number(market.royalty_pool_percent),
      minimum_purchase_usd: Number(market.minimum_purchase_usd),
      thai_vat_rate: Number(market.thai_vat_rate),
      gateway_fee_rate: Number(market.gateway_fee_rate),
      sales_vat_rate: Number(market.sales_vat_rate),
      sales_gateway_fee_rate: Number(market.sales_gateway_fee_rate),
      book_sale_price_usd: Number(market.book_sale_price_usd),
      valuation_multiple: Number(market.valuation_multiple),
      initial_book_value_usd: Number(market.initial_book_value_usd),
      max_daily_value_change: Number(market.max_daily_value_change),
    };

    const q = computeQuote({
      market: marketRow,
      requested_usd: body.amount_usd ?? null,
      requested_units: body.units ?? null,
    });
    if (!q.ok) return json({ ok: false, error: q.code, message: q.message, details: q }, 400);

    const { data: quoteRow, error: qErr } = await admin
      .from('royalty_purchase_quotes')
      .insert({
        user_id: user.id,
        book_id: body.book_id,
        requested_usd: body.amount_usd ?? null,
        unit_price: q.unit_price,
        units: q.units,
        ownership_percentage: q.ownership_percentage,
        subtotal_usd: q.subtotal_usd,
        vat_usd: q.vat_usd,
        gateway_fee_usd: q.gateway_fee_usd,
        total_payment_usd: q.total_payment_usd,
        estimated_royalty_per_sale: q.estimated_royalty_per_sale,
        estimated_break_even_sales_subtotal: q.estimated_break_even_sales_subtotal,
        estimated_break_even_sales_total: q.estimated_break_even_sales_total,
        status: 'quoted',
      })
      .select()
      .single();
    if (qErr) return json({ ok: false, error: qErr.message }, 500);

    return json({ ok: true, quote: quoteRow, computed: q, market: { units_available: market.units_available, unit_price: market.current_indicative_unit_price_usd, royalty_pool_percent: market.royalty_pool_percent } });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
