// Smarter repair ladder for coloring pages.
// After a page fails a gate, decide the next action instead of blind retry:
//
//   attempt 1 → "repair"     (regenerate same prompt, new seed)
//   attempt 2 → "revise"     (regenerate with structural anatomy/composition
//                             corrective clauses injected)
//   attempt 3 → "simplify"   (reduce complexity, drop secondary_subjects,
//                             switch composition to single_subject_centered)
//   attempt 4+ → "escalate"  (never silently retire — bubble up to owner)
//
// This is deterministic + cheap; it does NOT lower a QC threshold.

import type { PagePlanEntry } from "./style-contract.ts";

export type RepairAction = "repair" | "revise" | "simplify" | "escalate";

export type FailureClass =
  | "minor_line_noise"
  | "solid_black_fill"
  | "anatomy_structural"
  | "composition_off"
  | "off_category"
  | "text_or_watermark"
  | "sharpness_below_floor"
  | "unknown";

export interface RepairDecision {
  action: RepairAction;
  revised_page: PagePlanEntry;
  prompt_additions: string[];
  attempt: number;
  rationale: string;
}

export function classifyFailure(reasons: string[]): FailureClass {
  const s = reasons.join(" | ").toLowerCase();
  if (/sharpness_below_floor|sharpness_gate/.test(s)) return "sharpness_below_floor";
  if (/watermark|signature|random_text|letters/.test(s)) return "text_or_watermark";
  if (/anatom|limb|finger|paw|horn|wing|tail|fin|face|eyes|beak|mouth|mermaid|balloon|leaf-shaped|malformed|fused|extra/.test(s)) return "anatomy_structural";
  if (/solid.?black|black_pixel_ratio|black_cluster/.test(s)) return "solid_black_fill";
  if (/composition|cropped|margin|scale|centered/.test(s)) return "composition_off";
  if (/out_of_category|not in allowed_subjects|forbidden/.test(s)) return "off_category";
  if (/line|cleanliness|noise|jaggy/.test(s)) return "minor_line_noise";
  return "unknown";
}

const CORRECTIVE_CLAUSES: Record<FailureClass, string[]> = {
  minor_line_noise: [
    "Clean smooth continuous black contour lines, no sketch noise, no double lines",
  ],
  solid_black_fill: [
    "NO large solid-black fills anywhere",
    "Every enclosed region MUST be white so a child can color it",
    "Use outlines only, never filled black shapes",
    "Suggest water with a few thin outline wave lines and bubbles only; NEVER fill water areas",
    "No solid water mass, no shaded ocean background, no black sea silhouette",
  ],

  anatomy_structural: [
    "Anatomically correct: exactly the expected number of limbs, fingers/paws, eyes, ears, wings, tails and horns for this subject",
    "No fused, missing, or extra body parts",
    "Faces must be coherent with symmetric, readable features",
    "Follow the injected species anatomy checklist EXACTLY (body_parts + proportion_rules + avoid failure modes)",
  ],
  composition_off: [
    "Single well-centered subject, generous safe margin on all four sides",
    "Do not crop the subject; keep the whole body inside the page",
  ],
  off_category: [
    "Subject must remain strictly inside the declared category; drop any unrelated objects",
  ],
  text_or_watermark: [
    "Absolutely NO text, letters, numbers, signatures, watermarks or logos anywhere",
  ],
  sharpness_below_floor: [
    "Crisp clean vector-like thick black outlines, high contrast, sharp edges, no blur, no soft haze",
    "Uniform bold contour weight, no faint or sketchy strokes",
    "Print-ready coloring page line art, well-defined shapes with clearly closed regions",
  ],
  unknown: [
    "Follow the frozen style contract exactly; keep the page printable and colorable",
  ],
};

export function decideRepair(
  page: PagePlanEntry,
  attempt: number,
  reasons: string[],
): RepairDecision {
  const failure = classifyFailure(reasons);
  const additions = CORRECTIVE_CLAUSES[failure];

  if (attempt <= 1 && failure !== "anatomy_structural" && failure !== "composition_off") {
    return {
      action: "repair",
      revised_page: page,
      prompt_additions: additions,
      attempt,
      rationale: `attempt ${attempt}: minor failure (${failure}), regenerate with same plan + corrective clauses`,
    };
  }

  if (attempt <= 2) {
    return {
      action: "revise",
      revised_page: page,
      prompt_additions: additions,
      attempt,
      rationale: `attempt ${attempt}: structural failure (${failure}), regenerate with corrective clauses`,
    };
  }

  if (attempt === 3) {
    // Simplify: strip secondary subjects, force single_subject_centered,
    // downgrade complexity, keep required primary subject.
    return {
      action: "simplify",
      revised_page: {
        ...page,
        secondary_subjects: [],
        complexity: "simple",
        composition_type: "single_subject_centered",
        scene: `${page.primary_subject} portrait, simple pose, minimal background`,
      },
      prompt_additions: [
        ...additions,
        "Drastically simplified page: one subject, minimal background, extra large clean lines",
      ],
      attempt,
      rationale: `attempt ${attempt}: simplification pass — reduce scene complexity to converge`,
    };
  }

  return {
    action: "escalate",
    revised_page: page,
    prompt_additions: additions,
    attempt,
    rationale: `attempt ${attempt}: escalate to owner; never silently retire`,
  };
}

// Plan-level rescue for escalated pages: rewrite the scene to the
// guaranteed-simple portrait template, clear secondary subjects, and drop
// any risky "open water" / large-fill phrasing. Caller resets the page's
// repair_attempts to 0 and logs into metadata.coloring_replans.
// Only ONE replan cycle per page — if the replanned page also escalates,
// the caller must set blocker_reason='coloring_page_dead' (learn-then-retry
// class) and surface it, never idle-loop.
const OPEN_WATER_RE = /\b(open water|deep sea|underwater|ocean depths?|swim(?:ming)? through|in the sea|beneath the waves|water background)\b/gi;

export function sanitizeSceneForColorability(scene: string): string {
  return scene.replace(OPEN_WATER_RE, "").replace(/\s{2,}/g, " ").trim();
}

export function replanEscalatedPage(page: PagePlanEntry): PagePlanEntry {
  const subject = page.primary_subject;
  return {
    ...page,
    secondary_subjects: [],
    complexity: "simple",
    composition_type: "single_subject_centered",
    scene: `${subject} friendly portrait, simple pose, plain white background, no water mass, no background fill`,
    scene_bucket: "portrait",
  } as PagePlanEntry;
}

