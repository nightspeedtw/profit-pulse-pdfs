// royalty-reserve — flip a quote to 'reserved'. NO wallet debit, NO
// ownership created. Real payment activation happens later.

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

    const { quote_id } = await req.json() as { quote_id?: string };
    if (!quote_id) return json({ ok: false, error: 'quote_id required' }, 400);

    const { data: quote, error: qErr } = await admin
      .from('royalty_purchase_quotes')
      .select('*')
      .eq('id', quote_id)
      .maybeSingle();
    if (qErr || !quote) return json({ ok: false, error: 'quote_not_found' }, 404);
    if (quote.user_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403);
    if (quote.status !== 'quoted') return json({ ok: false, error: `cannot_reserve_status_${quote.status}` }, 400);
    if (new Date(quote.expires_at).getTime() < Date.now()) {
      await admin.from('royalty_purchase_quotes').update({ status: 'expired' }).eq('id', quote_id);
      return json({ ok: false, error: 'quote_expired' }, 400);
    }

    const { error: uErr } = await admin
      .from('royalty_purchase_quotes')
      .update({ status: 'reserved' })
      .eq('id', quote_id);
    if (uErr) return json({ ok: false, error: uErr.message }, 500);

    return json({
      ok: true,
      quote_id,
      status: 'reserved',
      message: 'Payment activation is coming soon. Your calculation has been saved.',
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
