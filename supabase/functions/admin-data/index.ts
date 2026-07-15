// Admin data fetcher — service role, passcode-gated.
// Returns all data the admin dashboards need in one shot, because
// the admin panel uses passcode auth (no Supabase session), so direct
// RLS-protected reads from the client return empty.
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeQcGates } from "../_shared/qc-gates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const passcode =
    req.headers.get("x-admin-passcode") ??
    (await req.clone().json().then((b) => b?.passcode).catch(() => null));
  if (passcode !== PASSCODE) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { resource?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const resource = body.resource ?? "production";

  try {
    if (resource === "production") {
      const { data: runs, error: runsError, count: runCount } = await supabase
        .from("autopilot_pipeline_runs")
        .select(
          "id,ebook_id,idea_id,status,current_step,current_step_label,current_action_message,current_subtask,progress_percent,started_at,updated_at,last_heartbeat_at,completed_at,admin_needed_reason,error_message,pause_requested,mode,test_mode",
          { count: "exact" },
        )
        .neq("status", "superseded")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (runsError) throw runsError;

      // Defensive dedupe: keep only the newest run per ebook_id so the UI
      // never renders the same ebook (and its cover) twice, even if the
      // supersede trigger hasn't fired yet on a legacy row.
      const seenEbook = new Set<string>();
      const dedupedRuns: typeof runs = [];
      for (const r of (runs ?? [])) {
        const key = (r as { ebook_id: string | null }).ebook_id;
        if (key && seenEbook.has(key)) continue;
        if (key) seenEbook.add(key);
        dedupedRuns.push(r);
      }
      (runs as unknown as unknown[]).length = 0;
      (runs as unknown as unknown[]).push(...dedupedRuns);

      const runRows = runs ?? [];
      const ebookIds = Array.from(
        new Set(runRows.map((x: { ebook_id: string | null }) => x.ebook_id).filter(Boolean)),
      ) as string[];

      let ebookRows: unknown[] = [];
      if (ebookIds.length) {
        const { data, error } = await supabase
          .from("ebooks")
          .select(
            "id,title,autopilot_state,autopilot_mode,listing_status,manuscript_qc_status,pdf_status,word_count,final_quality_score,needs_review_reason,updated_at,worksheet_table_overflow_score,worksheet_previews_json,blocker_class,blocker_reason,next_retry_at,pdf_url,cover_url",
          )
          .in("id", ebookIds);
        if (error) throw error;
        ebookRows = data ?? [];
      }

      const ebookById = new Map(
        (ebookRows as Record<string, unknown>[]).map((ebook) => [ebook.id, ebook]),
      );
      const jobs = runRows.map((run: Record<string, unknown>) => {
        const ebook = ebookById.get(run.ebook_id) as Record<string, unknown> | undefined;
        return {
          id: run.id,
          run_id: run.id,
          ebook_id: run.ebook_id,
          idea_id: run.idea_id,
          source: "autopilot_pipeline_runs",
          title: ebook?.title ?? `Autopilot run ${String(run.id).slice(0, 8)}`,
          autopilot_state: statusToAutopilotState(String(run.status ?? "")),
          autopilot_mode: run.mode ?? ebook?.autopilot_mode ?? null,
          run_status: run.status,
          current_step: run.current_step,
          current_step_label: run.current_step_label,
          current_action_message: run.current_action_message,
          current_subtask: run.current_subtask,
          progress_percent: run.progress_percent,
          pause_requested: run.pause_requested,
          listing_status: ebook?.listing_status ?? null,
          manuscript_qc_status: ebook?.manuscript_qc_status ?? null,
          pdf_status: ebook?.pdf_status ?? null,
          word_count: ebook?.word_count ?? null,
          final_quality_score: ebook?.final_quality_score ?? null,
          needs_review_reason: run.admin_needed_reason ?? run.error_message ?? ebook?.needs_review_reason ?? null,
          admin_needed_reason: run.admin_needed_reason,
          error_message: run.error_message,
          started_at: run.started_at,
          completed_at: run.completed_at,
          updated_at: run.updated_at ?? run.started_at ?? ebook?.updated_at,
          worksheet_table_overflow_score: ebook?.worksheet_table_overflow_score ?? null,
          worksheet_previews_json: ebook?.worksheet_previews_json ?? null,
          blocker_class: ebook?.blocker_class ?? run.blocker_class ?? null,
          blocker_reason: ebook?.blocker_reason ?? run.blocker_reason ?? null,
          next_retry_at: ebook?.next_retry_at ?? run.next_retry_at ?? null,
          pdf_url: ebook?.pdf_url ?? null,
          cover_url: ebook?.cover_url ?? null,
        };
      });

      const { data: orphanEbooks, error: orphanError } = await supabase
        .from("ebooks")
        .select(
          "id,title,autopilot_state,autopilot_mode,listing_status,manuscript_qc_status,pdf_status,word_count,final_quality_score,needs_review_reason,updated_at,worksheet_table_overflow_score,worksheet_previews_json,blocker_class,blocker_reason,next_retry_at,pdf_url,cover_url",
        )
        .not("id", "in", `(${ebookIds.join(",") || "00000000-0000-0000-0000-000000000000"})`)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (orphanError) throw orphanError;
      const orphanJobs = (orphanEbooks ?? []).map((ebook: Record<string, unknown>) => ({
        ...ebook,
        run_id: null,
        ebook_id: ebook.id,
        source: "ebooks",
        run_status: null,
        current_step: ebook.autopilot_state,
        current_step_label: null,
        progress_percent: null,
      }));

      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { data: costs } = await supabase
        .from("cost_log").select("cost_usd").gte("created_at", since.toISOString());
      const cost_today = (costs ?? []).reduce(
        (a, r: { cost_usd: number | null }) => a + Number(r.cost_usd ?? 0), 0,
      );
      return json({
        ebooks: [...jobs, ...orphanJobs],
        jobs: [...jobs, ...orphanJobs],
        totals: {
          autopilot_pipeline_runs: runCount ?? jobs.length,
          ebooks_linked_to_runs: ebookIds.length,
          orphan_ebooks: orphanJobs.length,
        },
        cost_today,
      });
    }

    if (resource === "autopilot_overview") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: runs } = await supabase
        .from("autopilot_pipeline_runs")
        .select(
          "id,ebook_id,status,current_step,current_step_label,current_action_message,current_subtask,progress_percent,started_at,updated_at,last_heartbeat_at,completed_at,admin_needed_reason,error_message,pause_requested,mode,test_mode",
        )
        .or(
          `started_at.gte.${since},status.in.(starting,running,auto_fixing,needs_admin)`,
        )
        .neq("status", "superseded")
        .order("started_at", { ascending: false })
        .limit(50);

      const runsData = runs ?? [];
      const ebookIds = Array.from(
        new Set(runsData.map((x: { ebook_id: string | null }) => x.ebook_id).filter(Boolean)),
      ) as string[];
      let ebooks: unknown[] = [];
      if (ebookIds.length) {
        const { data } = await supabase
          .from("ebooks")
          .select(
            "id,title,listing_status,final_quality_score,cover_url,cover_approved,pdf_url,pdf_status,pdf_generated_at",
          )
          .in("id", ebookIds);
        ebooks = data ?? [];
      }

      const activeRunIds = runsData
        .filter((x: { status: string }) =>
          ["starting", "running", "auto_fixing"].includes(x.status),
        )
        .map((x: { id: string }) => x.id);
      let steps: unknown[] = [];
      if (activeRunIds.length) {
        const { data } = await supabase
          .from("autopilot_pipeline_steps")
          .select(
            "run_id,step_name,step_label,status,score,required_score,auto_fix_attempts,max_auto_fix_attempts,metadata_json,started_at,completed_at",
          )
          .in("run_id", activeRunIds)
          .in("status", ["running", "auto_fixing"])
          .order("started_at", { ascending: false });
        steps = data ?? [];
      }

      const sinceToday = new Date(); sinceToday.setHours(0, 0, 0, 0);
      const [{ data: settings }, { count: produced }, { data: costs }] =
        await Promise.all([
          supabase.from("generation_settings").select("daily_quota").eq("id", 1).maybeSingle(),
          supabase.from("ebooks").select("id", { count: "exact", head: true })
            .gte("created_at", sinceToday.toISOString()),
          supabase.from("cost_log").select("cost_usd").gte("created_at", sinceToday.toISOString()),
        ]);
      return json({
        runs: runsData,
        ebooks,
        steps,
        daily_quota: (settings as { daily_quota?: number } | null)?.daily_quota ?? 0,
        produced_today: produced ?? 0,
        cost_today: (costs ?? []).reduce(
          (a, r: { cost_usd: number | null }) => a + Number(r.cost_usd ?? 0), 0,
        ),
      });
    }

    if (resource === "diagnostics") {
      // Phase 1 canonical tables only. autopilot_runs / production_queue are
      // legacy and intentionally excluded from Command Center diagnostics.
      const [ebc, apc, aps] = await Promise.all([
        supabase.from("ebooks").select("id", { count: "exact", head: true }),
        supabase.from("autopilot_pipeline_runs").select("id", { count: "exact", head: true }),
        supabase.from("autopilot_pipeline_steps").select("id", { count: "exact", head: true }),
      ]);
      return json({
        counts: {
          ebooks: ebc.count ?? 0,
          autopilot_pipeline_runs: apc.count ?? 0,
          autopilot_pipeline_steps: aps.count ?? 0,
        },
        fetched_at: new Date().toISOString(),
      });
    }

    if (resource === "live_queue") {
      // Live Production Queue for the admin dashboard.
      // Historical bug: `canonical_status` was added later and may be NULL on
      // legacy ebooks — the source of truth today is `autopilot_state`. Filter
      // on both, then coalesce so the UI always sees a canonical_status.
      const heavy = [
        "generating_outline", "writing_chapters", "building_manuscript", "running_qc",
        "auto_fixing", "generating_cover", "generating_thumbnail", "rendering_pdf",
        "publishing_live", "production_running",
        "running", "starting",
      ];
      const waiting = [
        "waiting_for_browserless_slot",
        "waiting_for_ai_budget", "waiting_for_worker_slot",
      ];
      const cols =
        "id,title,canonical_status,autopilot_state,queue_position,queued_at,estimated_start_after_run_id,waiting_reason,current_step,current_step_label,current_action_message,current_subtask,progress_pct,last_heartbeat_at,current_qc_score,autofix_attempt,autofix_max,auto_fix_attempt_count,structured_error,blocker_class,blocker_reason,needs_review_reason,next_recommended_action,failed_gate,failed_score,required_score,next_retry_at,cover_url,thumbnail_url,pdf_url,listing_status,updated_at,pdf_qc,cover_qc,reader_experience_qc,pdf_score,cover_score,reader_experience_score,reader_experience_status,reader_experience_fix_count,re_render_reason,re_render_count,re_render_last_at,qc_ready_for_storefront,final_quality_score,word_count,short_hook,body_html,benefit_bullets,whats_inside,who_its_for,who_its_not_for,price,compare_at_price,launch_price,price_tier,seo_title,meta_description,url_slug,tags,pricing_confidence_score,product_page_qc_score,thumbnail_qc_score,subtitle";

      const inList = (v: string[]) =>
        `canonical_status.in.(${v.join(",")}),autopilot_state.in.(${v.join(",")})`;
      const eqEither = (v: string) =>
        `canonical_status.eq.${v},autopilot_state.eq.${v}`;

      const [now, queued, wait, autofix, needsAdmin, needsCode, ready] = await Promise.all([
        supabase.from("ebooks").select(cols).or(inList(heavy))
          .order("last_heartbeat_at", { ascending: false, nullsFirst: false }).limit(5),
        supabase.from("ebooks").select(cols).or(eqEither("queued_for_production"))
          .order("queue_position", { ascending: true, nullsFirst: false })
          .order("queued_at", { ascending: true, nullsFirst: false }).limit(50),
        supabase.from("ebooks").select(cols).or(inList(waiting))
          .order("next_retry_at", { ascending: true, nullsFirst: false }).limit(50),
        supabase.from("ebooks").select(cols).or(eqEither("auto_fixing"))
          .order("updated_at", { ascending: false }).limit(20),
        supabase.from("ebooks").select(cols).or(`${eqEither("needs_admin_attention")},${eqEither("needs_review")},${eqEither("failed_non_recoverable")}`)
          .order("updated_at", { ascending: false }).limit(20),
        supabase.from("ebooks").select(cols).or(eqEither("needs_code_fix"))
          .order("updated_at", { ascending: false }).limit(20),
        // Ready to Publish — 100% complete, PDF ready, not yet published live.
        // NOTE: `.or("...in.(a,b)...")` in supabase-js/PostgREST parses the
        // inner comma as an OR separator and silently returns []. Use two
        // simple `.in()` queries and merge in JS.
        Promise.all([
          supabase.from("ebooks").select(cols + ",final_quality_score,word_count")
            .in("canonical_status", ["ready_to_publish", "completed"])
            .order("updated_at", { ascending: false }).limit(20),
          supabase.from("ebooks").select(cols + ",final_quality_score,word_count")
            .in("autopilot_state", ["done", "ready_to_publish"])
            .order("updated_at", { ascending: false }).limit(20),
        ]).then(([a, b]) => {
          const byId = new Map<string, any>();
          for (const row of [...(a.data ?? []), ...(b.data ?? [])]) byId.set(row.id, row);
          return { data: Array.from(byId.values()), error: a.error ?? b.error };
        }),


      ]);

      // Coalesce canonical_status ← autopilot_state so the UI's badges and
      // queue-position logic work even when the newer column is null, and
      // attach a normalized `qc` snapshot + `re_render` info so the UI can
      // show every premium gate score without recomputing.
      const enrich = (rows: any[] | null | undefined) =>
        (rows ?? []).map((r) => {
          const qc = computeQcGates(r);
          return {
            ...r,
            canonical_status: r.canonical_status ?? r.autopilot_state ?? null,
            qc,
            re_render: {
              count: r.re_render_count ?? 0,
              reason: r.re_render_reason ?? null,
              last_at: r.re_render_last_at ?? null,
            },
          };
        });
      const coalesce = enrich; // back-compat alias

      const { data: fixes } = await supabase
        .from("system_fix_instructions")
        .select("*")
        .eq("status", "open")
        .order("first_seen_at", { ascending: true })
        .limit(50);


      const { data: lock } = await supabase
        .from("production_locks")
        .select("name,holder_ebook_id,holder_run_id,acquired_at,expires_at")
        .eq("name", "heavy_production")
        .maybeSingle();

      return json({
        currently_working_on: coalesce(now.data),
        queued: coalesce(queued.data),
        waiting: coalesce(wait.data),
        auto_fixing: coalesce(autofix.data),
        needs_admin: coalesce(needsAdmin.data),
        needs_code_fix: coalesce(needsCode.data),
        ready_to_publish: coalesce((ready.data ?? []).filter((r: any) => r.listing_status !== "live")),
        system_fixes: fixes ?? [],
        heavy_production_lock: lock ?? null,
        fetched_at: new Date().toISOString(),
      });
    }

    if (resource === "system_fixes") {
      const { data } = await supabase
        .from("system_fix_instructions")
        .select("*")
        .eq("status", "open")
        .order("first_seen_at", { ascending: true })
        .limit(100);
      return json({ fixes: data ?? [] });
    }

    if (resource === "dismiss_fix") {
      const fixId = (body as { fix_id?: string }).fix_id;
      if (!fixId) return json({ error: "fix_id required" }, 400);
      const { error } = await supabase
        .from("system_fix_instructions")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", fixId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (resource === "dismiss_all_fixes") {
      const { error } = await supabase
        .from("system_fix_instructions")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("status", "open");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }


    if (resource === "run_doctor") {
      // Invoke the doctor via internal call; return its report.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autopilot-doctor`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-passcode": PASSCODE,
        },
        body: "{}",
      });
      return json(await res.json(), res.status);
    }


    if (resource === "kids_runs") {
      const [runsRes, weightsRes, statsRes, slowRes, regressionRes] = await Promise.all([
        supabase
          .from("autopilot_kids_runs")
          .select("id, status, current_step_label, progress_percent, blocker_reason, ebook_kids_id, created_at, metadata")
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.from("kids_category_weights").select("*"),
        supabase.rpc("kids_cycle_stats", { p_days: 30 }),
        supabase.from("production_slowdowns")
          .select("id, ebook_kids_id, total_minutes, slowest_stage, slowest_stage_minutes, watchdog_rescues, created_at")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("kids_batch_orders")
          .select("id, status, notes, updated_at")
          .eq("status", "paused")
          .order("updated_at", { ascending: false })
          .limit(1),
      ]);
      if (runsRes.error) throw runsRes.error;
      const statsRow = Array.isArray(statsRes.data) ? statsRes.data[0] : null;
      return json({
        runs: runsRes.data ?? [],
        weights: weightsRes.data ?? [],
        cycle_stats: statsRow ?? null,
        recent_slowdowns: slowRes.data ?? [],
        regression_pause: regressionRes.data?.[0] ?? null,
      });
    }

    if (resource === "kids_archive_diagnosed") {
      // Archive all failed runs older than 5 minutes (protects an in-flight
      // failure the operator hasn't seen yet). Keeps the row, marks archived.
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: updated, error: updErr } = await supabase
        .from("autopilot_kids_runs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ archived_at: new Date().toISOString() } as any)
        .eq("status", "failed")
        .is("archived_at", null)
        .lt("created_at", cutoff)
        .select("id");
      if (updErr) throw updErr;
      return json({ ok: true, archived: updated?.length ?? 0 });
    }

    if (resource === "kids_batch_resume") {
      const { data: order } = await supabase
        .from("kids_batch_orders")
        .select("id")
        .eq("status", "paused")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!order) return json({ ok: true, resumed: 0 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.from("kids_batch_orders") as any)
        .update({ status: "active", notes: "resumed after regression fix" })
        .eq("id", order.id);
      if (upErr) throw upErr;
      return json({ ok: true, resumed: 1, order_id: order.id });
    }

    return json({ error: "unknown resource" }, 400);


  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function statusToAutopilotState(status: string): string {
  if (["starting", "running", "auto_fixing"].includes(status)) return "running";
  if (status === "needs_admin") return "needs_review";
  if (status === "completed") return "ready_to_publish";
  if (status === "failed") return "failed";
  return status || "idle";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
