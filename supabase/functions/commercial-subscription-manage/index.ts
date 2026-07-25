// POST /commercial-subscription-manage
// Returns a Paddle customer-portal URL for the caller's active commercial
// subscription so they can upgrade, downgrade, or cancel.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getPaddleClient, type PaddleEnv } from '../_shared/paddle.ts';

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
  const { data: userRes } = await userClient.auth.getUser();
  if (!userRes.user) return j(401, { error: 'unauthenticated' });
  const userId = userRes.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: sub } = await admin
    .from('commercial_subscriptions')
    .select('id,paddle_customer_id,paddle_subscription_id,environment,status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return j(404, { error: 'no_subscription' });

  const env = (sub.environment as PaddleEnv) || 'sandbox';
  const paddle = getPaddleClient(env);
  try {
    const portal = await paddle.customerPortalSessions.create(
      String(sub.paddle_customer_id),
      [String(sub.paddle_subscription_id)]
    );
    const url =
      (portal as any)?.urls?.subscriptions?.[0]?.cancelSubscription ||
      (portal as any)?.urls?.subscriptions?.[0]?.updateSubscriptionPaymentMethod ||
      (portal as any)?.urls?.general?.overview;
    if (!url) return j(500, { error: 'portal_url_missing' });
    return j(200, { url });
  } catch (e) {
    return j(500, { error: 'portal_create_failed', details: (e as Error).message });
  }
});
