// royalty-admin-simulate-complete — ADMIN ONLY.
// Convert a `reserved` quote into an actual holding without any real
// payment. Decrements market treasury and writes/updates royalty_holdings.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'auth required' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ ok: false, error: 'auth required' }, 401);

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleRow) return json({ ok: false, error: 'admin_required' }, 403);

    const { quote_id } = await req.json() as { quote_id?: string };
    if (!quote_id) return json({ ok: false, error: 'quote_id required' }, 400);

    const { data: quote } = await admin
      .from('royalty_purchase_quotes')
      .select('*')
      .eq('id', quote_id)
      .maybeSingle();
    if (!quote) return json({ ok: false, error: 'quote_not_found' }, 404);
    if (!['reserved', 'quoted', 'awaiting_payment'].includes(quote.status)) {
      return json({ ok: false, error: `cannot_complete_status_${quote.status}` }, 400);
    }

    const { data: market } = await admin
      .from('book_royalty_markets')
      .select('*')
      .eq('book_id', quote.book_id)
      .maybeSingle();
    if (!market) return json({ ok: false, error: 'market_not_found' }, 404);
    if (Number(market.units_available) < Number(quote.units)) {
      return json({ ok: false, error: 'insufficient_supply' }, 400);
    }

    // Upsert holding
    const { data: existing } = await admin
      .from('royalty_holdings')
      .select('*')
      .eq('user_id', quote.user_id)
      .eq('book_id', quote.book_id)
      .maybeSingle();

    if (existing) {
      const newUnits = Number(existing.units_owned) + Number(quote.units);
      const newInvested = Number(existing.subtotal_invested_usd) + Number(quote.subtotal_usd);
      const newVat = Number(existing.total_vat_usd) + Number(quote.vat_usd);
      const newFee = Number(existing.total_gateway_fee_usd) + Number(quote.gateway_fee_usd);
      const newPaid = Number(existing.total_paid_usd) + Number(quote.total_payment_usd);
      const avgCost = newInvested / newUnits;
      const ownershipPct = (newUnits / Number(market.total_units)) * 100;
      await admin.from('royalty_holdings').update({
        units_owned: newUnits,
        ownership_percentage: ownershipPct,
        average_unit_cost: avgCost,
        subtotal_invested_usd: newInvested,
        total_vat_usd: newVat,
        total_gateway_fee_usd: newFee,
        total_paid_usd: newPaid,
      }).eq('id', existing.id);
    } else {
      const ownershipPct = (Number(quote.units) / Number(market.total_units)) * 100;
      await admin.from('royalty_holdings').insert({
        user_id: quote.user_id,
        book_id: quote.book_id,
        units_owned: quote.units,
        ownership_percentage: ownershipPct,
        average_unit_cost: quote.unit_price,
        subtotal_invested_usd: quote.subtotal_usd,
        total_vat_usd: quote.vat_usd,
        total_gateway_fee_usd: quote.gateway_fee_usd,
        total_paid_usd: quote.total_payment_usd,
      });
    }

    await admin.from('book_royalty_markets').update({
      units_available: Number(market.units_available) - Number(quote.units),
    }).eq('id', market.id);

    await admin.from('royalty_purchase_quotes').update({
      status: 'simulated_completed',
    }).eq('id', quote_id);

    return json({ ok: true, quote_id, holding_user: quote.user_id, units: quote.units, note: 'Simulated completion — no real funds moved.' });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
