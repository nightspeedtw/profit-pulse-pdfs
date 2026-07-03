// Create a Stripe Embedded Checkout session for a cart of ebooks.
// Resolves each ebook to a Stripe Product/Price via a deterministic lookup_key.
// If the price does not exist yet in Stripe, it is created on the fly so newly
// listed ebooks work immediately.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient, corsHeaders } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const priceLookupKey = (ebookId: string) =>
  `ebook_${ebookId.replace(/-/g, "")}_price`;
const productLookupId = (ebookId: string) =>
  `ebook_${ebookId.replace(/-/g, "")}`;

async function resolveOrCreatePrice(
  stripe: ReturnType<typeof createStripeClient>,
  ebook: { id: string; title: string | null; price: number | string; cover_url: string | null; product_description: string | null },
) {
  const lookupKey = priceLookupKey(ebook.id);
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data.length) return existing.data[0];

  const cents = Math.round(Number(ebook.price) * 100);
  if (!cents || cents <= 0) throw new Error(`Invalid price for ebook ${ebook.id}`);

  // Try to reuse an existing product with the deterministic id; otherwise create.
  const productId = productLookupId(ebook.id);
  let productRef: string;
  try {
    const p = await stripe.products.retrieve(productId);
    productRef = p.id;
  } catch (_) {
    const created = await stripe.products.create({
      id: productId,
      name: ebook.title ?? "Ebook",
      ...(ebook.product_description ? { description: String(ebook.product_description).slice(0, 500) } : {}),
      ...(ebook.cover_url ? { images: [ebook.cover_url] } : {}),
      tax_code: "txcd_10504003", // e-books
      metadata: { ebook_id: ebook.id, lovable_external_id: productId },
    });
    productRef = created.id;
  }

  const price = await stripe.prices.create({
    product: productRef,
    currency: "usd",
    unit_amount: cents,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    nickname: ebook.title ?? "Ebook",
    metadata: { ebook_id: ebook.id, lovable_external_id: lookupKey },
  });
  return price;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const body = await req.json();
    const items: Array<{ ebook_id: string; quantity?: number }> = body.items ?? [];
    const buyerEmail: string | undefined = body.buyer_email;
    const returnUrl: string =
      body.return_url ??
      `${req.headers.get("origin") ?? ""}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
    const environment: StripeEnv = body.environment === "live" ? "live" : "sandbox";
    if (!items.length) throw new Error("Cart is empty");

    const ids = items.map((i) => i.ebook_id);
    const { data: ebooks, error: ebErr } = await supabase
      .from("ebooks")
      .select("id, title, price, cover_url, product_description")
      .in("id", ids);
    if (ebErr) throw ebErr;
    if (!ebooks?.length) throw new Error("Ebooks not found");

    const stripe = createStripeClient(environment);

    const line_items: any[] = [];
    for (const it of items) {
      const e = ebooks.find((x) => x.id === it.ebook_id);
      if (!e) continue;
      const price = await resolveOrCreatePrice(stripe, e as any);
      line_items.push({ price: price.id, quantity: Math.max(1, it.quantity ?? 1) });
    }
    if (!line_items.length) throw new Error("No purchasable items");

    const description = ebooks.map((e) => e.title).filter(Boolean).join(", ").slice(0, 500);

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: returnUrl,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      payment_intent_data: {
        description,
        metadata: { ebook_ids: ids.join(",") },
      },
      metadata: { ebook_ids: ids.join(",") },
      // Full compliance handling: Stripe calculates + collects + files + remits tax
      // for eligible buyer countries, plus fraud, disputes, and support (+3.5%).
      managed_payments: { enabled: true },
    } as any);

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
