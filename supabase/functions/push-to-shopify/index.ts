// Push ebook to Shopify as draft. Requires SHOPIFY_ADMIN_TOKEN secret and SHOPIFY_STORE_DOMAIN.
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

const API_VERSION = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "digital-wealth-hub-49qgj.myshopify.com";
    if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN secret not set. Create a custom app in Shopify Admin → Apps → Develop apps, install it, copy the Admin API access token, then add it as the SHOPIFY_ADMIN_TOKEN secret.");

    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");
    if (e.status === "qc_failed") throw new Error("QC not passed — fix issues before uploading.");

    // Fetch cover bytes -> base64 for Shopify image attach
    let imagesPayload: { attachment: string; filename: string; alt: string }[] = [];
    if (e.cover_url) {
      const r = await fetch(e.cover_url);
      const buf = new Uint8Array(await r.arrayBuffer());
      const b64 = btoa(String.fromCharCode(...buf));
      imagesPayload = [{ attachment: b64, filename: "cover.png", alt: e.title }];
    }

    const body = {
      product: {
        title: e.title,
        body_html: markdownToHTML(e.product_description ?? ""),
        vendor: e.vendor ?? "Printly",
        product_type: e.product_type ?? "Digital Ebook",
        tags: (e.tags ?? []).join(", "),
        status: "draft",
        published: false,
        variants: [{
          price: String(e.price ?? 24.99),
          sku: `EBOOK-${ebook_id.slice(0, 8).toUpperCase()}`,
          requires_shipping: false,
          inventory_management: null,
          inventory_policy: "continue",
          weight: 0,
        }],
        images: imagesPayload,
        metafields: [
          { namespace: "seo", key: "title_tag", value: e.seo_title ?? "", type: "single_line_text_field" },
          { namespace: "seo", key: "description_tag", value: e.seo_meta ?? "", type: "single_line_text_field" },
          { namespace: "printly", key: "pdf_url", value: e.pdf_url ?? "", type: "single_line_text_field" },
        ],
      },
    };

    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/products.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Shopify ${res.status}: ${t.slice(0, 500)}`);
    }
    const j = await res.json();
    const p = j.product;

    await db.from("ebooks").update({
      shopify_product_id: String(p.id), shopify_handle: p.handle, status: "uploaded",
    }).eq("id", ebook_id);

    return new Response(JSON.stringify({ product_id: p.id, handle: p.handle, admin_url: `https://${domain}/admin/products/${p.id}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function markdownToHTML(md: string): string {
  // Minimal markdown → HTML for Shopify body_html
  return md
    .split(/\n\n+/)
    .map((block) => {
      if (/^#+\s/.test(block)) {
        const level = (block.match(/^#+/) ?? [""])[0].length;
        return `<h${Math.min(level + 1, 6)}>${block.replace(/^#+\s*/, "")}</h${Math.min(level + 1, 6)}>`;
      }
      if (/^[-*]\s/m.test(block)) {
        const items = block.split(/\n/).map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
        return `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>`;
      }
      return `<p>${escape(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}
function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
