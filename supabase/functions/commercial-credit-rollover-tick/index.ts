// Hourly cron: mark commercial rights inactive when the paid period ends
// after a cancellation. Expired credit grants are already excluded by the
// balance function (WHERE expires_at > now()), so no ledger sweep is needed.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // Find subs that are canceled/paused and whose paid period has ended.
  const { data: expired } = await admin
    .from('commercial_subscriptions')
    .select('id')
    .in('status', ['canceled', 'paused'])
    .lt('current_period_end', nowIso);

  const subIds = (expired ?? []).map((s: any) => s.id);
  let affected = 0;
  if (subIds.length > 0) {
    const { data: updated, error } = await admin
      .from('book_licenses_owned')
      .update({ commercial_rights_active: false })
      .in('subscription_id', subIds)
      .eq('commercial_rights_active', true)
      .select('id');
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    affected = updated?.length ?? 0;
  }

  return new Response(
    JSON.stringify({ ok: true, expiredSubs: subIds.length, licensesDeactivated: affected }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
