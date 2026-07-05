// Premium Book Title Psychology & Marketing Expert.
//
// Runs BEFORE ebook writing. Produces the full premium title package and
// scores it against strict marketing thresholds. Retries up to 3 attempts.
// If all attempts fail the gate, the autopilot pipeline blocks ebook
// generation until an admin resolves it.
//
// POST { idea_id: string }
// Response: { ok: boolean, attempts, scores, package, blocker_reason? }
import { admin, aiJSON, corsHeaders, logCost, pickModel, requireAdmin } from "../_shared/ai.ts";
import { checkPremiumTitle } from "../_shared/title-guard.ts";

// Deterministic premium-positioning token injection.
// Used ONLY when the sole guard failure is `missing_premium_positioning_token`
// AND every numeric score already clears the strict gate. This preserves QC:
// we do not lower any threshold — we only add a token the LLM forgot.
const PREFERRED_INJECT_TOKENS = ["Blueprint", "Playbook", "System", "Protocol", "Framework"] as const;

function injectPremiumToken(title: string): string {
  const t = (title ?? "").trim().replace(/[.!?]+$/, "");
  if (!t) return t;
  // Prefer inserting before a colon so subtitle stays clean:
  //   "The 5-PM Panic Exit Strategy: ..."  ->  "The 5-PM Panic Exit Blueprint: ..."
  const colonIdx = t.indexOf(":");
  const head = colonIdx > 0 ? t.slice(0, colonIdx).trim() : t;
  const tail = colonIdx > 0 ? t.slice(colonIdx) : "";
  // Swap a weak trailing noun for a premium one when possible.
  const swapRx = /\b(strategy|guide|handbook|manual|approach|method|plan|tips|advice|tricks|hacks|secrets)\b\s*$/i;
  if (swapRx.test(head)) {
    return head.replace(swapRx, "Blueprint") + tail;
  }
  return `${head} Blueprint${tail}`;
}

// ---- Strict gate thresholds (per Premium Marketing Expert spec) ----
const GATE = {
  title_quality_min: 85,
  buyer_pain_match_min: 85,
  premium_feel_min: 85,
  shopify_click_appeal_min: 85,
  compliance_risk_max: 4,
};
const MAX_ATTEMPTS = 3;

interface PremiumTitlePackage {
  recommended_title: string;
  subtitle: string;
  primary_hook: string;
  target_buyer: string;
  buyer_pain: string;
  transformation_promise: string;
  premium_positioning: string;
  shopify_product_title: string;
  seo_title: string;
  url_slug: string;
  title_quality_score: number;
  buyer_pain_match: number;
  premium_feel: number;
  shopify_click_appeal: number;
  compliance_risk_score: number;
  weaknesses: string[];
}

const SYSTEM = `You are the world's #1 Premium Ebook Title Psychology & Marketing Expert for the USA market.
You write titles that: (1) trigger identity + pain recognition instantly, (2) feel premium and worth $19–$29,
(3) drive Shopify click-through, (4) rank in search, (5) contain ZERO fake guarantees or unsafe claims.

You always self-score honestly. If a score is below the bar you say so and lower it — do not inflate.
American English only. Educational tone for sensitive topics (finance, health, legal, relationships).
Respond with valid JSON only. No markdown fences.`;

