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

function isKidsPictureBook(input: {
  title?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
  productFormat?: string | null;
}) {
  const haystack = [
    input.title,
    input.categorySlug,
    input.categoryName,
    input.productFormat,
  ].filter(Boolean).join(" ").toLowerCase();
  return /kid|kids|child|children|picture\s*book|storybook|illustrated\s*story|nursery|bedtime/.test(haystack);
}

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
      .select("id, title, price, category_id, category_slug, cover_url, product_description, pdf_url, status, listed_at, total_word_count, word_count, final_quality_score, product_type")
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
    const isKidsCover = isKidsPictureBook({
      title: e.title,
      categorySlug: e.category_slug ?? cat?.slug ?? profile.slug ?? null,
      categoryName: cat?.name ?? null,
      productFormat: (e as any).product_type ?? null,
    });

    if (isKidsCover) {
      if (!e.cover_url) throw new Error("Kids picture books need a finished illustrated cover before listing.");
      await log(ebookId, "auto_list.generate_cover", "skipped", { reason: "kids_picture_book_preserve_finished_cover" });
    } else {
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
    }
    // Refresh cover_url if it was previously missing (best effort — background
    // job may still be running for a re-list).
    if (!e.cover_url) {
      const { data: refreshed } = await supabase
        .from("ebooks").select("cover_url").eq("id", ebookId).maybeSingle();
      e.cover_url = refreshed?.cover_url ?? null;
      if (!e.cover_url) throw new Error("Cover generation did not produce a cover_url yet — try again in ~1 min.");
    }

    if (isKidsCover) {
      const kidsThumbnailQc = {
        source: "kids_cover_passthrough",
        reason: "Use the finished hand-painted children's cover directly; never replace it with a generic book mockup.",
        scores: {
          title_readability: 100,
          cover_integrity: 100,
          category_fit: 100,
        },
      };
      const { error: kidsThumbErr } = await supabase.from("ebooks").update({
        store_thumbnail_url: e.cover_url,
        thumbnail_url: e.cover_url,
        store_thumbnail_qc: kidsThumbnailQc as any,
        store_thumbnail_generated_at: new Date().toISOString(),
        thumbnail_needs_review: false,
        updated_at: new Date().toISOString(),
      }).eq("id", ebookId);
      if (kidsThumbErr) throw kidsThumbErr;
      await log(ebookId, "auto_list.store_thumbnail", "completed", { source: "kids_cover_passthrough", url: e.cover_url });
    } else {
      // Always regenerate the storefront thumbnail (real baked-text 3:4 image).
      // This is deterministic and safe: it never touches cover_url / pdf_url /
      // manuscript / price / copy.
      await log(ebookId, "auto_list.store_thumbnail", "started", { force: true });
      const { error: thumbErr } = await supabase.functions.invoke("generate-store-thumbnail", {
        body: { ebook_id: ebookId, force: true },
      });
      if (thumbErr) {
        await log(ebookId, "auto_list.store_thumbnail", "failed", { error: thumbErr.message });
        // non-fatal — storefront falls back to cover_url + CSS overlay
      }
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

    // Auto-price via category-aware pricing engine (unless admin already set a price).
    let finalPrice = Number(e.price ?? 0);
    let priceRationale: unknown = null;
    if (!finalPrice || finalPrice <= 0) {
      const pr = computeListingPrice({
        category_slug: profile.slug,
        category_name: cat?.name ?? null,
        title: e.title,
        word_count: (e as any).total_word_count ?? (e as any).word_count ?? null,
        worksheet_count: null,
        final_quality_score: (e as any).final_quality_score ?? null,
        product_format: (e as any).product_format ?? "ebook",
      });
      finalPrice = pr.price;
      priceRationale = pr.rationale;
      await log(ebookId, "auto_list.pricing", "computed", { price: finalPrice, category: profile.slug });
    }
    e.price = finalPrice;

    // Sync Stripe (checkout)
    const stripe = await syncStripe(environment, e);
    await log(ebookId, "auto_list.stripe_sync", "completed", stripe);

    // Mark as listed + published on the internal store
    const { error: upErr } = await supabase
      .from("ebooks")
      .update({
        listed_at: e.listed_at ?? new Date().toISOString(),
        listing_status: "listed",
        status: "published",
        price: finalPrice,
        ...(priceRationale ? { price_rationale: priceRationale as any } : {}),
        category_slug: profile.slug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ebookId);
    if (upErr) throw upErr;

    // Auto-list on Royalty Ownership market (buy-only, idempotent, best-effort)
    try {
      await supabase.from('book_royalty_markets').insert({
        book_id: ebookId,
        book_sale_price_usd: finalPrice,
      });
    } catch (e) {
      // duplicate is expected on re-list; other errors are non-fatal
      const msg = (e as Error).message ?? '';
      if (!/duplicate|unique/i.test(msg)) console.warn('book_royalty_markets insert', msg);
    }

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
