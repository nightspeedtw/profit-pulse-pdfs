// List a sell order for shares the user owns. Escrows shares out of holdings.
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
    const seller = u.user.id;

    const body = await req.json();
    const book_id: string = body.book_id;
    const qty = Math.floor(Number(body.qty));
    const price_per_share = Number(body.price_per_share);
    if (!book_id || !qty || qty <= 0 || !price_per_share || price_per_share <= 0)
      throw new Error('book_id + qty>0 + price_per_share>0 required');
    if (price_per_share < 0.0001) throw new Error('price too low');

    const db = createClient(SB_URL, SB_KEY);

    // Escrow: reduce holdings before creating order (atomic-ish)
    const { data: h, error: hErr } = await db.from('rights_holdings')
      .select('shares').eq('user_id', seller).eq('book_id', book_id).maybeSingle();
    if (hErr) throw hErr;
    if (!h || h.shares < qty) throw new Error('insufficient shares');

    const { error: uErr2 } = await db.from('rights_holdings')
      .update({ shares: h.shares - qty })
      .eq('user_id', seller).eq('book_id', book_id);
    if (uErr2) throw uErr2;

    const { data: order, error: oErr } = await db.from('rights_orders').insert({
      book_id, seller_id: seller, is_treasury: false,
      qty_total: qty, qty_remaining: qty, price_per_share, status: 'open',
    }).select().single();
    if (oErr) {
      // rollback escrow
      await db.from('rights_holdings').update({ shares: h.shares }).eq('user_id', seller).eq('book_id', book_id);
      throw oErr;
    }

    return new Response(JSON.stringify({ ok: true, order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
