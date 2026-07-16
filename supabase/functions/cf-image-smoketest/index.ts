// One-shot smoke test for Cloudflare Workers AI Flux-1 Schnell.
// Renders a simple coloring-page prompt, runs verify-at-birth + solid-black
// check, reports latency. Intended for manual admin invocation only.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { cloudflareFluxSchnell } from "../_shared/image-providers.ts";
import { verifyImageAtBirth } from "../_shared/coloring/verify-at-birth.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const hasAcct = !!Deno.env.get("CF_ACCOUNT_ID");
  const hasTok = !!Deno.env.get("CF_API_TOKEN");
  if (!hasAcct || !hasTok) {
    return j({
      ok: false,
      missing: [hasAcct ? null : "CF_ACCOUNT_ID", hasTok ? null : "CF_API_TOKEN"].filter(Boolean),
    }, 424);
  }

  const started = Date.now();
  try {
    const bytes = await cloudflareFluxSchnell({
      prompt:
        "Simple coloring book page line art for kids: a friendly smiling puppy sitting in grass, thick clean black outlines, pure white background, no shading, no letters or words, generous safe margins, single centered subject.",
      num_inference_steps: 4,
      step: "cf_smoketest",
    });
    const latency_ms = Date.now() - started;
    let verify: unknown = null;
    let verify_error: string | null = null;
    try {
      verify = await verifyImageAtBirth(bytes, { kind: "coloring_interior" });
    } catch (e) {
      verify_error = (e as Error).message;
    }
    return j({
      ok: true,
      latency_ms,
      bytes: bytes.byteLength,
      verify,
      verify_error,
    });
  } catch (e) {
    return j({
      ok: false,
      latency_ms: Date.now() - started,
      error: (e as Error).message,
      class: (e as any)?.kind ?? (e as any)?.constructor?.name ?? null,
    }, 500);
  }
});
