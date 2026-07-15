// Execute a USD-amount buy from treasury at the current ref price.
// Phase 1: buy-only, no order-book resale.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) throw new Error('auth required');
    const authed = createClient(SB_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: u, error: uErr } = await authed.auth.getUser();
    if (uErr || !u?.user) throw new Error('invalid token');
    const buyer = u.user.id;

    const body = await req.json();
    const book_id: string = body.book_id;
    const amount_usd = Number(body.amount_usd);
    if (!book_id || !amount_usd || amount_usd <= 0) throw new Error('book_id + amount_usd>0 required');

    const db = createClient(SB_URL, SB_KEY);

    // Pull live settings (min, fee, tax)
    const { data: settings } = await db.from('platform_settings').select('key,value_json')
      .in('key', ['buy_min_usd', 'buy_gateway_fee_pct', 'buy_tax_pct']);
    const s: Record<string, number> = {};
    for (const r of settings ?? []) s[(r as any).key] = Number((r as any).value_json);
    const minUsd = s.buy_min_usd ?? 20;
    const feePct = s.buy_gateway_fee_pct ?? 0.05;
    const taxPct = s.buy_tax_pct ?? 0.07;

    if (amount_usd < minUsd) throw new Error(`minimum purchase is $${minUsd}`);
    if (amount_usd > 100_000) throw new Error('amount too large');

    const { data, error } = await db.rpc('exchange_buy_amount', {
      p_buyer: buyer,
      p_book: book_id,
      p_amount_gross: amount_usd,
      p_fee_pct: feePct,
      p_tax_pct: taxPct,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, result: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
