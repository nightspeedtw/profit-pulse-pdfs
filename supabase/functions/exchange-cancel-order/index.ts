// Cancel an open sell order and return escrowed shares to holdings.
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
    const uid = u.user.id;

    const body = await req.json();
    const order_id: string = body.order_id;
    if (!order_id) throw new Error('order_id required');

    const db = createClient(SB_URL, SB_KEY);
    const { data: order, error } = await db.from('rights_orders')
      .select('*').eq('id', order_id).maybeSingle();
    if (error) throw error;
    if (!order) throw new Error('order not found');
    if (order.seller_id !== uid) throw new Error('not your order');
    if (order.status !== 'open') throw new Error('order not open');

    const returnQty = order.qty_remaining;

    // Mark cancelled
    await db.from('rights_orders').update({ status: 'cancelled', qty_remaining: 0 }).eq('id', order_id);

    // Return escrowed shares
    const { data: h } = await db.from('rights_holdings')
      .select('shares').eq('user_id', uid).eq('book_id', order.book_id).maybeSingle();
    if (h) {
      await db.from('rights_holdings').update({ shares: h.shares + returnQty })
        .eq('user_id', uid).eq('book_id', order.book_id);
    } else {
      await db.from('rights_holdings').insert({
        user_id: uid, book_id: order.book_id, shares: returnQty, avg_cost_per_share: 0,
      });
    }

    return new Response(JSON.stringify({ ok: true, returned: returnQty }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
