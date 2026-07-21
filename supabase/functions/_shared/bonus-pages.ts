// SKILL F helper — auto-derive bonus-page content from the manuscript segments.
//
// Two pieces:
//   1. `extractClueCandidates` — deterministic (free): pick 3-5 concrete story
//      objects (nouns repeated ≥2× across pages, ranked by rarity).
//   2. `generateDiscussionQuestions` — one Gemini call: 4 age-appropriate
//      discussion questions grounded in the story's theme + developmental hook.
//
// Also exposes `buildBonusContent` which composes both plus a one-liner
// developmental hook for the footer of the "Talk About the Story" page.

import type { KidsSegment } from "./kids-segments.ts";
import { parseModelJson } from "./model-json.ts";
import "./gateway-guard.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const STOP = new Set<string>([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","from",
  "is","was","were","be","been","being","are","am","he","she","it","they","them",
  "his","her","its","their","this","that","these","those","who","whom","what",
  "which","when","where","why","how","so","if","then","than","as","up","down",
  "out","over","under","into","onto","off","one","two","three","some","any",
  "not","no","yes","said","says","went","goes","came","come","did","do","does",
  "just","very","really","now","here","there","also","too","big","little","small",
  "again","away","back","because","before","after","around","by","about","all",
  "each","every","own","same","other","only","own","new","old","first","last",
  "day","time","way","things","thing","made","make","makes","get","got","had","have","has",
]);

export function extractClueCandidates(pages: KidsSegment[], max = 5): string[] {
  const counts = new Map<string, number>();
  const originals = new Map<string, string>();
  for (const p of pages) {
    const text = String(p.text ?? "").toLowerCase();
    const tokens = text.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length < 4) continue;
      if (STOP.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      const key = t.replace(/(s|es|ed|ing)$/i, "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!originals.has(key)) originals.set(key, t);
    }
  }
  // Repeated ≥ 2×, ranked by frequency then length (longer = more concrete).
  const repeated = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .slice(0, max)
    .map(([k]) => {
      const w = originals.get(k) ?? k;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  return repeated;
}

export async function generateDiscussionQuestions(opts: {
  title: string;
  theme?: string | null;
  ageBand?: string | null;
  heroName?: string | null;
  manuscript: string;
  timeoutMs?: number;
}): Promise<{ questions: string[]; developmental_hook: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You write warm, age-appropriate discussion prompts for children's picture books. Return JSON only." },
          { role: "user", content:
`Book title: "${opts.title}"
Hero: ${opts.heroName ?? "the main character"}
Age band: ${opts.ageBand ?? "4-7"}
Theme / developmental value: ${opts.theme ?? "empathy, curiosity, and friendship"}

Manuscript:
${opts.manuscript.slice(0, 4000)}

Return JSON exactly like:
{
  "developmental_hook": "one short sentence (max 90 chars) naming the developmental value parents will love, e.g. 'A gentle nudge toward empathy and creative problem-solving.'",
  "questions": [
    "Question 1 — grounded in a specific story moment; open-ended; no yes/no.",
    "Question 2 — invites the child to talk about their feelings.",
    "Question 3 — prompts imagination ('what would you do...').",
    "Question 4 — connects the story to the child's own life."
  ]
}

Each question must be 8-18 words. No preachy language. No 'the moral is'.`,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`discussion ${r.status}`);
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content ?? "";
    const parseRes = parseModelJson<{ questions?: unknown; developmental_hook?: unknown }>(raw);
    const parsed = parseRes.ok ? parseRes.value : { questions: [], developmental_hook: "" };
    const questions = Array.isArray(parsed.questions) ? parsed.questions.map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, 4) : [];
    const hook = String(parsed.developmental_hook ?? "").trim().slice(0, 140);
    return { questions, developmental_hook: hook };
  } finally { clearTimeout(t); }
}

export async function buildBonusContent(opts: {
  title: string;
  segments: KidsSegment[];
  theme?: string | null;
  ageBand?: string | null;
  heroName?: string | null;
}): Promise<{ clues: string[]; discussion_questions: string[]; developmental_hook: string }> {
  const clues = extractClueCandidates(opts.segments, 5);
  const manuscript = opts.segments.map((s) => s.text).join("\n\n");
  let discussion_questions: string[] = [];
  let developmental_hook = "";
  try {
    const g = await generateDiscussionQuestions({
      title: opts.title,
      theme: opts.theme,
      ageBand: opts.ageBand,
      heroName: opts.heroName,
      manuscript,
    });
    discussion_questions = g.questions;
    developmental_hook = g.developmental_hook;
  } catch (e) {
    console.warn("[bonus-pages] discussion generation failed, using fallback:", (e as Error).message);
    discussion_questions = [
      `What was your favorite moment in ${opts.title}?`,
      `How do you think ${opts.heroName ?? "the hero"} felt at the end?`,
      `If you were in the story, what would you have done?`,
      `Has anything like this ever happened to you?`,
    ];
    developmental_hook = "A warm read-aloud that sparks empathy, curiosity, and conversation.";
  }
  return { clues, discussion_questions, developmental_hook };
}