function buildPrompt(opts: {
  category: string;
  categoryDesc: string;
  seedIdea: {
    title?: string; subtitle?: string; hook?: string;
    target_buyer?: string; core_pain_point?: string;
    transformation_promise?: string;
  };
  attempt: number;
  previousWeaknesses: string[];
}) {
  const feedback = opts.previousWeaknesses.length
    ? `\nPREVIOUS ATTEMPT FAILED THE GATE. Fix these weaknesses:\n- ${opts.previousWeaknesses.join("\n- ")}\n`
    : "";
  return `Produce the STRONGEST premium marketable title package for a $19–$29 PDF ebook.
Category: ${opts.category} — ${opts.categoryDesc}

Seed concept (improve, do not just copy):
- Title: ${opts.seedIdea.title ?? ""}
- Subtitle: ${opts.seedIdea.subtitle ?? ""}
- Hook: ${opts.seedIdea.hook ?? ""}
- Target buyer: ${opts.seedIdea.target_buyer ?? ""}
- Core pain: ${opts.seedIdea.core_pain_point ?? ""}
- Transformation: ${opts.seedIdea.transformation_promise ?? ""}
${feedback}
Attempt ${opts.attempt}/${MAX_ATTEMPTS}. Every score must clear:
- title_quality_score >= 85
- buyer_pain_match >= 85
- premium_feel >= 85
- shopify_click_appeal >= 85
- compliance_risk_score <= 4 (1 safest .. 10 riskiest)

HARD TITLE RULES (both recommended_title AND shopify_product_title MUST comply):
- MUST include at least one premium positioning token (case-insensitive):
  Blueprint, Playbook, Protocol, Framework, System, Operating System, Method,
  Formula, Toolkit, Field Guide, Reset Plan, Exit Strategy, Escape Plan,
  Recovery Plan, Roadmap, Engine, Stack, Doctrine, Vault, Fortress, Shield,
  Advantage, Edge, Arsenal, Mastery
  — OR an explicit outcome+timeframe (e.g. "The 6-Month Debt Exit Strategy").
- Do NOT use generic leaders ("How to", "The Ultimate", "A Guide to",
  "Beginner's Guide", "Everything You Need to Know").
- Do NOT use weak/blog words (tips, tricks, hacks, secrets, basics, simple, easy).
- 3–16 words, <= 70 characters.


Return JSON in EXACTLY this shape (no extra fields, no markdown):
{
  "recommended_title": "premium, hard-sell, emotionally specific, <= 70 chars",
  "subtitle": "clarifies transformation + who it's for, <= 120 chars",
  "primary_hook": "one hard-sell sentence under 35 words",
  "target_buyer": "specific USA persona — age/role/situation",
  "buyer_pain": "concrete pain in the buyer's own words",
  "transformation_promise": "believable outcome — never guaranteed",
  "premium_positioning": "why this is worth $19–$29 vs free info",
  "shopify_product_title": "Shopify listing title, includes buyer + outcome, <= 70 chars",
  "seo_title": "Google-optimized title with primary keyword, <= 60 chars",
  "url_slug": "lowercase-hyphenated, no stopwords, 3–7 words",
  "title_quality_score": 0,
  "buyer_pain_match": 0,
  "premium_feel": 0,
  "shopify_click_appeal": 0,
  "compliance_risk_score": 1,
  "weaknesses": ["list every weakness you can still see, or [] if none"]
}`;
}

