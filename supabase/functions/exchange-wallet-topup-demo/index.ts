// Grant $100 demo balance to the calling user (idempotent).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DEFAULT_DEMO_TOPUP_USD } from '../_shared/exchange-model.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) throw new Error('auth required');
    const authed = createClient(SB_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: u, error: uErr } = await authed.auth.getUser();
    if (uErr || !u?.user) throw new Error('invalid token');
    const user_id = u.user.id;

    const db = createClient(SB_URL, SB_KEY);

    // settings
    const { data: settings } = await db.from('platform_settings').select('key,value_json').eq('key', 'demo_topup_usd').maybeSingle();
    const amount = Number(settings?.value_json ?? DEFAULT_DEMO_TOPUP_USD);

    const { data: existing } = await db.from('wallets').select('user_id, usd_balance').eq('user_id', user_id).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, already_granted: true, balance: existing.usd_balance }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await db.from('wallets').insert({ user_id, usd_balance: amount, is_demo: true });
    await db.from('wallet_transactions').insert({
      user_id, type: 'demo_grant', amount_usd: amount, balance_after: amount,
      meta: { note: 'Initial DEMO balance — no real payments yet.' },
    });

    return new Response(JSON.stringify({ ok: true, granted: amount, balance: amount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
