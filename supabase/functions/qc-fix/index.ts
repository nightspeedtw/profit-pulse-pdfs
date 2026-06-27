// qc-fix: automatically repair an ebook that failed QC, then re-run qc-check.
// Strips unsafe claims, strengthens thin chapters, removes generic AI phrases.
import { corsHeaders, admin, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";

const UNSAFE_REGEX = /(guaranteed|cure|miracle|lose \d+ ?lbs? in|risk[- ]free|get rich|double your|10x your|FDA[- ]approved|secret formula)/gi;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const model = pickModel(settings?.mode ?? "hybrid", "writing");
    const minWords: number = Number(settings?.min_word_count ?? 18000);

    const qc = (e.qc ?? {}) as Record<string, unknown>;
    const unsafe = [
      ...((qc.regex_unsafe as string[]) ?? []),
      ...((qc.unsafe_claims as string[]) ?? []),
    ];
    const generic = (qc.generic_phrases_found as string[]) ?? [];
    const issues = [
      ...(unsafe.length ? [`Remove unsafe claims: ${unsafe.join(", ")}. Replace with educational, hedged language (e.g. "may help", "consider", "consult a qualified professional").`] : []),
      ...(generic.length ? [`Remove generic AI phrases: ${generic.join(", ")}. Replace with specific, concrete language.`] : []),
      `Increase concrete examples, step-by-step instructions, and practical takeaways. No fluff.`,
    ];

    const chapters: { title: string; content: string }[] = e.chapters ?? [];
    let costTotal = 0;
    const fixed: typeof chapters = [];
    const targetPerChapter = Math.max(1500, Math.ceil(minWords / Math.max(chapters.length, 1)));

    for (const ch of chapters) {
      const hasUnsafe = UNSAFE_REGEX.test(ch.content) || unsafe.some((u) => ch.content.toLowerCase().includes(String(u).toLowerCase()));
      const tooThin = (ch.content?.split(/\s+/).length ?? 0) < targetPerChapter * 0.8;
      if (!hasUnsafe && !tooThin && !generic.length) {
        fixed.push(ch);
        continue;
      }
      const ai = await aiText({
        model,
        system: PREMIUM_WRITER_SYSTEM,
        user: `Rewrite this chapter to fix QC issues. Keep premium, specific, practical.

Ebook: "${e.title}" — ${e.subtitle ?? ""}
Reader: ${e.target_buyer ?? ""}

Chapter: "${ch.title}"

Issues to fix:
${issues.map((i) => `- ${i}`).join("\n")}

Current draft:
"""
${(ch.content ?? "").slice(0, 8000)}
"""

HARD REQUIREMENT: minimum ${targetPerChapter} words. American English. Educational tone. Compliance-safe language. No fake stats. No guarantees. Return chapter body only (no title heading).`,
      });
      costTotal += ai.usage.cost_usd;
      await logCost(db, { ebook_id, step: "qc-fix", model: ai.model, ...ai.usage });
      fixed.push({ ...ch, content: ai.data });
    }

    const word_count = fixed.reduce((n, c) => n + (c.content?.split(/\s+/).length ?? 0), 0);

    // Also sanitize product description regex hits
    let product_description = e.product_description ?? "";
    if (product_description) {
      product_description = product_description.replace(UNSAFE_REGEX, (m) => `(${m})`);
    }

    await db.from("ebooks").update({
      chapters: fixed,
      word_count,
      product_description,
      status: "review",
      cost_usd: Number(e.cost_usd) + costTotal,
    }).eq("id", ebook_id);

    // Auto re-run QC
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/qc-check`;
    const auth = req.headers.get("authorization") ?? "";
    const qcRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: auth },
      body: JSON.stringify({ ebook_id }),
    });
    const qcJson = await qcRes.json();

    return new Response(JSON.stringify({ ok: true, rewrote: fixed.length, word_count, qc: qcJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
