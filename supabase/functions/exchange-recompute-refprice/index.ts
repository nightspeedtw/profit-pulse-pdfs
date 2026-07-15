// Daily recompute of ref_price for each offering + snapshot to price history.
// Also refreshes trailing_90d_net_rev + 24h volume rollup.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeRefPrice, BASE_SHARE_PRICE } from '../_shared/exchange-model.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const db = createClient(SB_URL, SB_KEY);
    const { data: offerings } = await db.from('rights_offerings').select('*');
    if (!offerings?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rank by trailing_90d_net_rev to compute momentum percentile
    const ranked = [...offerings].sort((a, b) => Number(a.trailing_90d_net_rev) - Number(b.trailing_90d_net_rev));
    const n = ranked.length;

    let updated = 0;
    for (const o of offerings) {
      const rank = ranked.findIndex(r => r.book_id === o.book_id);
      const pct = n > 1 ? rank / (n - 1) : 0;
      const hasSales = Number(o.trailing_90d_net_rev) > 0;
      const newRef = computeRefPrice({
        trailing90dNetRev: Number(o.trailing_90d_net_rev),
        salesRankPercentile: pct,
        hasSales,
      });

      // 24h volume rollup
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: trades } = await db.from('rights_trades')
        .select('gross_usd').eq('book_id', o.book_id).gte('executed_at', since);
      const vol24h = (trades ?? []).reduce((s, t) => s + Number(t.gross_usd), 0);

      await db.from('rights_offerings').update({
        ref_price_per_share: Math.max(BASE_SHARE_PRICE, newRef),
        volume_24h_usd: vol24h,
      }).eq('book_id', o.book_id);

      await db.from('rights_price_history').insert({
        book_id: o.book_id, ref_price: newRef,
        last_trade_price: o.last_trade_price, volume_usd: vol24h, source: 'daily',
      });

      // Bump treasury ask price if unchanged since creation
      await db.from('rights_orders').update({ price_per_share: newRef })
        .eq('book_id', o.book_id).eq('is_treasury', true).eq('status', 'open');

      updated++;
    }

    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
