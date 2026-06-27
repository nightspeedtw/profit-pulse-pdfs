import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { improveIdea, applyImprovement } from "../_shared/improve.ts";

interface Scores { urgency: number; transformation: number; commercial: number; evergreen: number; emotional: number; clarity: number }
interface IdeaOut { title: string; subtitle: string; target_buyer: string; hook: string; scores: Scores; rationale: string }
interface Batch { ideas: IdeaOut[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const requestedCount: number = Math.min(Math.max(Number(body.count ?? 5), 1), 20);

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const threshold: number = Number(settings?.min_score_threshold ?? 35);

    // Pick a category (round-robin among enabled)
    let categoryId: string | null = body.category_id ?? null;
    if (!categoryId) {
      const enabled: string[] = settings?.enabled_category_ids ?? [];
      if (enabled.length > 0) {
        categoryId = enabled[Math.floor(Math.random() * enabled.length)];
      } else {
        const { data: any1 } = await db.from("categories").select("id").eq("enabled", true).limit(1).maybeSingle();
        categoryId = any1?.id ?? null;
      }
    }
    if (!categoryId) throw new Error("No categories available. Add one first.");
    const { data: cat } = await db.from("categories").select("*").eq("id", categoryId).single();

    const { data: existing } = await db.from("ebook_ideas").select("title").order("created_at", { ascending: false }).limit(50);
    const existingTitles = (existing ?? []).map((r) => r.title).join("\n");

    const model = pickModel(mode, "ideation");
    const sys = `You are a premium digital-ebook strategist for the Printly brand.
You generate ebook concepts that real people would pay $20-30 for and recommend to friends.
QUALITY OVER QUANTITY. Every concept must be specific, useful, and emotionally compelling — never generic or spammy.`;
    const user = `Generate ${requestedCount} distinct premium ebook concepts for the "${cat?.name}" category.
Category notes: ${cat?.description ?? ""}.

For each, return:
- title (clear, specific, benefit-driven, 4-9 words)
- subtitle (one sentence explaining the transformation)
- target_buyer (one sentence: who exactly, why they need it now)
- hook (an honest, emotional one-liner promise — NO get-rich-quick / NO medical claims)
- scores (1-10 integers): urgency (does it solve urgent pain?), transformation (clear before/after?), commercial (will people pay $24+?), evergreen (will sell in 2 years?), emotional (does it speak to identity/desire?), clarity (is the promise instantly understandable?)
- rationale (one sentence on why this beats generic ebooks in this category)

AVOID titles already in the system:
${existingTitles}

AVOID generic patterns: "Ultimate Guide to X", "X for Beginners", "X 101", "Mastering X". Be specific and unusual.
Return JSON: { "ideas": [ ... ${requestedCount} items ... ] }`;

    const ai = await aiJSON<Batch>({ system: sys, user, model });
    await logCost(db, { idea_id: null, step: "generate-idea", model: ai.model, ...ai.usage });

    const created: string[] = [];
    for (const idea of (ai.data.ideas ?? [])) {
      const s = idea.scores ?? { urgency: 0, transformation: 0, commercial: 0, evergreen: 0, emotional: 0, clarity: 0 };
      const total = (s.urgency + s.transformation + s.commercial + s.evergreen + s.emotional + s.clarity);
      const status = total >= threshold ? "idea" : "rejected";
      const { data: row } = await db.from("ebook_ideas").insert({
        category_id: categoryId,
        title: idea.title, subtitle: idea.subtitle,
        target_buyer: idea.target_buyer, hook: idea.hook,
        scores: s, total_score: total, status,
        notes: idea.rationale, cost_usd: ai.usage.cost_usd / Math.max(ai.data.ideas?.length ?? 1, 1),
        // Preserve the raw generation as the canonical "raw" version.
        raw_title: idea.title, raw_subtitle: idea.subtitle,
        raw_hook: idea.hook, raw_target_buyer: idea.target_buyer,
      }).select("id").single();
      if (!row?.id) continue;
      created.push(row.id);

      // Auto Improve Level 1 — always run, so admin never sees the raw idea by default.
      if (status === "idea") {
        try {
          const result = await improveIdea({
            id: row.id, title: idea.title, subtitle: idea.subtitle,
            target_buyer: idea.target_buyer, hook: idea.hook, total_score: total,
            category: { name: cat?.name, description: cat?.description },
            round: 0, action: "all", mode,
          });
          await applyImprovement(db, row.id, {
            title: idea.title, subtitle: idea.subtitle, hook: idea.hook, target_buyer: idea.target_buyer,
            raw_title: null, improvement_round: 0, notes: idea.rationale,
          }, result, { source: "auto-level-1", action: "all" });
        } catch (_e) {
          // Auto-improve failure is non-fatal — raw idea remains for admin to retry.
        }
      }
    }


    return new Response(JSON.stringify({ created: created.length, ids: created, model: ai.model, cost_usd: ai.usage.cost_usd }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
