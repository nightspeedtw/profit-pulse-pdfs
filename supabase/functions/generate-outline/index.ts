// Milestone 3 — Premium ebook outline generator with strict JSON contract.
// Input: { idea_id, ebook_id? }. Creates an ebook row if needed, then generates
// a premium outline JSON, normalizes & validates against a strict schema, and
// retries up to 3 times before escalating to admin. Saves to ebook.outline_json.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM } from "../_shared/prompts.ts";
import { scoreOutline, outlineGate, logRun } from "../_shared/qc.ts";

// ---------------- Strict outline schema ----------------
interface OutlineSection {
  section_title: string;
  section_goal: string;
  key_points: string[];
}
interface OutlineWorksheet {
  title: string;
  type: string;
  purpose: string;
  fields: string[];
}
interface OutlineFramework {
  title: string;
  type: string;
  purpose: string;
  items: string[];
}
interface OutlineChapter {
  chapter_number: number;
  chapter_title: string;
  chapter_promise: string;
  learning_outcomes: string[];
  sections: OutlineSection[];
  worksheet: OutlineWorksheet;
  framework: OutlineFramework;
}
interface OutlineBonus {
  title: string;
  type: string;
  purpose: string;
}
interface OutlineJson {
  title: string;
  subtitle: string;
  target_buyer: string;
  buyer_pain: string;
  core_promise: string;
  positioning: string;
  chapters: OutlineChapter[];
  bonus_materials: OutlineBonus[];
  // legacy/extra
  disclaimer_required?: boolean;
  disclaimer_text?: string | null;
  action_plan?: { title: string; steps: string[] };
  bonus_section?: { checklist: string; worksheet: string; templates: string; action_plan_7day: string };
  table_of_contents?: { index: number; title: string }[];
}

const MIN_CHAPTERS = 8;

const SCHEMA_HINT = `{
  "title": "string",
  "subtitle": "string",
  "target_buyer": "string",
  "buyer_pain": "string",
  "core_promise": "string",
  "positioning": "string",
  "chapters": [
    {
      "chapter_number": 1,
      "chapter_title": "string",
      "chapter_promise": "1 sentence transformation promise",
      "learning_outcomes": ["outcome 1", "outcome 2", "outcome 3"],
      "sections": [
        { "section_title": "string", "section_goal": "string", "key_points": ["point","point","point"] }
      ],
      "worksheet": {
        "title": "string",
        "type": "tracker | calculator | checklist | script_log | timeline | scorecard | reflection | action_plan",
        "purpose": "string",
        "fields": ["field","field","field"]
      },
      "framework": {
        "title": "string",
        "type": "quadrant_matrix | vertical_steps | before_after | checklist_grid | comparison_table | timeline | scorecard | process_map | ladder",
        "purpose": "string",
        "items": ["item","item","item"]
      }
    }
  ],
  "bonus_materials": [
    { "title": "string", "type": "worksheet | template | checklist | calculator | script", "purpose": "string" }
  ]
}`;

function compliance(topic: string): boolean {
  const t = topic.toLowerCase();
  return /(finance|invest|money|wealth|health|medical|legal|law|relationship|diet|weight|cure)/i.test(t);
}

