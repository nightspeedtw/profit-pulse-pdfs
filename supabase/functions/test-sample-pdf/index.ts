// Spawns a sample premium-PDF end-to-end run using a pre-defined fixture idea.
// Inserts an ebook_ideas row and kicks off autopilot-orchestrator in "safe" mode.
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";

const FIXTURE = {
  title: "Debt Free Blueprint",
  subtitle: "A 30-Day System to Escape Credit Card Debt Without Earning More",
  hook: "You're tired of minimum payments going nowhere. This is the exact structure that gets you out — step by step.",
  target_buyer: "US adults aged 28-45 with $5k-$30k in credit card debt who feel stuck despite trying budgeting apps.",
  category_hint: "Personal Finance",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();

    // pick a category if present
    const { data: cat } = await db.from("categories").select("id").ilike("name", "%finance%").limit(1).maybeSingle();

    const { data: idea, error } = await db
      .from("ebook_ideas")
      .insert({
        title: `[TEST] ${FIXTURE.title}`,
        subtitle: FIXTURE.subtitle,
        hook: FIXTURE.hook,
        target_buyer: FIXTURE.target_buyer,
        category_id: cat?.id ?? null,
        status: "approved",
      })
      .select("id")
      .single();
    if (error || !idea) throw new Error(`fixture insert: ${error?.message}`);

    // fire-and-forget the orchestrator with the original caller's auth
    const auth = req.headers.get("Authorization")!;
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autopilot-orchestrator`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ idea_id: idea.id, mode: "safe" }),
    }).catch(() => { /* ignore — orchestrator runs async itself */ });

    return new Response(JSON.stringify({ ok: true, idea_id: idea.id, message: "Test pipeline started. Watch the Pipeline page." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
