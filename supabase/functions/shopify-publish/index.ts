// Flip a Shopify draft product to ACTIVE. Enforces the publish gate first.
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";
import { publishGate } from "../_shared/qc.ts";

const API_VERSION = "2025-07";

async function appendEvent(db: ReturnType<typeof admin>, ebook_id: string, ev: { kind: "queued" | "success" | "failed"; action: "push" | "publish"; message?: string; error?: string; meta?: Record<string, unknown> }) {
  const { data: row } = await db.from("ebooks").select("shopify_events").eq("id", ebook_id).single();
  const prev = Array.isArray(row?.shopify_events) ? row!.shopify_events : [];
  const entry = { at: new Date().toISOString(), ...ev };
  const next = [...prev, entry].slice(-30);
  const patch: Record<string, unknown> = {
    shopify_events: next,
    shopify_last_event_at: entry.at,
  };
  if (ev.kind === "failed") patch.shopify_last_error = ev.error ?? ev.message ?? "Unknown error";
  if (ev.kind === "success") patch.shopify_last_error = null;
  await db.from("ebooks").update(patch).eq("id", ebook_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let ebookIdForCatch: string | undefined;
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id, force = false } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");
    ebookIdForCatch = ebook_id;

    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "digital-wealth-hub-49qgj.myshopify.com";
    if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN not set");

    await db.from("ebooks").update({ shopify_status: "publishing" }).eq("id", ebook_id);
    await appendEvent(db, ebook_id, { kind: "queued", action: "publish", message: "Publishing draft to live store…" });

    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("ebook not found");
    if (!e.shopify_product_id) throw new Error("ebook has no Shopify draft");

    if (!force) {
      const g = publishGate(e);
      if (!g.pass) {
        await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: g.reasons.join("; ") }).eq("id", ebook_id);
        throw new Error(`Publish gate failed: ${g.reasons.join("; ")}`);
      }
    }
    // Gate passes — clear any stale needs_review_reason from previous attempts.
    await db.from("ebooks").update({ needs_review_reason: null, autopilot_state: "publishing" }).eq("id", ebook_id);

    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/products/${e.shopify_product_id}.json`, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ product: { id: Number(e.shopify_product_id), status: "active", published: true } }),
    });
    if (!res.ok) {
      const t = await res.text();
      let reason = `Shopify ${res.status}: ${t.slice(0, 400)}`;
      if (res.status === 401 || res.status === 403) {
        reason = `Shopify auth failed (${res.status}) — SHOPIFY_ADMIN_TOKEN is invalid or expired. Update the secret and retry.`;
      }
      await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: reason }).eq("id", ebook_id);
      throw new Error(reason);
    }
    await db.from("ebooks").update({
      shopify_status: "published", status: "published", autopilot_state: "done",
    }).eq("id", ebook_id);
    await appendEvent(db, ebook_id, { kind: "success", action: "publish", message: "Product is now live on Shopify." });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ebookIdForCatch) {
      try {
        const db = admin();
        await db.from("ebooks").update({ shopify_status: "failed" }).eq("id", ebookIdForCatch);
        await appendEvent(db, ebookIdForCatch, { kind: "failed", action: "publish", error: msg.slice(0, 800) });
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
