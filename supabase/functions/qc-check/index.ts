import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface QCAI { generic_phrases_found: string[]; grammar_issues: number; value_score: number; appeal_score: number; refund_risk: number; unsafe_claims: string[]; summary: string }

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
    const minWords: number = Number(settings?.min_word_count ?? 8000);
    const maxRefund: number = Number(settings?.max_refund_risk ?? 6);

    // 1. Duplicate title check
    const { data: dupes } = await db.from("ebooks").select("id,title").neq("id", ebook_id).ilike("title", e.title);
    const duplicate = (dupes ?? []).length > 0;

    // 2. Regex unsafe claims
    const fullText: string = [e.product_description ?? "", ...(e.chapters ?? []).map((c: { content: string }) => c.content)].join("\n");
    const regexMatches = [...fullText.matchAll(UNSAFE_REGEX)].map((m) => m[0]);

    // 3. LLM review
    const model = pickModel(settings?.mode ?? "hybrid", "qc");
    const sample = (e.chapters ?? []).slice(0, 3).map((c: { title: string; content: string }) => `## ${c.title}\n${c.content.slice(0, 1200)}`).join("\n\n");
    const ai = await aiJSON<QCAI>({
      model,
      system: `You are a strict quality reviewer for premium digital ebooks. You catch generic content, AI tells, vague advice, and unsafe claims. You score honestly — be tough.`,
      user: `Ebook title: ${e.title}\nSubtitle: ${e.subtitle}\nTarget buyer: ${e.target_buyer}\nWord count: ${e.word_count}\n\nSample (first 3 chapters, trimmed):\n${sample}\n\nReview and return JSON:\n{\n  "generic_phrases_found": ["list of generic AI phrases or empty"],\n  "grammar_issues": <integer count of obvious grammar issues in the sample>,\n  "value_score": <1-10, how much real value a paying customer gets>,\n  "appeal_score": <1-10, how appealing/specific the promise is>,\n  "refund_risk": <1-10, likelihood a buyer asks for refund>,\n  "unsafe_claims": ["list of any medical/financial/legal claims that could create liability"],\n  "summary": "one-paragraph honest assessment"\n}`,
    });
    await logCost(db, { ebook_id, step: "qc", model: ai.model, ...ai.usage });

    const qc = {
      duplicate, regex_unsafe: regexMatches,
      ...ai.data,
      word_count_ok: (e.word_count ?? 0) >= minWords,
      min_word_count: minWords,
    };

    const allUnsafe = [...regexMatches, ...(ai.data.unsafe_claims ?? [])];
    const passed =
      !duplicate &&
      (e.word_count ?? 0) >= minWords &&
      allUnsafe.length === 0 &&
      (ai.data.refund_risk ?? 10) <= maxRefund &&
      (ai.data.value_score ?? 0) >= 6;

    const newStatus = passed ? "approved" : "qc_failed";
    await db.from("ebooks").update({ qc, status: newStatus, cost_usd: Number(e.cost_usd) + ai.usage.cost_usd }).eq("id", ebook_id);

    return new Response(JSON.stringify({ status: newStatus, qc, passed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
