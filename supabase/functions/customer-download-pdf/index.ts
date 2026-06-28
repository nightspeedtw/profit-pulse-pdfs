// Customer-facing PDF download.
// Verifies a Shopify order by order name (e.g. "#1001") + customer email,
// then returns signed download URLs for every ebook product purchased.
//
// POST { order: "#1001" | "1001", email: "buyer@example.com" }
// → { ok: true, items: [{ ebook_id, title, download_url, expires_at }] }
import { corsHeaders, admin } from "../_shared/ai.ts";

const SHOPIFY_API_VERSION = "2025-07";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 h

function shopName(): string {
  // Same domain pattern used elsewhere in the project.
  return Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "digital-wealth-hub-49qgj.myshopify.com";
}

function pathFromPdfUrl(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null;
  try {
    const u = new URL(pdfUrl);
    const markers = [
      "/storage/v1/object/sign/ebook-pdfs/",
      "/storage/v1/object/authenticated/ebook-pdfs/",
      "/storage/v1/object/public/ebook-pdfs/",
    ];
    for (const m of markers) {
      const i = u.pathname.indexOf(m);
      if (i >= 0) return decodeURIComponent(u.pathname.slice(i + m.length));
    }
  } catch { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { order, email } = await req.json();
    if (!order || !email) throw new Error("order and email are required");

    const orderName = String(order).trim().startsWith("#")
      ? String(order).trim()
      : `#${String(order).trim()}`;
    const cleanEmail = String(email).trim().toLowerCase();

    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    if (!token) throw new Error("Shopify admin token not configured");

    // Look up the order by name (e.g. "#1001"). Shopify accepts ?name=#1001
    const shopify = `https://${shopName()}/admin/api/${SHOPIFY_API_VERSION}`;
    const r = await fetch(
      `${shopify}/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,email,line_items,financial_status,fulfillment_status`,
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
    );
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Shopify lookup failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const { orders = [] } = await r.json();
    const match = orders.find((o: any) =>
      (o.email ?? "").toLowerCase() === cleanEmail
    );
    if (!match) {
      return new Response(
        JSON.stringify({ ok: false, error: "Order not found for that email." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (match.financial_status && !["paid", "partially_paid", "authorized"].includes(match.financial_status)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Order is ${match.financial_status} — download unlocks after payment.` }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const productIds = (match.line_items ?? [])
      .map((li: any) => String(li.product_id))
      .filter(Boolean);
    if (productIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Order has no products." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = admin();
    const { data: ebooks, error } = await db
      .from("ebooks")
      .select("id,title,pdf_url,shopify_product_id")
      .in("shopify_product_id", productIds);
    if (error) throw error;

    const items: Array<{
      ebook_id: string;
      title: string;
      download_url: string | null;
      expires_at: string | null;
      error?: string;
    }> = [];

    for (const e of ebooks ?? []) {
      const path = pathFromPdfUrl(e.pdf_url);
      if (!path) {
        items.push({
          ebook_id: e.id, title: e.title, download_url: null, expires_at: null,
          error: "PDF not ready yet — please check back shortly.",
        });
        continue;
      }
      const { data: signed, error: signErr } = await db.storage
        .from("ebook-pdfs")
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
          download: `${e.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60)}.pdf`,
        });
      if (signErr || !signed) {
        items.push({
          ebook_id: e.id, title: e.title, download_url: null, expires_at: null,
          error: signErr?.message ?? "Could not generate download link.",
        });
        continue;
      }
      items.push({
        ebook_id: e.id,
        title: e.title,
        download_url: signed.signedUrl,
        expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, order: match.name, items }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
