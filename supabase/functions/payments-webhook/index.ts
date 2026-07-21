// Paddle webhook handler.
// Route: /functions/v1/payments-webhook?env=sandbox|live
// Handles: subscription.created/updated/canceled, transaction.completed
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhook, EventName, type PaddleEnv } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) _admin = createClient(SUPABASE_URL, SERVICE_KEY);
  return _admin;
}

// Map subscription price_id → credits per period
const CREDITS_PER_PRICE: Record<string, number> = {
  kids_starter_monthly: 10,
  kids_starter_yearly: 120,
  kids_pro_monthly: 30,
  kids_pro_yearly: 360,
  kids_unlimited_monthly: 100,
  kids_unlimited_yearly: 1200,
};

async function grantSubscriptionCredits(userId: string, credits: number, subscriptionId: string, note: string) {
  if (credits <= 0) return;
  // Ensure wallet row exists
  await admin().from('wallets').upsert({ user_id: userId }, { onConflict: 'user_id' });
  const { data: wallet } = await admin().from('wallets').select('usd_balance').eq('user_id', userId).maybeSingle();
  await admin().from('wallet_transactions').insert({
    user_id: userId,
    type: 'sub_credit_grant',
    amount_usd: 0,
    balance_after: wallet?.usd_balance ?? 0,
    ref_id: subscriptionId,
    meta: { credits, note, source: 'paddle_subscription' },
  });
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;
  const userId = customData?.userId;
  if (!userId) { console.error('No userId in customData'); return; }

  const item = items[0];
  const priceExtId = item.price.importMeta?.externalId ?? item.price.customData?.externalId;
  const productExtId = item.product?.importMeta?.externalId ?? item.product?.customData?.externalId;
  if (!priceExtId || !productExtId) {
    console.warn('Skipping subscription: missing importMeta.externalId', { rawPriceId: item.price.id });
    return;
  }

  const credits = CREDITS_PER_PRICE[priceExtId] ?? 0;

  await admin().from('subscriptions').upsert({
    user_id: userId,
    paddle_subscription_id: id,
    paddle_customer_id: customerId,
    product_id: productExtId,
    price_id: priceExtId,
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    environment: env,
    credits_per_period: credits,
    credits_reset_at: currentBillingPeriod?.endsAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'paddle_subscription_id' });

  await grantSubscriptionCredits(userId, credits, id, 'initial_grant');
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange, items, customData } = data;

  const item = items?.[0];
  const priceExtId = item?.price?.importMeta?.externalId;
  const newCredits = priceExtId ? (CREDITS_PER_PRICE[priceExtId] ?? 0) : undefined;

  // Fetch existing to detect period rollover / plan change
  const { data: existing } = await admin()
    .from('subscriptions')
    .select('user_id, price_id, current_period_start, credits_per_period')
    .eq('paddle_subscription_id', id)
    .eq('environment', env)
    .maybeSingle();

  const userId = existing?.user_id ?? customData?.userId;
  const patch: Record<string, unknown> = {
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    cancel_at_period_end: scheduledChange?.action === 'cancel',
    updated_at: new Date().toISOString(),
  };
  if (priceExtId) patch.price_id = priceExtId;
  if (typeof newCredits === 'number') {
    patch.credits_per_period = newCredits;
    patch.credits_reset_at = currentBillingPeriod?.endsAt;
  }

  await admin().from('subscriptions')
    .update(patch)
    .eq('paddle_subscription_id', id)
    .eq('environment', env);

  if (!userId) return;

  const periodRolledOver = existing?.current_period_start &&
    currentBillingPeriod?.startsAt &&
    new Date(currentBillingPeriod.startsAt).getTime() > new Date(existing.current_period_start).getTime();
  const planChanged = priceExtId && existing?.price_id && existing.price_id !== priceExtId;

  if (periodRolledOver && typeof newCredits === 'number') {
    await grantSubscriptionCredits(userId, newCredits, id, 'period_renewal');
  } else if (planChanged && typeof newCredits === 'number' && existing) {
    // Prorated top-up: grant the delta immediately
    const delta = newCredits - (existing.credits_per_period ?? 0);
    if (delta > 0) await grantSubscriptionCredits(userId, delta, id, `plan_change_${existing.price_id}_to_${priceExtId}`);
  }
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  await admin().from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('paddle_subscription_id', data.id)
    .eq('environment', env);
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const customData = data.customData ?? {};
  const kind = customData.kind;
  const userId = customData.userId;
  const bookId = customData.bookId;

  if (kind !== 'book_purchase' || !userId || !bookId) return;

  // Idempotency: skip if we already fulfilled this transaction
  const { data: existingOrder } = await admin()
    .from('orders')
    .select('id')
    .eq('provider_ref', data.id)
    .maybeSingle();
  if (existingOrder) return;

  // Compute total from Paddle payload
  const totalCents = Math.round(Number(data.details?.totals?.total ?? data.details?.totals?.grandTotal ?? 0));

  // Record order
  const { data: order, error: orderErr } = await admin()
    .from('orders')
    .insert({
      user_id: userId,
      total_cents: totalCents,
      currency: 'USD',
      status: 'paid',
      provider: 'paddle',
      provider_ref: data.id,
      environment: env,
    } as any)
    .select('id')
    .single();

  if (orderErr) console.warn('order insert failed:', orderErr.message);

  if (order?.id) {
    await admin().from('order_items').insert({
      order_id: order.id,
      product_kind: 'ebook_kids',
      product_id: bookId,
      unit_cents: totalCents,
      quantity: 1,
    } as any);
  }

  // Grant download
  await admin().from('download_grants').insert({
    user_id: userId,
    book_id: bookId,
    source: 'purchase',
  } as any);

  // Fire-and-forget: royalty accrual + email
  try {
    await admin().functions.invoke('royalty-accrue-order', { body: { orderId: order?.id, bookId, totalCents, userId } });
  } catch (e) { console.warn('royalty accrue failed:', (e as Error).message); }
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);
  console.log('paddle event:', event.eventType, 'env:', env);
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
      await handleSubscriptionCreated(event.data, env); break;
    case EventName.SubscriptionUpdated:
      await handleSubscriptionUpdated(event.data, env); break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env); break;
    case EventName.TransactionCompleted:
      await handleTransactionCompleted(event.data, env); break;
    default:
      console.log('unhandled event:', event.eventType);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const env = (url.searchParams.get('env') || 'sandbox') as PaddleEnv;
  try {
    await handleWebhook(req, env);
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Webhook error', { status: 400 });
  }
});
