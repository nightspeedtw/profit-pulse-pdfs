// FIRST_PASS_YIELD_LEARNER v1 — owner law "เรียนจากการซ่อม จนสอบผ่านตลอดไป".
//
// Every repair is a training signal. This module:
//   1. Normalizes free-form gate defect strings into stable (pattern_key,
//      species_key, gate) tuples.
//   2. Maintains a lifetime occurrence ledger (learned_defect_counts).
//   3. Auto-promotes a pattern to an ACTIVE prevention rule
//      (learned_prevention_rules) once it hits >= 2 occurrences, so the base
//      prompt for every subsequent page of that species carries the
//      counter-clause.
//   4. Computes per-book First-Pass-Yield = pages accepted attempt 1 / total.
//   5. Publishes a compact "learned clause" per species to buildInteriorPrompt.
//
// Rules for verifier outages and provider billing errors: they are TECHNICAL
// states, not defects. They never count toward pattern occurrences and never
// trigger rule promotion (owner non-negotiable: missing_dependency != quality).

export interface DefectHit {
  pattern_key: string;
  species_key: string;
  gate: string;
  page?: number;
  raw?: string;
}

export interface LearnedRule {
  pattern_key: string;
  species_key: string;
  gate: string;
  positive_clause: string;
  negative_clause: string;
  composition_hint: string;
  status: string;
  version: number;
}

export interface FpyReport {
  fpy: number;                         // 0..1
  first_pass_pages: number;
  total_pages: number;
  gate_rejections: number;
  rejections_by_class: Record<string, number>;
  rejected_pages: number[];
}

// ─── Defect → pattern normalization ────────────────────────────────────────
// Ordered rules; first match wins. Verifier/billing/technical noise is
// classified as "__technical__" so callers can drop it.

interface NormalizerRule {
  pattern_key: string;
  species_key?: string;          // when omitted, use the page's own species
  gate: string;
  match: RegExp;                 // matched against the lowercased defect text
}

const CETACEANS = new Set(["dolphin","whale","orca","killer whale","narwhal","porpoise","beluga"]);
const RAYS = new Set(["ray","stingray","manta ray","manta"]);
const SEALS = new Set(["seal","sea lion","fur seal","harbor seal"]);

const TECHNICAL_MATCH = /(verifier|degraded|no_verdict|billing|budget|provider_|http_?\d{3}|timeout|replanned_to_portrait|coloring_page_dead)/i;

// Owner law anatomy_imagination_vs_deformity — Tier 2 stylization is NEVER
// a defect. If the verifier still surfaces such a string, drop it here so it
// does not increment counters or promote learned rules.
const STYLIZATION_MATCH = /(eyelash|long\s+lashes|big\s+(sparkly\s+)?eyes|sparkl(e|y)\s+eyes|smile|smiling|blush|rosy\s+cheeks|bow(\s+on|tie)|wearing\s+(a\s+)?(bow|hat|ribbon|crown|scarf)|humani[sz]ed\s+(face|expression)|anthropomorphic|cute\s+(face|expression))/i;

