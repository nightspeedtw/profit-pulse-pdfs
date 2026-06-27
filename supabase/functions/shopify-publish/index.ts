// Flip a Shopify draft product to ACTIVE. Enforces the publish gate first.
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";
import { publishGate } from "../_shared/qc.ts";

const API_VERSION = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id, force = false } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "digital-wealth-hub-49qgj.myshopify.com";
    if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN not set");

    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("ebook not found");
    if (!e.shopify_product_id) throw new Error("ebook has no Shopify draft");

    if (!force) {
      const g = publishGate(e);
      if (!g.pass) {
        await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: g.reasons.join("; ") }).eq("id", ebook_id);
        return new Response(JSON.stringify({ error: "publish gate failed", reasons: g.reasons }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/products/${e.shopify_product_id}.json`, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ product: { id: Number(e.shopify_product_id), status: "active", published: true } }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Shopify ${res.status}: ${t.slice(0, 400)}`);
    }
    await db.from("ebooks").update({
      shopify_status: "published", status: "published", autopilot_state: "done",
    }).eq("id", ebook_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
