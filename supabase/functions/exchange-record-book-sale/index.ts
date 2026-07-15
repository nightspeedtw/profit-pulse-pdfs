// Record a book sale → distribute royalties pro-rata to current shareholders.
// Call from purchase / download-grant paths (even placeholder purchases).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeRoyaltyPools } from '../_shared/exchange-model.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const db = createClient(SB_URL, SB_KEY);
    const body = await req.json();
    const book_id: string = body.book_id;
    const sale_price_usd = Number(body.sale_price_usd);
    const sale_ref: string = body.sale_ref ?? crypto.randomUUID();
    const has_creator: boolean = !!body.has_creator;
    if (!book_id || !sale_price_usd || sale_price_usd <= 0) throw new Error('book_id + sale_price_usd>0 required');

    const { data: off } = await db.from('rights_offerings').select('*').eq('book_id', book_id).maybeSingle();
    if (!off) return new Response(JSON.stringify({ ok: false, error: 'book_not_listed_on_exchange' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const { data: fee } = await db.from('platform_settings').select('value_json').eq('key', 'royalty_fee_pct').maybeSingle();
    const { data: tax } = await db.from('platform_settings').select('value_json').eq('key', 'royalty_tax_pct').maybeSingle();
    const { data: cpp } = await db.from('platform_settings').select('value_json').eq('key', 'creator_pool_pct').maybeSingle();

    const pools = computeRoyaltyPools({
      saleUsd: sale_price_usd,
      feePct: Number(fee?.value_json ?? 0.03),
      taxPct: Number(tax?.value_json ?? 0),
      creatorPoolPct: Number(cpp?.value_json ?? 0.5),
      hasCreator: has_creator,
    });

    // Update trailing_90d_net_rev
    await db.from('rights_offerings').update({
      trailing_90d_net_rev: Number(off.trailing_90d_net_rev) + pools.netAfterFees,
    }).eq('book_id', book_id);

    // Snapshot holdings
    const { data: holdings } = await db.from('rights_holdings')
      .select('user_id, shares').eq('book_id', book_id).gt('shares', 0);

    const totalHeld = (holdings ?? []).reduce((s, h) => s + Number(h.shares), 0);
    const treasuryShares = Number(off.treasury_shares);
    const totalShares = totalHeld + treasuryShares;
    if (totalShares === 0) throw new Error('no shares');

    const perShare = pools.shareholderPool / totalShares;

    const distRows: any[] = [];
    const walletRows: any[] = [];
    let treasuryAmt = 0;
    if (treasuryShares > 0) {
      treasuryAmt = perShare * treasuryShares;
      distRows.push({
        book_id, sale_ref, holder_id: null, holder_is_treasury: true,
        shares_at_snapshot: treasuryShares, amount_usd: Number(treasuryAmt.toFixed(4)),
      });
    }
    for (const h of holdings ?? []) {
      const amt = Number((perShare * Number(h.shares)).toFixed(4));
      if (amt <= 0) continue;
      distRows.push({
        book_id, sale_ref, holder_id: h.user_id, holder_is_treasury: false,
        shares_at_snapshot: h.shares, amount_usd: amt,
      });
      walletRows.push({ user_id: h.user_id, amount: amt });
    }

    if (distRows.length) {
      const { error: dErr } = await db.from('royalty_distributions').insert(distRows);
      if (dErr) throw dErr;
    }

    // Credit shareholder wallets
    for (const w of walletRows) {
      const { data: wal } = await db.from('wallets').select('usd_balance').eq('user_id', w.user_id).maybeSingle();
      if (!wal) {
        await db.from('wallets').insert({ user_id: w.user_id, usd_balance: w.amount, is_demo: true });
      } else {
        await db.from('wallets').update({ usd_balance: Number(wal.usd_balance) + w.amount }).eq('user_id', w.user_id);
      }
      await db.from('wallet_transactions').insert({
        user_id: w.user_id, type: 'royalty_credit', amount_usd: w.amount,
        ref_id: null, meta: { book_id, sale_ref },
      });
    }

    return new Response(JSON.stringify({
      ok: true, pools, distributions: distRows.length,
      per_share: perShare, treasury_amount: treasuryAmt,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