const NORMALIZERS: NormalizerRule[] = [
  { pattern_key: "cetacean_horizontal_flukes", gate: "anatomy",
    match: /(vertical\s+(fish\s+)?tail|vertical\s+flukes?|mermaid\s+fin|split\s+y[- ]?tail|y[- ]?shaped\s+tail|caudal\s+fin\s+vertical)/i },
  { pattern_key: "narwhal_tusk_spec", species_key: "narwhal", gate: "anatomy",
    match: /(unicorn\s+horn|horn\s+on\s+forehead|tusk\s+on\s+forehead|multiple\s+tusks|two\s+tusks|bulbous\s+tusk|missing\s+tusk|no\s+tusk)/i },
  { pattern_key: "seal_two_front_flippers", gate: "anatomy",
    match: /(three\s+flippers?|3\s+flippers?|extra\s+flipper|five\s+flippers?)/i },
  { pattern_key: "ray_dorsal_view", gate: "anatomy",
    match: /(ray\s+face(-|\s)?up|inverted\s+face|face\s+on\s+belly|underside\s+face|belly[- ]face)/i },
  { pattern_key: "sea_water_outline_only", species_key: "__sea_scene__", gate: "solid_black",
    match: /(solid[- ]?black\s+water|water\s+filled\s+solid|dense\s+water\s+fill|water_mass_fill|black\s+water\s+mass)/i },
  // Generic fallbacks
  { pattern_key: "extra_limb", gate: "anatomy",
    match: /(extra\s+(limb|leg|arm|fin)|five\s+legs?|six\s+legs?|too\s+many\s+(legs|arms|fins))/i },
  { pattern_key: "fused_features", gate: "anatomy",
    match: /(fused|conjoined|merged\s+into)/i },
  { pattern_key: "solid_black_fill", gate: "solid_black",
    match: /(solid[- ]?black|black\s+mass|dense\s+fill|hatch\s+fill)/i },
];

const NORM = (s: string) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Classify a raw defect string. Returns null when it is technical noise. */
export function normalizeDefect(
  raw: string,
  species_key?: string,
  gate?: string,
  scene?: string,
): DefectHit | null {
  if (!raw) return null;
  if (TECHNICAL_MATCH.test(raw)) return null;
  if (STYLIZATION_MATCH.test(raw)) return null;
  const text = raw.toLowerCase();
  const speciesLc = (species_key ?? "").toLowerCase();
  const sceneLc = (scene ?? "").toLowerCase();
  const isSeaScene = /(sea|ocean|underwater|reef|lagoon|beach|coral)/i.test(scene ?? "") ||
                     CETACEANS.has(speciesLc) || RAYS.has(speciesLc) || SEALS.has(speciesLc);
  for (const rule of NORMALIZERS) {
    if (!rule.match.test(text)) continue;
    // Cetacean-only pattern
    if (rule.pattern_key === "cetacean_horizontal_flukes" && !CETACEANS.has(speciesLc)) continue;
    if (rule.pattern_key === "ray_dorsal_view" && !RAYS.has(speciesLc)) continue;
    if (rule.pattern_key === "seal_two_front_flippers" && !SEALS.has(speciesLc)) continue;
    if (rule.pattern_key === "narwhal_tusk_spec" && speciesLc !== "narwhal") continue;
    if (rule.pattern_key === "sea_water_outline_only" && !isSeaScene) continue;
    return {
      pattern_key: rule.pattern_key,
      species_key: rule.species_key ?? (speciesLc || "__unknown__"),
      gate: rule.gate,
      raw,
    };
  }
  // Uncategorized but real gate defect → track as generic per-species pattern
  if (gate && speciesLc) {
    return { pattern_key: `${gate}_generic`, species_key: speciesLc, gate, raw };
  }
  return null;
}

// ─── FPY computation from coloring_last_errors log ────────────────────────

interface ErrorLogEntry {
  page?: number;
  error?: string;
  reasons?: string[] | string;
  verifier_state?: boolean;
  anatomy?: { species_key?: string };
  at?: string;
}

/**
 * A page is "first-pass" iff we accepted its first render — i.e. it has no
 * real gate rejection recorded. Verifier degradations and technical noise
 * (billing, timeout) do NOT count as rejections.
 */
