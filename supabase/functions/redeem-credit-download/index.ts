// Spend 1 subscription credit and grant a download for the given book.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, type PaddleEnv } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { bookId, environment } = await req.json();
    const env: PaddleEnv = environment === 'live' ? 'live' : 'sandbox';
    if (!bookId) throw new Error('bookId required');

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Check active subscription
    const { data: sub } = await admin
      .from('subscriptions')
      .select('id, credits_per_period, credits_reset_at, status, current_period_end')
      .eq('user_id', user.id)
      .eq('environment', env)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub) return new Response(JSON.stringify({ error: 'no_subscription' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Compute credits used this period
    const periodStart = sub.credits_reset_at
      ? new Date(new Date(sub.credits_reset_at).getTime() - 32 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(0).toISOString();

    const { data: spendRows } = await admin
      .from('wallet_transactions')
      .select('meta')
      .eq('user_id', user.id)
      .eq('type', 'sub_credit_spend')
      .gte('created_at', periodStart);

    const used = spendRows?.length ?? 0;
    const remaining = (sub.credits_per_period ?? 0) - used;
    if (remaining <= 0) return new Response(JSON.stringify({ error: 'no_credits', remaining: 0 }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Spend 1 credit
    const { data: wallet } = await admin.from('wallets').select('usd_balance').eq('user_id', user.id).maybeSingle();
    await admin.from('wallet_transactions').insert({
      user_id: user.id, type: 'sub_credit_spend', amount_usd: 0,
      balance_after: wallet?.usd_balance ?? 0, ref_id: bookId,
      meta: { book_id: bookId, subscription_id: sub.id },
    });

    // Grant download
    await admin.from('download_grants').insert({
      buyer_user_id: user.id, ebook_id: bookId, source: 'subscription',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      max_downloads: 5,
    } as any);

    return new Response(JSON.stringify({ ok: true, remaining: remaining - 1 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('redeem-credit-download error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
