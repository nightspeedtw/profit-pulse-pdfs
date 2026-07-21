// Resolves the final price for a book, creates a Paddle transaction with that
// custom price, and returns { transactionId } for the client to hand to
// Paddle.Checkout.open({ transactionId }).
//
// This is how we honor per-book dynamic pricing (charm anchors, campaign
// discounts, promo codes) without maintaining 600+ Paddle price entries.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPaddleClient, corsHeaders, type PaddleEnv } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const bookId: string = body.bookId;
    const env: PaddleEnv = body.environment === 'live' ? 'live' : 'sandbox';
    if (!bookId) throw new Error('bookId required');

    // Auth: user must be signed in
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Resolve effective price from product_pricing (US market)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pricingRow } = await admin
      .from('product_pricing')
      .select('effective_price_cents, regular_price_cents')
      .eq('product_id', bookId)
      .eq('market', 'US')
      .maybeSingle();

    let cents = pricingRow?.effective_price_cents;
    let title = 'Digital Download';

    // Fallback: read from ebooks_kids
    const { data: book } = await admin
      .from('ebooks_kids')
      .select('id, title, price_cents')
      .eq('id', bookId)
      .maybeSingle();
    if (book?.title) title = book.title;
    if (!cents) cents = book?.price_cents ?? 499;
    if (cents < 199) cents = 199;

    // Look up the Paddle internal ID for our dynamic download product.
    const paddle = getPaddleClient(env);
    // Find price by external_id
    const priceLookup = await fetch(
      `https://connector-gateway.lovable.dev/paddle/prices?external_id=digital_download_dynamic`,
      {
        headers: {
          'X-Connection-Api-Key': Deno.env.get(env === 'sandbox' ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_LIVE_API_KEY')!,
          'Lovable-API-Key': Deno.env.get('LOVABLE_API_KEY')!,
        },
      },
    );
    const priceData = await priceLookup.json();
    const paddlePriceId = priceData?.data?.[0]?.id;
    if (!paddlePriceId) throw new Error('digital_download_dynamic price not found in Paddle');

    // Create a transaction with a per-line custom price.
    const txn = await paddle.transactions.create({
      items: [
        {
          quantity: 1,
          price: {
            description: title.slice(0, 200),
            name: title.slice(0, 200),
            productId: (await paddle.prices.get(paddlePriceId)).productId,
            unitPrice: { amount: String(cents), currencyCode: 'USD' },
            quantity: { minimum: 1, maximum: 1 },
            taxMode: 'account_setting',
          } as any,
        },
      ],
      customData: { userId: user.id, bookId, kind: 'book_purchase' },
    } as any);

    return new Response(
      JSON.stringify({
        transactionId: txn.id,
        finalCents: cents,
        title,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('resolve-checkout-price error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