export function computeFirstPassYield(
  totalPages: number,
  errors: ErrorLogEntry[],
): FpyReport {
  const perPageRejections = new Map<number, string[]>();
  const rejections_by_class: Record<string, number> = {};
  let gate_rejections = 0;

  for (const e of errors ?? []) {
    if (!e || typeof e.page !== "number") continue;
    if (e.verifier_state) continue;
    const err = e.error ?? "";
    if (!err) continue;
    if (TECHNICAL_MATCH.test(err)) continue;
    // Classify by prefix
    let cls = "other";
    if (/^anatomy_gate/i.test(err)) cls = "anatomy";
    else if (/^solid_black/i.test(err) || /solid[- ]?black/i.test(err)) cls = "solid_black";
    else if (/sharpness|boundary/i.test(err)) cls = "sharpness";
    else if (/billing|budget|provider_|verifier|degraded|no_verdict/i.test(err)) continue;
    else if (/replan|dead/i.test(err)) continue;
    gate_rejections += 1;
    rejections_by_class[cls] = (rejections_by_class[cls] ?? 0) + 1;
    const arr = perPageRejections.get(e.page) ?? [];
    arr.push(cls);
    perPageRejections.set(e.page, arr);
  }

  const rejected_pages = [...perPageRejections.keys()].sort((a, b) => a - b);
  const first_pass_pages = Math.max(0, totalPages - rejected_pages.length);
  const fpy = totalPages > 0 ? first_pass_pages / totalPages : 0;
  return { fpy, first_pass_pages, total_pages: totalPages, gate_rejections, rejections_by_class, rejected_pages };
}

// ─── Prompt-clause synthesis ──────────────────────────────────────────────

export function learnedClauseFromRules(rules: LearnedRule[]): string {
  const active = rules.filter((r) => r.status === "active");
  if (!active.length) return "";
  const parts: string[] = [];
  for (const r of active) {
    parts.push(r.positive_clause);
    if (r.negative_clause) parts.push(r.negative_clause);
    if (r.composition_hint) parts.push(r.composition_hint);
  }
  return `Learned prevention rules (past-failure corrections — MANDATORY): ${parts.join(" ")}`;
}

/**
 * Group active rules keyed by every species token they apply to. Sea-scene
 * rules use the sentinel "__sea_scene__" which the caller expands per scene.
 */
export function indexRulesBySpecies(rules: LearnedRule[]): Map<string, LearnedRule[]> {
  const idx = new Map<string, LearnedRule[]>();
  for (const r of rules) {
    if (r.status !== "active") continue;
    const key = r.species_key.toLowerCase();
    const arr = idx.get(key) ?? [];
    arr.push(r);
    idx.set(key, arr);
  }
  return idx;
}

export function pickLearnedRulesFor(
  index: Map<string, LearnedRule[]>,
  subject: string,
  scene?: string,
): LearnedRule[] {
  const subj = NORM(subject);
  const out: LearnedRule[] = [];
  for (const [key, rules] of index) {
    if (key === "__sea_scene__") {
      const isSea = /(sea|ocean|underwater|reef|lagoon|beach|coral)/i.test(scene ?? "") ||
        CETACEANS.has(subj) || RAYS.has(subj) || SEALS.has(subj);
      if (isSea) out.push(...rules);
      continue;
    }
    if (subj === key || subj.includes(key)) out.push(...rules);
  }
  return out;
}

// ─── DB access helpers (kept minimal so the pure logic above stays testable) ─

export async function loadActivePreventionRules(db: any): Promise<LearnedRule[]> {
  const { data, error } = await db
    .from("learned_prevention_rules")
    .select("pattern_key, species_key, gate, positive_clause, negative_clause, composition_hint, status, version")
    .eq("status", "active");
  if (error) {
    console.warn("[first-pass-learner] load rules failed:", error.message);
    return [];
  }
  return (data ?? []) as LearnedRule[];
}

