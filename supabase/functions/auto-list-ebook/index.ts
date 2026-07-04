// Auto-list a ready ebook on the internal store.
// - Verifies required fields (title, category, cover, PDF).
// - Regenerates thumbnail (category-styled) + listing copy on every list event.
// - Auto-computes a price via the category-aware pricing engine.
// - Syncs Stripe Product + Price for checkout.
// - Sets listed_at, listing_status='listed', status='published'.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient, corsHeaders } from "../_shared/stripe.ts";
import { computeListingPrice } from "../_shared/pricing.ts";
import { resolveStyleProfile } from "../_shared/thumbnail-style-system.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const priceLookupKey = (id: string) => `ebook_${id.replace(/-/g, "")}_price`;
const productLookupId = (id: string) => `ebook_${id.replace(/-/g, "")}`;

async function syncStripe(env: StripeEnv, e: any) {
  const stripe = createStripeClient(env);
  const lookupKey = priceLookupKey(e.id);
  const productId = productLookupId(e.id);
  const cents = Math.round(Number(e.price) * 100);
  if (!cents || cents <= 0) throw new Error("Invalid price");

  // Upsert product
  let productRef: string;
  try {
    const p = await stripe.products.retrieve(productId);
    productRef = p.id;
    await stripe.products.update(productId, {
      name: e.title ?? "Ebook",
      ...(e.product_description ? { description: String(e.product_description).slice(0, 500) } : {}),
      ...(e.cover_url ? { images: [e.cover_url] } : {}),
      active: true,
      metadata: { ebook_id: e.id, lovable_external_id: productId, category_id: e.category_id ?? "" },
    });
  } catch (_) {
    const created = await stripe.products.create({
      id: productId,
      name: e.title ?? "Ebook",
      ...(e.product_description ? { description: String(e.product_description).slice(0, 500) } : {}),
      ...(e.cover_url ? { images: [e.cover_url] } : {}),
      tax_code: "txcd_10504003",
      metadata: { ebook_id: e.id, lovable_external_id: productId, category_id: e.category_id ?? "" },
    });
    productRef = created.id;
  }

  // Reuse or (re)create price for the current amount
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const current = existing.data[0];
  if (!current || current.unit_amount !== cents) {
    if (current) {
      await stripe.prices.update(current.id, { active: false, lookup_key: null } as any);
    }
    await stripe.prices.create({
      product: productRef,
      currency: "usd",
      unit_amount: cents,
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      nickname: e.title ?? "Ebook",
      metadata: { ebook_id: e.id, lovable_external_id: lookupKey },
    });
  }
  return { productId: productRef, lookupKey };
}

async function log(ebookId: string, step: string, status: string, payload: unknown) {
  try {
    await supabase.from("pipeline_step_logs").insert({
      ebook_id: ebookId,
      step,
      status,
      payload: payload as any,
    });
  } catch (_) {
    // best-effort
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string = body.ebook_id;
    const environment: StripeEnv = body.environment === "live" ? "live" : "sandbox";
    if (!ebookId) throw new Error("ebook_id is required");

    const { data: e, error } = await supabase
      .from("ebooks")
      .select("id, title, price, category_id, category_slug, cover_url, product_description, pdf_url, status, listed_at, total_word_count, word_count, worksheet_count, final_quality_score, product_format")
      .eq("id", ebookId)
      .maybeSingle();
    if (error) throw error;
    if (!e) throw new Error("Ebook not found");

    // Validate required fields (price is now auto-computed, so drop from required list)
    const missing: string[] = [];
    if (!e.title) missing.push("title");
    if (!e.category_id) missing.push("category");
    if (!e.pdf_url) missing.push("pdf");
    if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);

    // Resolve category name → style slug so pricing + cover both use it.
    const cat = e.category_id
      ? (await supabase.from("categories").select("name,slug").eq("id", e.category_id).maybeSingle()).data
      : null;
    const profile = resolveStyleProfile({
      category_slug: e.category_slug ?? cat?.slug ?? null,
      category_name: cat?.name ?? null,
      title: e.title,
    });

    // Always regenerate the thumbnail with the currently active reference
    // style so every listing gets the newest look. Fire-and-forget: the
    // generate-cover function processes in the background (returns 202) and
    // updates cover_url when it finishes. If no cover exists yet we still
    // block on the invocation so Stripe gets a valid image URL below.
    await log(ebookId, "auto_list.generate_cover", "started", { force: true });
    const { error: covErr } = await supabase.functions.invoke("generate-cover", {
      body: { ebook_id: ebookId, mode: "full", force: true },
    });
    if (covErr) {
      await log(ebookId, "auto_list.generate_cover", "failed", { error: covErr.message });
      if (!e.cover_url) throw new Error(`Cover generation failed: ${covErr.message}`);
    }
    // Refresh cover_url if it was previously missing (best effort — background
    // job may still be running for a re-list).
    if (!e.cover_url) {
      const { data: refreshed } = await supabase
        .from("ebooks").select("cover_url").eq("id", ebookId).maybeSingle();
      e.cover_url = refreshed?.cover_url ?? null;
      if (!e.cover_url) throw new Error("Cover generation did not produce a cover_url yet — try again in ~1 min.");
    }

    // Regenerate selling copy (hook / description / bullets) on every listing
    // so the storefront always shows the freshest sales angle.
    await log(ebookId, "auto_list.generate_selling_copy", "started", {});
    const { data: copyData, error: copyErr } = await supabase.functions.invoke("generate-selling-copy", {
      body: { ebook_id: ebookId },
    });
    if (copyErr) {
      await log(ebookId, "auto_list.generate_selling_copy", "failed", { error: copyErr.message });
      // non-fatal — keep existing description
    } else {
      await log(ebookId, "auto_list.generate_selling_copy", "completed", copyData ?? {});
      const { data: refreshed } = await supabase
        .from("ebooks").select("product_description").eq("id", ebookId).maybeSingle();
      if (refreshed?.product_description) e.product_description = refreshed.product_description;
    }

    // Sync Stripe
    const stripe = await syncStripe(environment, e);
    await log(ebookId, "auto_list.stripe_sync", "completed", stripe);

    // Mark as listed + published
    const { error: upErr } = await supabase
      .from("ebooks")
      .update({
        listed_at: e.listed_at ?? new Date().toISOString(),
        status: "published",
        updated_at: new Date().toISOString(),
      })
      .eq("id", ebookId);
    if (upErr) throw upErr;

    await log(ebookId, "auto_list", "completed", { environment, ...stripe });

    return new Response(
      JSON.stringify({ ok: true, ebook_id: ebookId, ...stripe }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-list-ebook error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
