// Execute a market buy against the ask ladder. Atomic via DB function.
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
    const qty: number = Math.floor(Number(body.qty));
    if (!book_id || !qty || qty <= 0) throw new Error('book_id + qty>0 required');
    if (qty > 1_000_000) throw new Error('qty too large');

    const db = createClient(SB_URL, SB_KEY);
    const { data, error } = await db.rpc('exchange_execute_buy', {
      p_buyer: buyer,
      p_book: book_id,
      p_qty: qty,
      p_max_cost: Number(body.max_cost ?? 0),
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