/** Increment the defect ledger and auto-promote to active rule at >= 2. */
export async function recordDefectsAndLearn(
  db: any,
  ebook_id: string,
  hits: DefectHit[],
): Promise<{ recorded: number; promoted: string[] }> {
  const promoted: string[] = [];
  const now = new Date().toISOString();
  // Dedupe within this call so a single batch counts each pattern once per page.
  const seen = new Set<string>();
  const filtered: DefectHit[] = [];
  for (const h of hits) {
    const k = `${h.pattern_key}|${h.species_key}|${h.page ?? -1}`;
    if (seen.has(k)) continue;
    seen.add(k);
    filtered.push(h);
  }
  for (const h of filtered) {
    // Upsert counter
    const { data: existing } = await db
      .from("learned_defect_counts")
      .select("id, count")
      .eq("pattern_key", h.pattern_key)
      .eq("species_key", h.species_key)
      .maybeSingle();
    let nextCount = 1;
    if (existing?.id) {
      nextCount = (existing.count ?? 0) + 1;
      await db.from("learned_defect_counts")
        .update({ count: nextCount, last_seen_at: now, last_ebook_id: ebook_id, gate: h.gate })
        .eq("id", existing.id);
    } else {
      await db.from("learned_defect_counts").insert({
        pattern_key: h.pattern_key, species_key: h.species_key, gate: h.gate,
        count: 1, first_seen_at: now, last_seen_at: now, last_ebook_id: ebook_id,
      });
    }
    // Auto-promote when >= 2 occurrences and no active rule exists yet.
    if (nextCount >= 2) {
      const { data: existingRule } = await db
        .from("learned_prevention_rules")
        .select("id")
        .eq("pattern_key", h.pattern_key)
        .eq("species_key", h.species_key)
        .eq("status", "active")
        .maybeSingle();
      if (!existingRule?.id) {
        const clause = suggestClauseFor(h.pattern_key, h.species_key);
        if (clause) {
          await db.from("learned_prevention_rules").insert({
            pattern_key: h.pattern_key,
            species_key: h.species_key,
            gate: h.gate,
            positive_clause: clause.positive,
            negative_clause: clause.negative,
            composition_hint: clause.hint ?? "",
            source: "learned",
            occurrence_count: nextCount,
            status: "active",
          });
          promoted.push(`${h.pattern_key}:${h.species_key}`);
        }
      } else {
        await db.from("learned_prevention_rules")
          .update({ occurrence_count: nextCount, last_hit_at: now })
          .eq("id", existingRule.id);
      }
    }
  }
  return { recorded: filtered.length, promoted };
}

/** Static suggestion table used when auto-promoting a new pattern. */
function suggestClauseFor(pattern_key: string, species_key: string):
  { positive: string; negative: string; hint?: string } | null {
  switch (pattern_key) {
    case "cetacean_horizontal_flukes":
      return {
        positive: `Tail flukes spread HORIZONTALLY like a whale's tail (${species_key}), two lobes fanning left-right with a central notch, seen from the side.`,
        negative: "NOT a vertical fish tail; NOT a mermaid fin.",
        hint: "Side-profile composition preferred.",
      };
    case "narwhal_tusk_spec":
      return {
        positive: "Exactly ONE straight spiral tusk projecting forward from the UPPER LIP; pointed tip, helical grooves.",
        negative: "NOT a unicorn horn on the forehead; NOT multiple tusks; NOT bulbous.",
        hint: "Three-quarter or side profile so the tusk emerges from the mouth line.",
      };
    case "seal_two_front_flippers":
      return {
        positive: "Exactly TWO front flippers and TWO rear flippers — four flippers total.",
        negative: "NOT three front flippers; NOT extra limbs.",
      };
    case "ray_dorsal_view":
      return {
        positive: `Draw the ${species_key} from the DORSAL (top) view; diamond body, whip tail trailing behind.`,
        negative: "NOT the underside face-up view.",
        hint: "Top-down dorsal composition.",
      };
    case "sea_water_outline_only":
      return {
        positive: "Water surface rendered as thin outline strokes only; water areas remain OPEN for the child to color.",
        negative: "NOT solid-black-filled water; NOT dense hatch fill.",
      };
    case "extra_limb":
      return {
        positive: `Anatomically correct limb count for ${species_key}.`,
        negative: "NOT extra legs/arms/fins.",
      };
    case "fused_features":
      return {
        positive: `Every feature on the ${species_key} is drawn as a distinct clean shape with clear separations.`,
        negative: "NOT fused/conjoined body parts.",
      };
    case "solid_black_fill":
      return {
        positive: "All large regions remain OPEN (pure white interior) for coloring; outline strokes only.",
        negative: "NOT solid-black regions; NOT dense hatch fill.",
      };
    default:
      return null;
  }
}
