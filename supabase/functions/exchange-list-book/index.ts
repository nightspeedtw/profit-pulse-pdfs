// Auto-list a book on the Royalty Rights Exchange (idempotent).
// Creates rights_offerings row + seeds treasury ask + first price snapshot.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BASE_SHARE_PRICE, SHARES_PER_BOOK } from '../_shared/exchange-model.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const db = createClient(SB_URL, SB_KEY);
    const body = await req.json().catch(() => ({}));
    const book_id: string = body.book_id;
    const book_type: 'kids' | 'adult' = body.book_type;
    if (!book_id || !book_type) throw new Error('book_id + book_type required');

    // Look up title + cover
    let title: string | null = null;
    let cover_url: string | null = null;
    if (book_type === 'kids') {
      const { data } = await db.from('ebooks_kids').select('title, cover_url').eq('id', book_id).maybeSingle();
      title = data?.title ?? null;
      cover_url = data?.cover_url ?? null;
    } else {
      const { data } = await db.from('ebooks').select('title, cover_url').eq('id', book_id).maybeSingle();
      title = data?.title ?? null;
      cover_url = data?.cover_url ?? null;
    }
    if (!title) throw new Error('book not found');

    // Idempotent upsert
    const existing = await db.from('rights_offerings').select('book_id').eq('book_id', book_id).maybeSingle();
    if (existing.data) {
      return new Response(JSON.stringify({ ok: true, already_listed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const refPrice = BASE_SHARE_PRICE;
    const treasuryAskShares = SHARES_PER_BOOK;

    const { error: offErr } = await db.from('rights_offerings').insert({
      book_id, book_type, title, cover_url,
      total_shares: SHARES_PER_BOOK,
      treasury_shares: SHARES_PER_BOOK,
      ref_price_per_share: refPrice,
    });
    if (offErr) throw offErr;

    // Seed treasury ask at ref price for all 1M shares
    await db.from('rights_orders').insert({
      book_id, seller_id: null, is_treasury: true,
      qty_total: treasuryAskShares, qty_remaining: treasuryAskShares,
      price_per_share: refPrice, status: 'open',
    });

    await db.from('rights_price_history').insert({
      book_id, ref_price: refPrice, last_trade_price: null, volume_usd: 0, source: 'listing',
    });

    return new Response(JSON.stringify({ ok: true, listed: true, book_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
