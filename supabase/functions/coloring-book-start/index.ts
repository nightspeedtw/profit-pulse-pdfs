// coloring-book-start — DEPRECATED 2026-07-20 (owner cutover to V2 lane).
// Every new coloring book is created via `coloring-v2-start`. This endpoint
// returns 410 Gone with a redirect hint. Rows are preserved; V1 workers are
// no-ops. Do not delete this file — leaving it in place lets old callers
// receive a clear deprecation response instead of a 404.

// @ts-nocheck  Edge runtime.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

declare const Deno: any;

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "coloring_lane_v1_deprecated",
      redirect_to: "coloring-v2-start",
      message: "V1 coloring lane is shelved. Use coloring-v2-start.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
