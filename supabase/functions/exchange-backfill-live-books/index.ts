// One-shot: list every book already at listing_status='live' on the exchange.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SB_URL, SB_KEY);

  const results: Array<Record<string, unknown>> = [];

  async function listOne(book_id: string, book_type: 'kids' | 'adult') {
    const r = await fetch(`${SB_URL}/functions/v1/exchange-list-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ book_id, book_type }),
    });
    const j = await r.json().catch(() => ({}));
    results.push({ book_id, book_type, ...j });
  }

  const { data: kids } = await db.from('ebooks_kids').select('id').eq('listing_status', 'live');
  for (const b of kids ?? []) await listOne(b.id, 'kids');

  const { data: adult } = await db.from('ebooks')
    .select('id, listing_status, status')
    .or('listing_status.eq.listed,status.eq.published');
  for (const b of adult ?? []) await listOne(b.id, 'adult');

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
