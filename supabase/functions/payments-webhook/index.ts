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

// Commercial license plans — separate model (commercial_credit_ledger).
const COMMERCIAL_PLAN_CREDITS: Record<string, { plan: 'commercial_25' | 'commercial_50'; credits: number }> = {
  commercial_25_monthly: { plan: 'commercial_25', credits: 25 },
  commercial_50_monthly: { plan: 'commercial_50', credits: 50 },
};

async function grantCommercialCredits(
  userId: string,
  subscriptionId: string,
  credits: number,
  periodEnd: string | null | undefined,
  note: string,
) {
  if (credits <= 0) return;
  // Rollover-one-period rule: this grant is still spendable until the END of
  // the NEXT billing period. Approximate as +2× period length from period_end,
  // conservatively defaulting to 60 days if period_end is missing.
  const end = periodEnd ? new Date(periodEnd) : new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const expiresAt = new Date(end.getTime() + 30 * 24 * 3600 * 1000).toISOString();
  await admin().from('commercial_credit_ledger').insert({
    user_id: userId,
    subscription_id: subscriptionId,
    delta: credits,
    reason: 'period_grant',
    expires_at: expiresAt,
    note,
  });
}

async function handleCommercialSubscriptionEvent(data: any, env: PaddleEnv, kind: 'created' | 'updated' | 'canceled') {
  const { id, customerId, items, status, currentBillingPeriod, scheduledChange, customData } = data;
  const userId = customData?.userId;
  if (!userId) { console.warn('commercial sub: no userId'); return false; }

  const item = items?.[0];
  const priceExtId = item?.price?.importMeta?.externalId ?? item?.price?.customData?.externalId;
  const planMeta = priceExtId ? COMMERCIAL_PLAN_CREDITS[priceExtId] : undefined;
  if (!planMeta) return false; // Not a commercial plan — let the caller fall through.

  // Fetch prior row for period-rollover detection
  const { data: prior } = await admin()
    .from('commercial_subscriptions')
    .select('id,current_period_start,plan_code,credits_per_period')
    .eq('paddle_subscription_id', id)
    .maybeSingle();

  const { data: upserted } = await admin()
    .from('commercial_subscriptions')
    .upsert(
      {
        user_id: userId,
        paddle_subscription_id: id,
        paddle_customer_id: customerId,
        plan_code: planMeta.plan,
        credits_per_period: planMeta.credits,
        status: kind === 'canceled' ? 'canceled' : status,
        current_period_start: currentBillingPeriod?.startsAt,
        current_period_end: currentBillingPeriod?.endsAt,
        cancel_at_period_end: scheduledChange?.action === 'cancel',
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'paddle_subscription_id' }
    )
    .select('id')
    .single();

  const subRowId = upserted?.id ?? prior?.id;
  if (!subRowId) return true;

  if (kind === 'created') {
    await grantCommercialCredits(userId, subRowId, planMeta.credits, currentBillingPeriod?.endsAt, 'initial_grant');
  } else if (kind === 'updated') {
    const periodRolled =
      prior?.current_period_start &&
      currentBillingPeriod?.startsAt &&
      new Date(currentBillingPeriod.startsAt).getTime() > new Date(prior.current_period_start).getTime();
    if (periodRolled) {
      await grantCommercialCredits(userId, subRowId, planMeta.credits, currentBillingPeriod?.endsAt, 'period_renewal');
    }
    const planChanged = prior?.plan_code && prior.plan_code !== planMeta.plan;
    if (planChanged) {
      const delta = planMeta.credits - (prior?.credits_per_period ?? 0);
      if (delta > 0) await grantCommercialCredits(userId, subRowId, delta, currentBillingPeriod?.endsAt, `plan_change_${prior.plan_code}_to_${planMeta.plan}`);
    }
  }
  return true;
}

async function handleBookLicenseTransaction(data: any, env: PaddleEnv) {
  const cd = data.customData ?? {};
  if (cd.kind !== 'book_license') return false;
  const userId = cd.userId as string | undefined;
  const bookId = cd.bookId as string | undefined;
  const licenseType = cd.licenseType as 'personal' | 'commercial' | undefined;
  if (!userId || !bookId || !licenseType) return true;

  const { data: existing } = await admin()
    .from('book_licenses_owned')
    .select('id,license_type')
    .eq('user_id', userId).eq('book_id', bookId).maybeSingle();

  // Widen personal → commercial. Never narrow commercial back to personal.
  const newType = existing?.license_type === 'commercial' ? 'commercial' : licenseType;

  await admin().from('book_licenses_owned').upsert({
    user_id: userId,
    book_id: bookId,
    license_type: newType,
    purchase_source: 'one_off',
    commercial_rights_active: newType === 'commercial',
    commercial_rights_last_active_at: newType === 'commercial' ? new Date().toISOString() : null,
    granted_at: existing ? undefined : new Date().toISOString(),
  } as any, { onConflict: 'user_id,book_id' });
  return true;
}

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

  // NEW: per-book license one-off purchase (Personal $14.99 / Commercial $39)
  if (kind === 'book_license') {
    await handleBookLicenseTransaction(data, env);
    return;
  }

  // Legacy: whole-book direct purchase flow
  const userId = customData.userId;
  const bookId = customData.bookId;
  if (kind !== 'book_purchase' || !userId || !bookId) return;

  // Idempotency: skip if we already fulfilled this transaction
  const { data: existingOrder } = await admin()
    .from('orders')
    .select('id')
    .eq('stripe_session_id', data.id)
    .maybeSingle();
  if (existingOrder) return;

  const totalCents = Math.round(Number(data.details?.totals?.total ?? data.details?.totals?.grandTotal ?? 0));

  const { data: book } = await admin()
    .from('ebooks_kids')
    .select('title, cover_url')
    .eq('id', bookId)
    .maybeSingle();

  const { data: order, error: orderErr } = await admin()
    .from('orders')
    .insert({
      buyer_user_id: userId,
      amount_total: totalCents,
      currency: 'USD',
      status: 'paid',
      stripe_session_id: data.id,
      environment: env,
      paid_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single();

  if (orderErr) console.warn('order insert failed:', orderErr.message);

  if (order?.id) {
    await admin().from('order_items').insert({
      order_id: order.id,
      ebook_id: bookId,
      unit_price: totalCents,
      currency: 'USD',
      title_snapshot: book?.title ?? null,
      cover_snapshot: book?.cover_url ?? null,
    } as any);
  }

  await admin().from('download_grants').insert({
    buyer_user_id: userId,
    ebook_id: bookId,
    source: 'purchase',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    max_downloads: 999,
  } as any);

  try {
    await admin().functions.invoke('royalty-accrue-order', { body: { orderId: order?.id, bookId, totalCents, userId } });
  } catch (e) { console.warn('royalty accrue failed:', (e as Error).message); }
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);
  console.log('paddle event:', event.eventType, 'env:', env);
  switch (event.eventType) {
    case EventName.SubscriptionCreated: {
      const handled = await handleCommercialSubscriptionEvent(event.data, env, 'created');
      if (!handled) await handleSubscriptionCreated(event.data, env);
      break;
    }
    case EventName.SubscriptionUpdated: {
      const handled = await handleCommercialSubscriptionEvent(event.data, env, 'updated');
      if (!handled) await handleSubscriptionUpdated(event.data, env);
      break;
    }
    case EventName.SubscriptionCanceled: {
      const handled = await handleCommercialSubscriptionEvent(event.data, env, 'canceled');
      if (!handled) await handleSubscriptionCanceled(event.data, env);
      break;
    }
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