const UNSAFE = [
  /guarantee[d]?\s+(income|return|results?|profit|cure|outcome|weight\s*loss)/i,
  /100%\s+(safe|guaranteed|cure)/i,
  /risk[-\s]?free/i,
  /miracle\s+(cure|drug|results?)/i,
  /lose\s+\d+\s*(lbs?|kg|pounds)\s+in\s+\d+\s*(days?|weeks?)/i,
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function validatePackage(raw: unknown): PremiumTitlePackage {
  if (!raw || typeof raw !== "object") throw new Error("Expert did not return an object");
  const x = raw as Record<string, unknown>;
  const s = (k: string) => typeof x[k] === "string" ? (x[k] as string).trim() : "";
  const n = (k: string) => {
    const v = Number(x[k]);
    return Number.isFinite(v) ? Math.round(v) : 0;
  };
  const pkg: PremiumTitlePackage = {
    recommended_title: s("recommended_title"),
    subtitle: s("subtitle"),
    primary_hook: s("primary_hook"),
    target_buyer: s("target_buyer"),
    buyer_pain: s("buyer_pain"),
    transformation_promise: s("transformation_promise"),
    premium_positioning: s("premium_positioning"),
    shopify_product_title: s("shopify_product_title") || s("recommended_title"),
    seo_title: s("seo_title") || s("recommended_title"),
    url_slug: slugify(s("url_slug") || s("recommended_title")),
    title_quality_score: Math.max(0, Math.min(100, n("title_quality_score"))),
    buyer_pain_match: Math.max(0, Math.min(100, n("buyer_pain_match"))),
    premium_feel: Math.max(0, Math.min(100, n("premium_feel"))),
    shopify_click_appeal: Math.max(0, Math.min(100, n("shopify_click_appeal"))),
    compliance_risk_score: Math.max(1, Math.min(10, n("compliance_risk_score") || 1)),
    weaknesses: Array.isArray(x.weaknesses) ? (x.weaknesses as unknown[]).map(String) : [],
  };
  if (!pkg.recommended_title) throw new Error("empty recommended_title");
  if (!pkg.primary_hook) throw new Error("empty primary_hook");
  if (!pkg.target_buyer) throw new Error("empty target_buyer");
  if (!pkg.buyer_pain) throw new Error("empty buyer_pain");
  if (!pkg.transformation_promise) throw new Error("empty transformation_promise");
  return pkg;
}

function gate(p: PremiumTitlePackage): { passed: boolean; reasons: string[] } {
  const r: string[] = [];
  const unsafe = [p.recommended_title, p.subtitle, p.primary_hook, p.transformation_promise, p.premium_positioning]
    .some((t) => UNSAFE.some((re) => re.test(t)));
  if (unsafe) r.push("unsafe_claim_detected");
  const guard = checkPremiumTitle(p.recommended_title);
  if (!guard.ok) r.push(`generic_title:${guard.reasons.join(",")}`);
  const shopGuard = checkPremiumTitle(p.shopify_product_title);
  if (!shopGuard.ok) r.push(`generic_shopify_title:${shopGuard.reasons.join(",")}`);
  if (p.title_quality_score < GATE.title_quality_min) r.push(`title_quality=${p.title_quality_score}<85`);
  if (p.buyer_pain_match < GATE.buyer_pain_match_min) r.push(`buyer_pain_match=${p.buyer_pain_match}<85`);
  if (p.premium_feel < GATE.premium_feel_min) r.push(`premium_feel=${p.premium_feel}<85`);
  if (p.shopify_click_appeal < GATE.shopify_click_appeal_min) r.push(`shopify_click_appeal=${p.shopify_click_appeal}<85`);
  if (p.compliance_risk_score > GATE.compliance_risk_max) r.push(`compliance_risk=${p.compliance_risk_score}>4`);
  return { passed: r.length === 0, reasons: r };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const idea_id = String(body.idea_id ?? "");
    if (!idea_id) throw new Error("idea_id is required");

    const { data: idea, error: iErr } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (iErr || !idea) throw new Error(`idea not found: ${iErr?.message}`);

    const { data: cat } = idea.category_id
      ? await db.from("categories").select("name,description").eq("id", idea.category_id).single()
      : { data: null };

    const { data: settings } = await db.from("generation_settings").select("mode").eq("id", 1).maybeSingle();
    const model = pickModel(settings?.mode ?? "hybrid", "marketing");

    let previousWeaknesses: string[] = [];
    let best: { pkg: PremiumTitlePackage; reasons: string[] } | null = null;
    const attemptLogs: Array<{ attempt: number; passed: boolean; scores: Record<string, number>; reasons: string[] }> = [];
    let totalCost = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ai = await aiJSON<unknown>({
        system: SYSTEM,
        user: buildPrompt({
          category: cat?.name ?? "General",
          categoryDesc: cat?.description ?? "",
          seedIdea: {
            title: idea.title, subtitle: idea.subtitle, hook: idea.hook,
            target_buyer: idea.target_buyer, core_pain_point: idea.core_pain_point,
            transformation_promise: idea.transformation_promise,
          },
          attempt,
          previousWeaknesses,
        }),
        model,
      });
      totalCost += ai.usage.cost_usd;
      await logCost(db, { idea_id, step: `premium-title-expert:attempt_${attempt}`, model: ai.model, ...ai.usage });

      let pkg: PremiumTitlePackage;
      try { pkg = validatePackage(ai.data); }
      catch (e) {
        previousWeaknesses = [`malformed_output: ${(e as Error).message}`];
        attemptLogs.push({ attempt, passed: false, scores: {}, reasons: previousWeaknesses });
        continue;
      }
      let g = gate(pkg);

      // ---- Deterministic premium-token injection (does NOT lower QC) ----
      // If the ONLY guard failure is `missing_premium_positioning_token` and
      // every numeric score already clears the strict gate, deterministically
      // inject a token (e.g. "Blueprint") and re-run the guard. Do not touch
      // any threshold; if the new title still fails, we keep the failure.
      const onlyMissingToken = (reasons: string[]) =>
        reasons.length > 0 && reasons.every((r) =>
          r === "generic_title:missing_premium_positioning_token" ||
          r === "generic_shopify_title:missing_premium_positioning_token"
        );
      const scoresClear =
        pkg.title_quality_score >= GATE.title_quality_min &&
        pkg.buyer_pain_match >= GATE.buyer_pain_match_min &&
        pkg.premium_feel >= GATE.premium_feel_min &&
        pkg.shopify_click_appeal >= GATE.shopify_click_appeal_min &&
        pkg.compliance_risk_score <= GATE.compliance_risk_max;
      if (!g.passed && onlyMissingToken(g.reasons) && scoresClear) {
        const beforeTitle = pkg.recommended_title;
        const beforeShop = pkg.shopify_product_title;
        pkg.recommended_title = injectPremiumToken(pkg.recommended_title);
        pkg.shopify_product_title = injectPremiumToken(pkg.shopify_product_title);
        pkg.url_slug = slugify(pkg.url_slug || pkg.recommended_title);
        const g2 = gate(pkg);
        if (g2.passed) {
          console.log(`[premium-title-expert] token-injected: "${beforeTitle}" -> "${pkg.recommended_title}" | "${beforeShop}" -> "${pkg.shopify_product_title}"`);
          g = g2;
        } else {
          // Revert if the injection somehow made things worse.
          pkg.recommended_title = beforeTitle;
          pkg.shopify_product_title = beforeShop;
        }
      }

      const scores = {
        title_quality_score: pkg.title_quality_score,
        buyer_pain_match: pkg.buyer_pain_match,
        premium_feel: pkg.premium_feel,
        shopify_click_appeal: pkg.shopify_click_appeal,
        compliance_risk_score: pkg.compliance_risk_score,
      };
      attemptLogs.push({ attempt, passed: g.passed, scores, reasons: g.reasons });

      if (!best || pkg.title_quality_score > best.pkg.title_quality_score) best = { pkg, reasons: g.reasons };


      if (g.passed) {
        // Persist premium package onto the idea.
        const shopify_meta = {
          ...(idea.shopify_meta ?? {}),
          premium_title_expert: {
            passed: true,
            attempts: attempt,
            scores,
            package: pkg,
            model,
            generated_at: new Date().toISOString(),
          },
          shopify_product_title: pkg.shopify_product_title,
          seo_title: pkg.seo_title,
          url_slug: pkg.url_slug,
          premium_positioning: pkg.premium_positioning,
        };
        await db.from("ebook_ideas").update({
          title: pkg.recommended_title,
          subtitle: pkg.subtitle,
          hook: pkg.primary_hook,
          target_buyer: pkg.target_buyer,
          core_pain_point: pkg.buyer_pain,
          transformation_promise: pkg.transformation_promise,
          shopify_meta,
        }).eq("id", idea_id);

        return new Response(JSON.stringify({
          ok: true, attempts: attempt, scores, package: pkg,
          attempt_logs: attemptLogs, cost_usd: totalCost, model,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      previousWeaknesses = [...g.reasons, ...pkg.weaknesses].slice(0, 8);
    }

    // All attempts failed the gate.
    const reasons = best?.reasons ?? ["no_valid_output"];
    const scores = best ? {
      title_quality_score: best.pkg.title_quality_score,
      buyer_pain_match: best.pkg.buyer_pain_match,
      premium_feel: best.pkg.premium_feel,
      shopify_click_appeal: best.pkg.shopify_click_appeal,
      compliance_risk_score: best.pkg.compliance_risk_score,
    } : {};

    // Record the failure on the idea so the admin UI can display it.
    const shopify_meta = {
      ...(idea.shopify_meta ?? {}),
      premium_title_expert: {
        passed: false,
        attempts: MAX_ATTEMPTS,
        best_scores: scores,
        best_package: best?.pkg ?? null,
        blocker_reason: `premium_title_gate_failed: ${reasons.join("; ")}`,
        attempt_logs: attemptLogs,
        model,
        generated_at: new Date().toISOString(),
      },
    };
    await db.from("ebook_ideas").update({ shopify_meta }).eq("id", idea_id);

    return new Response(JSON.stringify({
      ok: false, attempts: MAX_ATTEMPTS, scores,
      package: best?.pkg ?? null,
      blocker_reason: "premium_title_gate_failed",
      reasons, attempt_logs: attemptLogs, cost_usd: totalCost, model,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
