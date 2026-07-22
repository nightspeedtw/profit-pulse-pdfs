// seo-autopilot-tick — orchestrator. Respects enabled/emergency_stop/publish_mode
// and daily limits. Seeds clusters, generates drafts, calls QA, optionally publishes.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { draftForCluster } from "../_shared/seo-draft.ts";

declare const Deno: any;

async function callInternal(name: string, body: unknown) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });
  const { drafts_only = false, force = false } = await req.json().catch(() => ({}));
  const started = Date.now();

  const { data: settings } = await db.from("seo_autopilot_settings").select("*").eq("id", true).maybeSingle();
  if (!settings) {
    return new Response(JSON.stringify({ ok: false, error: "settings_missing" }), { status: 500, headers: corsHeaders });
  }
  if (settings.emergency_stop) {
    await db.from("seo_audit_log").insert({ action: "tick_blocked", after_json: { reason: "emergency_stop" } });
    return new Response(JSON.stringify({ ok: true, blocked: "emergency_stop" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!settings.enabled && !force) {
    return new Response(JSON.stringify({ ok: true, blocked: "disabled" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 1) Seed if empty
  const { count: clusterCount } = await db.from("seo_keyword_clusters").select("id", { count: "exact", head: true });
  if ((clusterCount ?? 0) === 0) {
    await callInternal("seo-keyword-seed", {});
  }

  // 2) Daily + monthly budget check (monthly cap is the hard ceiling)
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const monthStartIso = monthStart.toISOString();
  const [{ count: draftedToday }, { count: publishedToday }, { count: publishedThisMonth }] = await Promise.all([
    db.from("seo_content_queue").select("id", { count: "exact", head: true }).gte("created_at", dayAgo).in("status", ["draft","approved","qa_failed"]),
    db.from("seo_content_queue").select("id", { count: "exact", head: true }).gte("published_at", dayAgo).eq("status", "published"),
    db.from("seo_content_queue").select("id", { count: "exact", head: true }).gte("published_at", monthStartIso).eq("status", "published"),
  ]);
  const draftBudget = Math.max(0, (settings.max_draft_pages_per_day ?? 10) - (draftedToday ?? 0));
  const monthlyBudget = Math.max(0, (settings.max_blog_posts_per_month ?? 8) - (publishedThisMonth ?? 0));
  const dailyBudget = Math.max(0, (settings.max_blog_posts_per_day ?? 1) - (publishedToday ?? 0));
  const publishBudget = Math.min(dailyBudget, monthlyBudget);

  // 3) Pick clusters not already drafted today
  const { data: clusters } = await db
    .from("seo_keyword_clusters")
    .select("*")
    .eq("status", "active")
    .order("priority", { ascending: false })
    .limit(draftBudget * 3 + 5);

  const { data: recentQueueRows } = await db.from("seo_content_queue")
    .select("keyword_cluster_id, created_at")
    .gte("created_at", dayAgo);
  const usedClusterIds = new Set((recentQueueRows ?? []).map((r: any) => r.keyword_cluster_id));

  const { data: products } = await db
    .from("ebooks_kids")
    .select("id,title,age_min,age_max,book_type")
    .eq("listing_status", "live")
    .limit(50);
  const productPool = (products ?? []).map((p: any) => ({ id: p.id, title: p.title, age_band: `${p.age_min ?? ""}-${p.age_max ?? ""}` }));

  const draftedNow: string[] = [];
  for (const cluster of clusters ?? []) {
    if (draftedNow.length >= draftBudget) break;
    if (usedClusterIds.has(cluster.id)) continue;
    // Programmatic pages require a real product pool
    if (cluster.target_page_type === "programmatic" && productPool.length === 0) continue;
    // Human review gate: paused seed refresh only; here we skip clusters flagged needs_review
    if (settings.require_human_review_for_new_keyword_clusters && cluster.status === "needs_review") continue;

    const draft = draftForCluster(cluster, productPool);
    const { error } = await db.from("seo_content_queue").insert(draft);
    if (!error) {
      draftedNow.push(cluster.cluster_key);
      await db.from("seo_audit_log").insert({
        action: "seo_draft_created", entity_type: "queue", entity_id: cluster.id,
        after_json: { cluster_key: cluster.cluster_key, target_slug: draft.target_slug },
      });
    }
  }

  // 4) Run QA on everything currently draft/qa_failed
  const qaRes = await callInternal("seo-content-qa", {});

  // 5) Publish (only if mode allows and blog budget available)
  let published: string[] = [];
  if (!drafts_only && settings.publish_mode === "auto_publish_when_passed" && publishBudget > 0) {
    const pubRes = await callInternal("seo-publish-approved", { limit: publishBudget });
    published = (pubRes.body?.published as string[]) ?? [];
  }

  const summary = {
    ok: true,
    duration_ms: Date.now() - started,
    seeded: (clusterCount ?? 0) === 0,
    drafted_now: draftedNow.length,
    draft_budget_remaining: draftBudget - draftedNow.length,
    qa_ran: qaRes.body?.results?.length ?? 0,
    published: published.length,
    publish_mode: settings.publish_mode,
  };
  await db.from("seo_audit_log").insert({ action: "seo_tick", after_json: summary });
  return new Response(JSON.stringify(summary), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
