// POST /commercial-unlock-book  { bookId }
// Spends 1 credit from the caller's active commercial subscription and
// upserts a commercial license row for (user, book).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return j(405, { error: 'method_not_allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return j(401, { error: 'unauthenticated' });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return j(401, { error: 'unauthenticated' });
  const userId = userRes.user.id;

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    return j(400, { error: 'invalid_json' });
  }
  const bookId: string | undefined = body?.bookId;
  if (!bookId) return j(400, { error: 'missing_bookId' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verify active commercial subscription
  const { data: sub } = await admin
    .from('commercial_subscriptions')
    .select('id,current_period_end,status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return j(403, { error: 'no_active_subscription' });

  // Balance check via ledger (unexpired sum)
  const { data: balRes } = await admin.rpc('commercial_credit_balance', { user_uuid: userId });
  const balance = typeof balRes === 'number' ? balRes : 0;
  if (balance < 1) return j(402, { error: 'insufficient_credits' });

  // Idempotency: already commercial?
  const { data: existing } = await admin
    .from('book_licenses_owned')
    .select('id,license_type,commercial_rights_active')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .maybeSingle();
  if (existing && existing.license_type === 'commercial' && existing.commercial_rights_active) {
    return j(200, { ok: true, alreadyOwned: true, creditBalance: balance });
  }

  // Spend 1 credit
  const { error: ledgerErr } = await admin.from('commercial_credit_ledger').insert({
    user_id: userId,
    subscription_id: sub.id,
    delta: -1,
    reason: 'unlock',
    book_id: bookId,
  });
  if (ledgerErr) return j(500, { error: 'ledger_write_failed', details: ledgerErr.message });

  // Upsert commercial license
  const { error: upsertErr } = await admin.from('book_licenses_owned').upsert(
    {
      user_id: userId,
      book_id: bookId,
      license_type: 'commercial',
      purchase_source: 'subscription_unlock',
      subscription_id: sub.id,
      commercial_rights_active: true,
      commercial_rights_last_active_at: new Date().toISOString(),
      granted_at: existing?.commercial_rights_active ? undefined : new Date().toISOString(),
    } as any,
    { onConflict: 'user_id,book_id' }
  );
  if (upsertErr) {
    // Refund the credit if the upsert failed
    await admin.from('commercial_credit_ledger').insert({
      user_id: userId,
      subscription_id: sub.id,
      delta: 1,
      reason: 'refund',
      book_id: bookId,
      note: 'auto_refund_after_upsert_failure',
    });
    return j(500, { error: 'license_write_failed', details: upsertErr.message });
  }

  const { data: newBal } = await admin.rpc('commercial_credit_balance', { user_uuid: userId });
  return j(200, { ok: true, creditBalance: typeof newBal === 'number' ? newBal : balance - 1 });
});