// ---------------- Normalize ----------------
// Accept raw AI output (string or already-parsed object) and remap common
// alternate field names so the final object always exposes `chapters`.
export function normalizeOutlineOutput(raw: unknown): OutlineJson {
  let obj: any = raw;
  if (typeof obj === "string") {
    let s = obj.replace(/^\uFEFF/, "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try { obj = JSON.parse(s); }
    catch {
      // Brace-match extraction
      const start = s.search(/[\{\[]/);
      if (start === -1) throw new Error("No JSON in outline output");
      const open = s[start], close = open === "{" ? "}" : "]";
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) throw new Error("Truncated JSON in outline output");
      obj = JSON.parse(s.slice(start, end + 1));
    }
  }
  if (!obj || typeof obj !== "object") throw new Error("Outline output is not an object");

  // Unwrap common envelopes
  if (obj.data?.outline) obj = { ...obj, ...obj.data.outline };
  if (obj.outline && typeof obj.outline === "object" && !Array.isArray(obj.outline)) {
    obj = { ...obj, ...obj.outline };
  }

  // Map alternate chapter aliases → chapters
  let chapters: any[] | undefined =
    obj.chapters ??
    obj.chapter_plan ??
    obj.chapterPlan ??
    obj.outline_chapters ??
    obj.sections; // only if sections look chapter-like

  if (!Array.isArray(chapters) && Array.isArray(obj.table_of_contents)) {
    const toc = obj.table_of_contents;
    // Only treat as chapters if entries look richer than {index,title}
    if (toc.length && (toc[0].chapter_promise || toc[0].learning_outcomes || toc[0].sections)) {
      chapters = toc;
    }
  }

  if (!Array.isArray(chapters)) chapters = [];

  // Normalize each chapter to the strict shape
  const normChapters: OutlineChapter[] = chapters.map((c: any, i: number) => {
    const chapter_number = Number(c.chapter_number ?? c.index ?? c.number ?? i + 1);
    const chapter_title = String(c.chapter_title ?? c.title ?? `Chapter ${chapter_number}`);
    const chapter_promise = String(
      c.chapter_promise ?? c.promise ?? c.objective ?? c.brief ?? "",
    );
    let outcomes: string[] = Array.isArray(c.learning_outcomes)
      ? c.learning_outcomes.map(String)
      : Array.isArray(c.key_teaching_points) ? c.key_teaching_points.map(String)
      : Array.isArray(c.outcomes) ? c.outcomes.map(String)
      : [];
    // Force exactly 3 outcomes
    if (outcomes.length > 3) outcomes = outcomes.slice(0, 3);
    while (outcomes.length < 3) outcomes.push(`Outcome ${outcomes.length + 1}`);

    let sections: OutlineSection[] = Array.isArray(c.sections)
      ? c.sections.map((s: any, j: number) => ({
        section_title: String(s.section_title ?? s.title ?? `Section ${j + 1}`),
        section_goal: String(s.section_goal ?? s.goal ?? s.objective ?? ""),
        key_points: Array.isArray(s.key_points) ? s.key_points.map(String)
          : Array.isArray(s.points) ? s.points.map(String) : [],
      }))
      : [];
    if (sections.length === 0) {
      sections = [{
        section_title: "Overview",
        section_goal: chapter_promise || "Set up the chapter premise.",
        key_points: outcomes.slice(0, 3),
      }];
    }

    const wsSrc = c.worksheet ?? c.workbook ?? null;
    const worksheet: OutlineWorksheet = wsSrc && typeof wsSrc === "object"
      ? {
        title: String(wsSrc.title ?? `${chapter_title} worksheet`),
        type: String(wsSrc.type ?? "checklist"),
        purpose: String(wsSrc.purpose ?? "Help reader apply this chapter."),
        fields: Array.isArray(wsSrc.fields) ? wsSrc.fields.map(String)
          : Array.isArray(wsSrc.items) ? wsSrc.items.map(String) : ["", "", ""],
      }
      : {
        title: `${chapter_title} worksheet`,
        type: "checklist",
        purpose: "Help reader apply this chapter.",
        fields: outcomes.slice(0, 3),
      };

    const fwSrc = c.framework ?? c.model ?? null;
    const framework: OutlineFramework = fwSrc && typeof fwSrc === "object"
      ? {
        title: String(fwSrc.title ?? `${chapter_title} framework`),
        type: String(fwSrc.type ?? "vertical_steps"),
        purpose: String(fwSrc.purpose ?? "Visual model for this chapter."),
        items: Array.isArray(fwSrc.items) ? fwSrc.items.map(String)
          : Array.isArray(fwSrc.steps) ? fwSrc.steps.map(String) : [],
      }
      : {
        title: `${chapter_title} framework`,
        type: "vertical_steps",
        purpose: "Visual model for this chapter.",
        items: outcomes.slice(0, 3),
      };

    return { chapter_number, chapter_title, chapter_promise, learning_outcomes: outcomes, sections, worksheet, framework };
  });

  // Bonus materials
  let bonus_materials: OutlineBonus[] = Array.isArray(obj.bonus_materials)
    ? obj.bonus_materials.map((b: any) => ({
      title: String(b.title ?? ""),
      type: String(b.type ?? "checklist"),
      purpose: String(b.purpose ?? ""),
    }))
    : [];
  if (bonus_materials.length === 0 && obj.bonus_section) {
    const bs = obj.bonus_section;
    if (bs.checklist) bonus_materials.push({ title: "Master checklist", type: "checklist", purpose: String(bs.checklist) });
    if (bs.worksheet) bonus_materials.push({ title: "Worksheet pack", type: "worksheet", purpose: String(bs.worksheet) });
    if (bs.templates) bonus_materials.push({ title: "Templates", type: "template", purpose: String(bs.templates) });
    if (bs.action_plan_7day) bonus_materials.push({ title: "7-day action plan", type: "checklist", purpose: String(bs.action_plan_7day) });
  }

  return {
    title: String(obj.title ?? ""),
    subtitle: String(obj.subtitle ?? ""),
    target_buyer: String(obj.target_buyer ?? ""),
    buyer_pain: String(obj.buyer_pain ?? obj.core_pain ?? obj.core_pain_point ?? ""),
    core_promise: String(obj.core_promise ?? obj.promise_statement ?? obj.transformation_promise ?? ""),
    positioning: String(obj.positioning ?? obj.angle ?? ""),
    chapters: normChapters,
    bonus_materials,
    disclaimer_required: obj.disclaimer_required ?? false,
    disclaimer_text: obj.disclaimer_text ?? null,
    action_plan: obj.action_plan,
    bonus_section: obj.bonus_section,
  };
}

// ---------------- Validate ----------------
export interface OutlineValidation {
  ok: boolean;
  reason: string;
  missing_fields: string[];
  chapter_count: number;
}

export function validateOutlineJson(o: OutlineJson | any): OutlineValidation {
  const missing: string[] = [];
  if (!o || typeof o !== "object") {
    return { ok: false, reason: "outline_json is not an object", missing_fields: ["outline_json"], chapter_count: 0 };
  }
  if (!Array.isArray(o.chapters)) {
    return { ok: false, reason: "outline_json.chapters is not an array", missing_fields: ["outline_json.chapters"], chapter_count: 0 };
  }
  const count = o.chapters.length;
  if (count < MIN_CHAPTERS) {
    return { ok: false, reason: `outline_json.chapters must have at least ${MIN_CHAPTERS} entries (got ${count})`, missing_fields: ["outline_json.chapters"], chapter_count: count };
  }
  o.chapters.forEach((c: any, i: number) => {
    if (c.chapter_number == null) missing.push(`chapters[${i}].chapter_number`);
    if (!c.chapter_title) missing.push(`chapters[${i}].chapter_title`);
    if (!c.chapter_promise) missing.push(`chapters[${i}].chapter_promise`);
    if (!Array.isArray(c.learning_outcomes) || c.learning_outcomes.length !== 3) {
      missing.push(`chapters[${i}].learning_outcomes (need exactly 3)`);
    }
    if (!Array.isArray(c.sections) || c.sections.length === 0) missing.push(`chapters[${i}].sections`);
    if (!c.worksheet || typeof c.worksheet !== "object") missing.push(`chapters[${i}].worksheet`);
    if (!c.framework || typeof c.framework !== "object") missing.push(`chapters[${i}].framework`);
  });
  if (missing.length > 0) {
    return { ok: false, reason: `Missing required fields: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`, missing_fields: missing, chapter_count: count };
  }
  return { ok: true, reason: "ok", missing_fields: [], chapter_count: count };
}

// ---------------- AI calls ----------------
async function generateOutline(model: string, idea: any, correction?: string) {
  const needsDisclaimer = compliance([idea.title, idea.subtitle, idea.hook, idea.category_name].filter(Boolean).join(" "));
  const correctionBlock = correction
    ? `\n\nIMPORTANT CORRECTION (your previous output was invalid):\n${correction}\nReturn valid JSON only with a "chapters" array of at least ${MIN_CHAPTERS} chapters. No markdown. No prose. No explanation.\n`
    : "";
  return aiJSON<OutlineJson>({
    model,
    schemaHint: SCHEMA_HINT,
    system: PREMIUM_WRITER_SYSTEM +
      `\n\nYou are designing a PREMIUM PAID PDF EBOOK outline. The outline must read like a paid product, not a blog. Generate ${MIN_CHAPTERS}-12 chapters; each must deliver a specific transformation. No generic "Introduction" chapter.` +
      `\n\nSTRICT OUTPUT CONTRACT: Return a single JSON object matching the schema. The top-level key MUST be "chapters" (array). Each chapter MUST include: chapter_number, chapter_title, chapter_promise, learning_outcomes (exactly 3), sections (array), worksheet (object), framework (object). Respond with JSON only — no markdown fences, no prose.`,
    user: `Approved ebook idea:
Title: ${idea.title}
Subtitle: ${idea.subtitle ?? ""}
Target Buyer: ${idea.target_buyer ?? ""}
Hook: ${idea.hook ?? ""}
Core pain: ${idea.core_pain_point ?? ""}
Transformation promise: ${idea.transformation_promise ?? ""}

Design the full premium ebook outline. Use ${MIN_CHAPTERS}-12 chapters (aim 10). Each chapter MUST include chapter_number, chapter_title, chapter_promise, exactly 3 learning_outcomes, a sections array, a worksheet object, and a framework object. Also include bonus_materials.

${needsDisclaimer ? 'This topic is regulated (finance/health/legal/medical/relationship). Set disclaimer_required=true and write a short educational disclaimer.' : 'Set disclaimer_required=false and disclaimer_text=null.'}
${correctionBlock}
Return JSON only.`,
  });
}

function legacyBonuses(o: OutlineJson) {
  if (o.bonus_section) return o.bonus_section;
  const m = o.bonus_materials ?? [];
  const find = (t: string) => m.find((b) => b.type === t)?.purpose ?? "";
  return {
    checklist: find("checklist"),
    worksheet: find("worksheet"),
    templates: find("template"),
    action_plan_7day: o.action_plan?.steps?.join("; ") ?? "",
  };
}

// ---------------- Deterministic fallback outline ----------------
// Used when the AI fails to return a valid chapters array after 3 attempts.
// Produces a generic but valid premium outline that passes validateOutlineJson.
export function generateFallbackOutline(ebook: any, idea: any): OutlineJson {
  const title = String(ebook?.title ?? idea?.title ?? "Untitled Premium Guide");
  const subtitle = String(ebook?.subtitle ?? idea?.subtitle ?? "A practical step-by-step playbook");
  const topic = String(idea?.category_name ?? idea?.niche ?? title);
  const buyer = String(ebook?.target_buyer ?? idea?.target_buyer ?? "motivated readers");
  const pain = String(idea?.core_pain_point ?? "they struggle to get consistent results");
  const promise = String(idea?.transformation_promise ?? `master ${topic} with a proven system`);

  const archetypes = [
    { kind: "Diagnose", verb: "audit", focus: "current state" },
    { kind: "Foundations", verb: "understand", focus: "core framework" },
    { kind: "Setup", verb: "set up", focus: "tools and environment" },
    { kind: "Execution", verb: "execute", focus: "tactical playbook" },
    { kind: "Mistakes", verb: "avoid", focus: "common traps" },
    { kind: "Automation", verb: "automate", focus: "repeatable routines" },
    { kind: "Optimization", verb: "optimize", focus: "advanced tactics" },
    { kind: "Case Study", verb: "study", focus: "real-world example" },
    { kind: "Measurement", verb: "measure", focus: "metrics and tracking" },
    { kind: "Mastery", verb: "sustain", focus: "long-term maintenance" },
  ];

  const chapters: OutlineChapter[] = archetypes.map((a, i) => {
    const n = i + 1;
    const chapter_title = `${a.kind}: ${a.verb[0].toUpperCase() + a.verb.slice(1)} your ${topic} ${a.focus}`;
    const chapter_promise = `By the end of this chapter, you will ${a.verb} your ${topic} ${a.focus} so that ${promise}.`;
    const learning_outcomes = [
      `Identify the key levers in ${topic} ${a.focus}.`,
      `Apply a step-by-step ${a.kind.toLowerCase()} method to your situation.`,
      `Produce a concrete artifact you can reuse immediately.`,
    ];
    const sections: OutlineSection[] = [
      {
        section_title: `Why ${a.focus} matters for ${buyer}`,
        section_goal: `Frame the problem and stakes for ${a.focus}.`,
        key_points: [`Context for ${buyer}`, `Cost of ignoring ${a.focus}`, `What success looks like`],
      },
      {
        section_title: `The ${a.kind} framework`,
        section_goal: `Teach the reusable framework for ${a.focus}.`,
        key_points: [`Core principles`, `When to use it`, `Common variations`],
      },
      {
        section_title: `Step-by-step walkthrough`,
        section_goal: `Show exactly how to ${a.verb} ${a.focus}.`,
        key_points: [`Prepare inputs`, `Run the steps`, `Verify the output`],
      },
      {
        section_title: `Templates, prompts, and checks`,
        section_goal: `Hand reader copy-paste assets to act today.`,
        key_points: [`Template`, `Prompt or script`, `Self-check questions`],
      },
    ];
    const worksheet: OutlineWorksheet = {
      title: `${a.kind} worksheet`,
      type: "checklist",
      purpose: `Help the reader ${a.verb} their own ${a.focus}.`,
      fields: [
        `Current state of ${a.focus}`,
        `Next 3 actions for ${a.focus}`,
        `Owner / deadline for each action`,
      ],
    };
    const framework: OutlineFramework = {
      title: `${a.kind} framework`,
      type: "vertical_steps",
      purpose: `Visual model of the ${a.kind.toLowerCase()} process.`,
      items: [
        `Step 1 — assess ${a.focus}`,
        `Step 2 — apply the ${a.kind.toLowerCase()} method`,
        `Step 3 — measure and iterate`,
      ],
    };
    return { chapter_number: n, chapter_title, chapter_promise, learning_outcomes, sections, worksheet, framework };
  });

  const bonus_materials: OutlineBonus[] = [
    { title: `${title} master checklist`, type: "checklist", purpose: `One-page checklist covering every chapter of ${title}.` },
    { title: `${topic} worksheet pack`, type: "worksheet", purpose: `Printable worksheet bundle for every chapter.` },
    { title: `${topic} templates`, type: "template", purpose: `Copy-paste templates for the most common ${topic} tasks.` },
    { title: `7-day ${topic} action plan`, type: "checklist", purpose: `Day-by-day plan to apply the book in one week.` },
  ];

  return {
    title,
    subtitle,
    target_buyer: buyer,
    buyer_pain: pain,
    core_promise: promise,
    positioning: `A premium, no-fluff guide on ${topic} for ${buyer}.`,
    chapters,
    bonus_materials,
    disclaimer_required: compliance([title, subtitle, topic].join(" ")),
    disclaimer_text: compliance([title, subtitle, topic].join(" "))
      ? "This material is for educational purposes only and does not constitute professional advice."
      : null,
  };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, ebook_id } = await req.json();
    if (!idea_id && !ebook_id) throw new Error("idea_id or ebook_id required");

    // Load or create ebook
    let ebook: any;
    if (ebook_id) {
      const { data, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
      if (error || !data) throw new Error("Ebook not found");
      ebook = data;
    } else {
      const { data: idea, error: ie } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
      if (ie || !idea) throw new Error("Idea not found");
      const { data: cat } = idea.category_id
        ? await db.from("categories").select("*").eq("id", idea.category_id).single()
        : { data: null };
      const price = Number(cat?.default_price ?? 24.99);
      const { data: created, error: ee } = await db.from("ebooks").insert({
        idea_id: idea.id,
        category_id: idea.category_id,
        title: idea.title,
        subtitle: idea.subtitle,
        target_buyer: idea.target_buyer,
        hook: idea.hook,
        status: "outline",
        pipeline_status: "outline_generation",
        writing_status: "outline_generating",
        price,
      }).select("*").single();
      if (ee || !created) throw new Error(`Failed to create ebook: ${ee?.message}`);
      ebook = created;
      await db.from("ebook_ideas").update({ status: "outline", pipeline_status: "outline_generation" }).eq("id", idea.id);
    }

    // Load idea for context
    const { data: idea } = await db.from("ebook_ideas").select("*").eq("id", ebook.idea_id).single();
    const { data: cat } = ebook.category_id
      ? await db.from("categories").select("name").eq("id", ebook.category_id).single()
      : { data: null };
    const ctx = { ...idea, category_name: cat?.name };

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const model = pickModel(mode, "content");

    await db.from("ebooks").update({ writing_status: "outline_generating", pipeline_status: "outline_generation" }).eq("id", ebook.id);

    // ---- Strict generate-normalize-validate loop (up to 3 attempts) ----
    let outline: OutlineJson | null = null;
    let validation: OutlineValidation = { ok: false, reason: "not yet generated", missing_fields: [], chapter_count: 0 };
    let totalCost = 0;
    let attempts = 0;
    let lastCorrection: string | undefined;

    while (attempts < 3 && !validation.ok) {
      attempts++;
      let raw: any;
      try {
        const res = await generateOutline(model, ctx, lastCorrection);
        await logCost(db, { ebook_id: ebook.id, step: `outline_attempt_${attempts}`, model: res.model, ...res.usage });
        totalCost += res.usage.cost_usd;
        raw = res.data;
      } catch (e) {
        lastCorrection = `Previous attempt threw: ${(e as Error).message}. Return strict JSON only.`;
        await logRun(db, { ebook_id: ebook.id, step: "outline", status: "fail", error: (e as Error).message, rewrite_count: attempts - 1 });
        continue;
      }

      try {
        outline = normalizeOutlineOutput(raw);
      } catch (e) {
        lastCorrection = `Could not parse your previous JSON: ${(e as Error).message}. Return ONLY a JSON object whose top-level key "chapters" is an array of at least ${MIN_CHAPTERS} chapters.`;
        validation = { ok: false, reason: `normalize failed: ${(e as Error).message}`, missing_fields: ["outline_json"], chapter_count: 0 };
        await logRun(db, { ebook_id: ebook.id, step: "outline", status: "rewrite", error: validation.reason, rewrite_count: attempts - 1 });
        continue;
      }

      validation = validateOutlineJson(outline);
      if (!validation.ok) {
        lastCorrection = `Your previous output was invalid because it did not include a valid outline_json.chapters array (reason: ${validation.reason}). Return valid JSON only with a "chapters" array of at least ${MIN_CHAPTERS} chapters, each with chapter_number, chapter_title, chapter_promise, exactly 3 learning_outcomes, sections[], worksheet{}, framework{}.`;
        await logRun(db, { ebook_id: ebook.id, step: "outline", status: "rewrite", error: validation.reason, rewrite_count: attempts - 1, payload: { missing_fields: validation.missing_fields, chapter_count: validation.chapter_count } });
      } else {
        await logRun(db, { ebook_id: ebook.id, step: "outline", status: "ok", rewrite_count: attempts - 1, payload: { chapter_count: validation.chapter_count } });
      }
    }

    if (!validation.ok || !outline) {
      // Persist failure so the UI can surface a precise admin message
      await db.from("ebooks").update({
        writing_status: "needs_review",
        qc_status: "outline_failed",
        pipeline_status: "rejected",
        rejection_reason: `Admin needed because generate_outline did not return a valid chapters array after ${attempts} attempts. Missing: outline_json.chapters (${validation.reason})`,
        cost_usd: (Number(ebook.cost_usd ?? 0) + totalCost),
      }).eq("id", ebook.id);
      return new Response(JSON.stringify({
        error: `generate-outline did not return a valid chapters array (got ${validation.chapter_count}).`,
        attempts,
        validation,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Outline QC (only runs after schema is valid) ----
    const scores = await scoreOutline(model, {
      title: outline.title,
      toc: outline.chapters.map((c) => ({ title: c.chapter_title, brief: c.chapter_promise })),
      bonuses: legacyBonuses(outline) as any,
    });
    totalCost += scores.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: "outline_qc", model: scores.model, ...scores.usage });
    const gate = outlineGate(scores.data);
    await logRun(db, { ebook_id: ebook.id, step: "outline_qc", status: gate.pass ? "ok" : "rewrite", score: scores.data.structure_score, rewrite_count: attempts - 1, cost_usd: totalCost, payload: scores.data as any });

    const writing_status = gate.pass ? "outline_ready" : "needs_review";
    const qc_status = gate.pass ? "outline_passed" : "outline_failed";
    const pipeline_status = gate.pass ? "outline_generation" : "rejected";

    await db.from("ebooks").update({
      outline_json: outline as any,
      outline_qc: scores.data as any,
      outline_rewrite_count: attempts - 1,
      toc: outline.chapters.map((c) => ({ title: c.chapter_title, brief: c.chapter_promise })),
      bonuses: legacyBonuses(outline) as any,
      title: outline.title || ebook.title,
      subtitle: outline.subtitle || ebook.subtitle,
      target_buyer: outline.target_buyer || ebook.target_buyer,
      writing_status,
      qc_status,
      pipeline_status,
      rejection_reason: gate.pass ? null : `Outline QC failed after ${attempts - 1} rewrites: ${gate.reason}`,
      cost_usd: (Number(ebook.cost_usd ?? 0) + totalCost),
      status: gate.pass ? "outline" : "needs_review",
    }).eq("id", ebook.id);

    return new Response(JSON.stringify({
      ebook_id: ebook.id,
      writing_status,
      qc_status,
      scores: scores.data,
      rewrites: attempts - 1,
      chapter_count: validation.chapter_count,
      outline,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
