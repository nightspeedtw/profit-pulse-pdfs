// seo-publish-approved — moves 'approved' queue items into blog_posts.
// Only blog/guide/comparison have a safe renderer (BlogPost.tsx). Everything
// else stays in the queue for admin review.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const RENDERABLE = new Set(["blog", "guide", "comparison"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { queue_ids, limit = 5 } = await req.json().catch(() => ({}));

  let q = db.from("seo_content_queue").select("*").eq("status", "approved").order("updated_at", { ascending: true }).limit(limit);
  if (Array.isArray(queue_ids) && queue_ids.length) q = db.from("seo_content_queue").select("*").in("id", queue_ids).eq("status", "approved");
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });

  const published: string[] = [];
  const skipped: any[] = [];

  for (const r of rows ?? []) {
    if (!RENDERABLE.has(r.page_type)) { skipped.push({ id: r.id, reason: `no_renderer:${r.page_type}` }); continue; }
    const slug = (r.target_slug ?? "").replace(/^\/blog\//, "").replace(/^\//, "");
    if (!slug) { skipped.push({ id: r.id, reason: "no_slug" }); continue; }

    // Idempotent upsert into blog_posts by slug
    const { error: upErr } = await db.from("blog_posts").upsert({
      slug,
      title: r.title,
      meta_title: r.meta_title,
      meta_description: r.meta_description,
      body_md: r.body_md,
      status: "published",
      published_at: new Date().toISOString(),
      schema_json: r.schema_json,
      faq: r.faq,
      source: "seo_autopilot",
      seo_queue_id: r.id,
    } as any, { onConflict: "slug" });

    if (upErr) { skipped.push({ id: r.id, reason: upErr.message }); continue; }

    await db.from("seo_content_queue").update({
      status: "published",
      published_at: new Date().toISOString(),
    }).eq("id", r.id);

    await db.from("seo_audit_log").insert({
      action: "seo_published", entity_type: "queue", entity_id: r.id,
      after_json: { slug, title: r.title },
    });
    published.push(slug);
  }

  return new Response(JSON.stringify({ ok: true, published, skipped }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
