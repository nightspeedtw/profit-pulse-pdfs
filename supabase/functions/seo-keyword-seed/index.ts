// seo-keyword-seed — idempotent seeding of curated SEO clusters.
// Never creates duplicates (deduped by cluster_key). Safe to run any time.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SEED_CLUSTERS } from "../_shared/seo-seed-clusters.ts";

declare const Deno: any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  const inserted: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const cluster of SEED_CLUSTERS) {
    try {
      const { data: existing } = await db
        .from("seo_keyword_clusters")
        .select("id, source, status")
        .eq("cluster_key", cluster.cluster_key)
        .maybeSingle();

      const row = {
        cluster_key: cluster.cluster_key,
        cluster_name: cluster.cluster_name,
        search_intent: cluster.search_intent,
        priority: cluster.priority,
        source: "seed",
        primary_keyword: cluster.primary_keyword,
        secondary_keywords: cluster.secondary_keywords ?? [],
        competitor_keywords: cluster.competitor_keywords ?? [],
        negative_keywords: cluster.negative_keywords ?? [],
        target_page_type: cluster.target_page_type,
        min_word_count: cluster.min_word_count ?? 700,
        max_word_count: cluster.max_word_count ?? 1400,
        recommended_images: cluster.recommended_images ?? 5,
        aeo_questions: cluster.aeo_questions ?? [],
        geo_evidence_points: cluster.geo_evidence_points ?? [],
      };

      if (!existing) {
        const { error } = await db.from("seo_keyword_clusters").insert({ ...row, status: "active" });
        if (error) throw error;
        inserted.push(cluster.cluster_key);
      } else if (existing.source === "seed") {
        // Refresh seed rows only; admin edits (source='admin') are preserved.
        const { error } = await db
          .from("seo_keyword_clusters")
          .update(row)
          .eq("id", existing.id);
        if (error) throw error;
        updated.push(cluster.cluster_key);
      } else {
        skipped.push(cluster.cluster_key);
      }
    } catch (e) {
      errors.push(`${cluster.cluster_key}:${(e as Error).message}`);
    }
  }

  await db.from("seo_audit_log").insert({
    action: "seo_keyword_seed",
    entity_type: "batch",
    after_json: { inserted: inserted.length, updated: updated.length, skipped: skipped.length, errors: errors.length },
  });

  return new Response(
    JSON.stringify({ ok: errors.length === 0, inserted, updated, skipped, errors, total: SEED_CLUSTERS.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
