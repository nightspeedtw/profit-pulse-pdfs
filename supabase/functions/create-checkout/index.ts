// Create a Stripe Embedded Checkout session for a cart of ebooks.
// Uses `price_data` inline (no need to pre-create Stripe products per ebook).
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient, corsHeaders } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const body = await req.json();
    const items: Array<{ ebook_id: string; quantity?: number }> = body.items ?? [];
    const buyerEmail: string | undefined = body.buyer_email;
    const returnUrl: string = body.return_url ?? `${req.headers.get("origin") ?? ""}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
    const environment: StripeEnv = body.environment === "live" ? "live" : "sandbox";
    if (!items.length) throw new Error("Cart is empty");

    // Load ebook details for line_items
    const ids = items.map((i) => i.ebook_id);
    const { data: ebooks, error: ebErr } = await supabase
      .from("ebooks")
      .select("id, title, price, cover_url, product_description")
      .in("id", ids);
    if (ebErr) throw ebErr;
    if (!ebooks || ebooks.length === 0) throw new Error("Ebooks not found");

    const stripe = createStripeClient(environment);
    const line_items = items
      .map((it) => {
        const e = ebooks.find((x) => x.id === it.ebook_id);
        if (!e) return null;
        const price = Number(e.price);
        if (!price || price <= 0) return null;
        const cents = Math.round(price * 100);
        return {
          quantity: Math.max(1, it.quantity ?? 1),
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name: e.title ?? "Ebook",
              ...(e.product_description ? { description: String(e.product_description).slice(0, 500) } : {}),
              ...(e.cover_url ? { images: [e.cover_url] } : {}),
              metadata: { ebook_id: e.id },
            },
          },
        };
      })
      .filter(Boolean) as any[];

    if (!line_items.length) throw new Error("No purchasable items");

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: returnUrl,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      payment_intent_data: {
        description: line_items.map((li) => li.price_data.product_data.name).join(", ").slice(0, 500),
        metadata: { ebook_ids: ids.join(",") },
      },
      metadata: { ebook_ids: ids.join(",") },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
