// One-shot smoke test for Cloudflare Workers AI Flux-1 Schnell.
// Renders a simple coloring-page prompt, checks bytes look like an image
// (JPEG/PNG magic) and computes a cheap solid-black-pixel ratio proxy.
// Admin-only.
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { cloudflareFluxSchnell } from "../_shared/image-providers.ts";

declare const Deno: any;

function magic(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "unknown";
}

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
    // Cheap solid-black proxy: fraction of bytes that are exactly 0x00 in the
    // raw file. Not pixel-accurate, but a coloring page dominated by black
    // (solid-fill failure) trends much higher than a valid line-art page.
    let zeros = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) zeros++;
    const zero_ratio = zeros / bytes.length;
    return j({
      ok: true,
      latency_ms,
      bytes: bytes.byteLength,
      magic: magic(bytes),
      zero_byte_ratio: Number(zero_ratio.toFixed(4)),
      birth_checks: {
        is_image: magic(bytes) !== "unknown",
        not_solid_black_proxy: zero_ratio < 0.6,
      },
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
