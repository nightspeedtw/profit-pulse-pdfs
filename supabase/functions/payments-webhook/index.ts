// Stripe webhook: on checkout.session.completed, create order, items, and
// per-ebook download grants. Idempotent by stripe_session_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient, verifyWebhook } from "../_shared/stripe.ts";

let _sb: ReturnType<typeof createClient> | null = null;
function db() {
  if (!_sb) {
    _sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  }
  return _sb;
}

async function fulfillSession(session: any, env: StripeEnv) {
  const stripe = createStripeClient(env);
  const sessionId: string = session.id;

  // Idempotency — skip if we already processed this session
  const { data: existing } = await db()
    .from("orders")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing) {
    console.log("session already fulfilled:", sessionId);
    return;
  }

  // Expand line_items to get product metadata (contains ebook_id)
  const li = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ["data.price.product"],
  });

  const buyerEmail: string = session.customer_details?.email || session.customer_email || "";
  if (!buyerEmail) throw new Error("No buyer email on session");
  const currency: string = session.currency || "usd";
  const amountTotal: number = session.amount_total || 0;

  // Insert order
  const { data: order, error: oErr } = await db()
    .from("orders")
    .insert({
      buyer_email: buyerEmail,
      stripe_session_id: sessionId,
      stripe_payment_intent: session.payment_intent ?? null,
      amount_total: amountTotal,
      currency,
      status: "paid",
      environment: env,
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (oErr) throw oErr;
  const orderId = order.id as string;

  // Build items + grants
  for (const line of li.data) {
    const product: any = line.price?.product;
    const ebookId: string | undefined = product?.metadata?.ebook_id;
    if (!ebookId) {
      console.warn("line item missing ebook_id metadata; skipping", line.id);
      continue;
    }
    const unitPrice = line.price?.unit_amount ?? 0;
    const title = product?.name ?? "Ebook";
    const cover = product?.images?.[0] ?? null;

    await db().from("order_items").insert({
      order_id: orderId,
      ebook_id: ebookId,
      unit_price: unitPrice,
      currency,
      title_snapshot: title,
      cover_snapshot: cover,
    });

    // One grant per line-item quantity (usually 1)
    const qty = line.quantity ?? 1;
    for (let i = 0; i < qty; i++) {
      await db().from("download_grants").insert({
        order_id: orderId,
        ebook_id: ebookId,
        buyer_email: buyerEmail,
      });
    }

    // Increment sales_count on ebook
    await db().rpc("noop_unused_placeholder").catch(() => {});
    // Manual increment via select+update (no atomic increment RPC defined)
    const { data: e } = await db().from("ebooks").select("sales_count").eq("id", ebookId).maybeSingle();
    const current = (e?.sales_count as number | undefined) ?? 0;
    await db().from("ebooks").update({ sales_count: current + qty }).eq("id", ebookId);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawEnv = new URL(req.url).searchParams.get("env");
  if (rawEnv !== "sandbox" && rawEnv !== "live") {
    console.error("invalid env param:", rawEnv);
    return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  const env: StripeEnv = rawEnv;
  try {
    const event = await verifyWebhook(req, env);
    if (event.type === "checkout.session.completed" || event.type === "transaction.completed") {
      await fulfillSession(event.data.object, env);
    } else {
      console.log("unhandled event:", event.type);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("webhook error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});
