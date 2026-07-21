// Resolves a human-readable price ID (e.g. "kids_pro_monthly") to the
// Paddle internal price ID (pri_...).
import { gatewayFetch, corsHeaders, type PaddleEnv } from '../_shared/paddle.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { priceId, environment } = await req.json();
    const env: PaddleEnv = environment === 'live' ? 'live' : 'sandbox';
    if (!priceId) throw new Error('priceId required');

    const res = await gatewayFetch(env, `/prices?external_id=${encodeURIComponent(priceId)}`);
    const data = await res.json();
    const paddleId = data?.data?.[0]?.id;
    if (!paddleId) throw new Error(`Price not found: ${priceId}`);

    return new Response(JSON.stringify({ paddleId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('get-paddle-price error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
