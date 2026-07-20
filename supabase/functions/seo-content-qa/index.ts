// seo-content-qa — validate one or more queue items, write scores + findings.
// POST { queue_ids?: string[] }  (empty = every draft/qa_failed row)
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runQa, passesGates } from "../_shared/seo-qa.ts";

declare const Deno: any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { queue_ids } = await req.json().catch(() => ({}));

  let q = db.from("seo_content_queue").select("*").in("status", ["draft","drafting","qa_failed"]);
  if (Array.isArray(queue_ids) && queue_ids.length) q = db.from("seo_content_queue").select("*").in("id", queue_ids);
  const { data: items, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });

  // Load slugs / titles for cannibalization.
  const [{ data: slugRows }, { data: blogRows }] = await Promise.all([
    db.from("seo_content_queue").select("target_slug,title,id"),
    db.from("blog_posts").select("slug,title"),
  ]);
  const results: any[] = [];

  for (const it of items ?? []) {
    const otherSlugs = [
      ...(slugRows ?? []).filter((r: any) => r.id !== it.id && r.target_slug).map((r: any) => r.target_slug.toLowerCase()),
      ...(blogRows ?? []).filter((r: any) => r.slug).map((r: any) => r.slug.toLowerCase()),
    ];
    const otherTitles = [
      ...(slugRows ?? []).filter((r: any) => r.id !== it.id && r.title).map((r: any) => r.title),
      ...(blogRows ?? []).filter((r: any) => r.title).map((r: any) => r.title),
    ];
    const { data: cluster } = await db.from("seo_keyword_clusters").select("*").eq("id", it.keyword_cluster_id).maybeSingle();
    const scores = runQa(it, cluster ?? { primary_keyword: "" }, { existingSlugs: otherSlugs, existingTitles: otherTitles });
    const gatePass = passesGates(scores);
    const newStatus = gatePass ? "approved" : "qa_failed";

    const { error: uerr } = await db.from("seo_content_queue").update({
      seo_score: scores.seo_score,
      aeo_score: scores.aeo_score,
      geo_score: scores.geo_score,
      duplicate_risk_score: scores.duplicate_risk_score,
      qa_findings: scores.findings,
      word_count: scores.word_count,
      status: newStatus,
    }).eq("id", it.id);
    if (uerr) { results.push({ id: it.id, error: uerr.message }); continue; }

    await db.from("seo_audit_log").insert({
      action: "seo_content_qa",
      entity_type: "queue",
      entity_id: it.id,
      after_json: { seo: scores.seo_score, aeo: scores.aeo_score, geo: scores.geo_score, dup: scores.duplicate_risk_score, status: newStatus, findings: scores.findings.length },
    });

    results.push({ id: it.id, status: newStatus, ...scores });
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
