// Blog hero backfill — idempotent self-heal for published posts missing a hero image.
// Runs hourly via pg_cron; no-op when nothing needs fixing.
// Uses the same fail-closed provider ladder as blog-autopilot.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateBlogHero, BlogHeroAllProvidersFailedError } from "../_shared/blog-hero-image.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface BlogPostRow {
  id: string;
  slug: string;
  title: string | null;
  dek: string | null;
  primary_keyword: string | null;
  hero_image_url: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const limit = Math.min(20, Number(url.searchParams.get("limit") ?? "5"));

  const { data: posts, error } = await db
    .from("blog_posts")
    .select("id, slug, title, dek, primary_keyword, hero_image_url")
    .eq("status", "published")
    .or("hero_image_url.is.null,hero_image_url.eq.")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) return json({ ok: false, error: error.message }, 500);
  const rows = (posts ?? []) as BlogPostRow[];
  if (!rows.length) return json({ ok: true, backfilled: 0, remaining: 0 });

  const results: Array<{ slug: string; ok: boolean; provider?: string; error?: string }> = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const p of rows) {
    const prompt = [
      p.title ?? p.primary_keyword ?? "coloring pages for kids",
      p.dek ?? "",
      "Editorial magazine style, bright, kid-friendly, printable coloring theme. No text.",
    ].filter(Boolean).join(". ");

    try {
      const result = await generateBlogHero(prompt);
      const ext = result.contentType === "image/png" ? "png" : "jpg";
      const path = `blog/backfill-${today}-${p.id.slice(0, 8)}.${ext}`;
      const { error: upErr } = await db.storage.from("ebook-covers").upload(path, result.bytes, {
        contentType: result.contentType, upsert: true,
      });
      if (upErr) throw new Error(`upload_failed: ${upErr.message}`);
      const heroUrl = `sb:ebook-covers/${path}`;
      const { error: updErr } = await db.from("blog_posts")
        .update({ hero_image_url: heroUrl, last_updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (updErr) throw new Error(`db_update: ${updErr.message}`);
      results.push({ slug: p.slug, ok: true, provider: result.provider });
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ slug: p.slug, ok: false, error: msg.slice(0, 240) });
      try {
        await db.from("alert_log").insert({
          alert_type: "blog_hero_backfill_failed",
          severity: "high",
          message: `${p.slug}: ${msg}`.slice(0, 500),
          metadata: e instanceof BlogHeroAllProvidersFailedError ? { errors: e.errors } : {},
        });
      } catch { /* optional */ }
    }
  }

  const { count: remaining } = await db
    .from("blog_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .or("hero_image_url.is.null,hero_image_url.eq.");

  const backfilled = results.filter((r) => r.ok).length;
  return json({ ok: true, backfilled, attempted: results.length, remaining: remaining ?? null, results });
});
