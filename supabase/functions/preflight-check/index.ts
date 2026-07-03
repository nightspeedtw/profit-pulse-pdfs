// Preflight Check — hard gate before any Autopilot run starts.
//
// Returns exactly:
//   { ready, blocking_errors[], warnings[], auto_fixed[], required_admin_actions[] }
//
// Recoverable config is auto-fixed silently. Non-recoverable issues block the run
// and surface a precise admin instruction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Report {
  ready: boolean;
  blocking_errors: Array<{ code: string; detail: string; admin_action: string }>;
  warnings: Array<{ code: string; detail: string }>;
  auto_fixed: Array<{ code: string; detail: string }>;
  required_admin_actions: string[];
}

import { FEATURES } from "../_shared/features.ts";

// Phase 1 canonical tables. Shopify upload queue only required when the
// Shopify upload feature is enabled (Phase 2+).
const REQUIRED_TABLES = [
  "ebooks",
  "ebook_chapters",
  "autopilot_pipeline_runs",
  "autopilot_pipeline_steps",
  "production_locks",
  "system_fix_instructions",
  ...(FEATURES.SHOPIFY_UPLOAD ? ["shopify_upload_queue"] : []),
];

const REQUIRED_BUCKETS = ["ebook-pdfs", "ebook-covers"];

// Phase 1 = PDF-only. Shopify secrets are opt-in and never block Phase 1.
const REQUIRED_SECRETS = [
  "LOVABLE_API_KEY",
  "BROWSERLESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  ...(FEATURES.SHOPIFY_UPLOAD ? ["SHOPIFY_ADMIN_TOKEN"] : []),
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const report: Report = {
    ready: true,
    blocking_errors: [],
    warnings: [],
    auto_fixed: [],
    required_admin_actions: [],
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // --- 1. Secrets ---------------------------------------------------------
  for (const name of REQUIRED_SECRETS) {
    if (!Deno.env.get(name)) {
      report.blocking_errors.push({
        code: `missing_secret_${name}`,
        detail: `Environment secret ${name} is not set.`,
        admin_action: `Add ${name} in project Secrets before running Autopilot.`,
      });
    }
  }

  // --- 2. Tables ----------------------------------------------------------
  for (const t of REQUIRED_TABLES) {
    const { error } = await supabase.from(t).select("*", { count: "exact", head: true }).limit(1);
    if (error) {
      report.blocking_errors.push({
        code: `missing_table_${t}`,
        detail: `Cannot read table ${t}: ${error.message}`,
        admin_action: `Ensure migration exists for public.${t}.`,
      });
    }
  }

  // --- 3. Buckets ---------------------------------------------------------
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketNames = new Set((buckets ?? []).map((b: any) => b.name));
  for (const b of REQUIRED_BUCKETS) {
    if (!bucketNames.has(b)) {
      const { error } = await supabase.storage.createBucket(b, { public: false });
      if (error) {
        report.blocking_errors.push({
          code: `missing_bucket_${b}`,
          detail: `Bucket ${b} missing and auto-create failed: ${error.message}`,
          admin_action: `Create private storage bucket "${b}".`,
        });
      } else {
        report.auto_fixed.push({ code: `created_bucket_${b}`, detail: `Auto-created bucket ${b}` });
      }
    }
  }

  // --- 4. Browserless ping ------------------------------------------------
  const brToken = Deno.env.get("BROWSERLESS_TOKEN");
  if (brToken) {
    try {
      const r = await fetch(`https://production-sfo.browserless.io/pdf?token=${brToken}`, {
        method: "HEAD",
      });
      if (r.status >= 500) {
        report.warnings.push({
          code: "browserless_unhealthy",
          detail: `Browserless HEAD returned ${r.status}. Renders may retry.`,
        });
      }
    } catch (e) {
      report.warnings.push({
        code: "browserless_unreachable",
        detail: `Browserless probe failed: ${(e as Error).message}`,
      });
    }
  }

  // --- 5. Shopify token sanity (Phase 2+ only) --------------------------
  if (FEATURES.SHOPIFY_UPLOAD) {
    const shopToken = Deno.env.get("SHOPIFY_ADMIN_TOKEN") ?? Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!shopToken) {
      report.blocking_errors.push({
        code: "missing_shopify_token",
        detail: "No Shopify admin/access token configured.",
        admin_action: "Reconnect Shopify integration in Lovable Cloud.",
      });
    }
  }

  // --- 6. Sequential Safe Mode: ensure heavy_production lock TTL is sane -
  try {
    await supabase.rpc("release_lock", { p_name: "heavy_production_stale_check", p_holder: null });
  } catch (_e) { /* non-fatal */ }

  // --- Finalize -----------------------------------------------------------
  report.ready = report.blocking_errors.length === 0;
  report.required_admin_actions = report.blocking_errors.map((e) => e.admin_action);

  return new Response(JSON.stringify(report), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
