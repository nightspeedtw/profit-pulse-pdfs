// Admin data fetcher — service role, passcode-gated.
// Returns all data the admin dashboards need in one shot, because
// the admin panel uses passcode auth (no Supabase session), so direct
// RLS-protected reads from the client return empty.
import { createClient } from "npm:@supabase/supabase-js@2";

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
        .order("updated_at", { ascending: false })
        .limit(500);
      if (runsError) throw runsError;

      const runRows = runs ?? [];
      const ebookIds = Array.from(
        new Set(runRows.map((x: { ebook_id: string | null }) => x.ebook_id).filter(Boolean)),
      ) as string[];

      let ebookRows: unknown[] = [];
      if (ebookIds.length) {
        const { data, error } = await supabase
          .from("ebooks")
          .select(
            "id,title,autopilot_state,autopilot_mode,shopify_status,shopify_product_id,manuscript_qc_status,pdf_status,word_count,final_quality_score,needs_review_reason,updated_at,worksheet_table_overflow_score,worksheet_previews_json,blocker_class,blocker_reason,next_retry_at,pdf_url,cover_url",
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
          shopify_status: ebook?.shopify_status ?? null,
          shopify_product_id: ebook?.shopify_product_id ?? null,
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
        };
      });

      const { data: orphanEbooks, error: orphanError } = await supabase
        .from("ebooks")
        .select(
          "id,title,autopilot_state,autopilot_mode,shopify_status,manuscript_qc_status,pdf_status,word_count,final_quality_score,needs_review_reason,updated_at,worksheet_table_overflow_score,worksheet_previews_json",
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
            "id,title,shopify_status,shopify_product_id,final_quality_score,cover_url,cover_approved,pdf_url,pdf_status,pdf_generated_at",
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
      const [ebc, arc, apc, aps, pqc] = await Promise.all([
        supabase.from("ebooks").select("id", { count: "exact", head: true }),
        supabase.from("autopilot_runs").select("id", { count: "exact", head: true }),
        supabase.from("autopilot_pipeline_runs").select("id", { count: "exact", head: true }),
        supabase.from("autopilot_pipeline_steps").select("id", { count: "exact", head: true }),
        supabase.from("production_queue").select("id", { count: "exact", head: true }),
      ]);
      return json({
        counts: {
          ebooks: ebc.count ?? 0,
          autopilot_runs: arc.count ?? 0,
          autopilot_pipeline_runs: apc.count ?? 0,
          autopilot_pipeline_steps: aps.count ?? 0,
          production_queue: pqc.count ?? 0,
        },
        fetched_at: new Date().toISOString(),
      });
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
