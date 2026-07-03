// Look up an order by Stripe checkout session id and return its download grants
// (so the checkout return page can show download buttons without waiting for
// the buyer to check email).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("session_id required");
    const { data: order } = await supabase
      .from("orders")
      .select("id, buyer_email, amount_total, currency, status, paid_at")
      .eq("stripe_session_id", session_id)
      .maybeSingle();
    if (!order) {
      return new Response(JSON.stringify({ status: "pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: grants } = await supabase
      .from("download_grants")
      .select("token, ebook_id, expires_at, download_count, max_downloads, ebooks:ebook_id(title, cover_url)")
      .eq("order_id", order.id);
    return new Response(JSON.stringify({ status: "ready", order, grants: grants ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
