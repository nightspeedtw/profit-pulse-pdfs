// Milestone 2 — Premium Title & Hard-Sell Copywriter scoring types.
// Shared between the Admin Ideas dashboard and the edge function response shape.

export interface IdeaObjectionHandling {
  too_expensive: string;
  not_for_me: string;
  free_info: string;
  no_time: string;
}

export type IdeaWorkflowStatus = "pass" | "needs_alternatives" | "reject";

export interface IdeaConcept {
  title: string;
  subtitle: string;
  hook: string;
  target_buyer: string;
  core_pain_point: string;
  deeper_emotional_fear: string;
  transformation_promise: string;
  value_proposition: string;
  hard_sell_opening: string;
  objection_handling: IdeaObjectionHandling;
  buyer_appeal_score: number;
  premium_score: number;
  hard_sell_strength_score: number;
  compliance_risk_score: number; // 1–10, lower = safer
  idea_score: number;
  status: IdeaWorkflowStatus;
  compliance_notes: string;
}

export const IDEA_THRESHOLDS = {
  buyer_appeal_min: 80,
  premium_min: 80,
  hard_sell_strength_min: 75,
  idea_min: 80,
  compliance_risk_max: 4,
  compliance_risk_reject: 6,
} as const;

export interface IdeaGate {
  status: IdeaWorkflowStatus;
  failed: string[];
  reason: string;
}

const UNSAFE_PATTERNS = [
  /guarantee[d]?\s+(income|return|results?|profit|cure|outcome|weight\s*loss)/i,
  /100%\s+(safe|guaranteed|cure)/i,
  /risk[-\s]?free/i,
  /miracle\s+(cure|drug|results?)/i,
  /lose\s+\d+\s*(lbs?|kg|pounds)\s+in\s+\d+\s*(days?|weeks?)/i,
  /legally\s+win\s+(your|the)\s+case/i,
];

export function containsUnsafeClaim(text: string | null | undefined): boolean {
  if (!text) return false;
  return UNSAFE_PATTERNS.some((re) => re.test(text));
}

export function gateIdea(c: Pick<
  IdeaConcept,
  | "buyer_appeal_score"
  | "premium_score"
  | "hard_sell_strength_score"
  | "compliance_risk_score"
  | "idea_score"
  | "hard_sell_opening"
  | "transformation_promise"
  | "value_proposition"
>): IdeaGate {
  const failed: string[] = [];

  // Hard reject on unsafe claims or extreme compliance risk.
  const unsafeText = [c.hard_sell_opening, c.transformation_promise, c.value_proposition]
    .map((t) => t ?? "")
    .find(containsUnsafeClaim);
  if (unsafeText) {
    return {
      status: "reject",
      failed: ["unsafe_claim"],
      reason: "Contains a fake guarantee or unsafe outcome claim.",
    };
  }
  if (c.compliance_risk_score > IDEA_THRESHOLDS.compliance_risk_reject) {
    return {
      status: "reject",
      failed: ["compliance_risk"],
      reason: `compliance_risk=${c.compliance_risk_score} > ${IDEA_THRESHOLDS.compliance_risk_reject}`,
    };
  }

  if (c.buyer_appeal_score < IDEA_THRESHOLDS.buyer_appeal_min) failed.push(`buyer_appeal=${c.buyer_appeal_score}`);
  if (c.premium_score < IDEA_THRESHOLDS.premium_min) failed.push(`premium=${c.premium_score}`);
  if (c.hard_sell_strength_score < IDEA_THRESHOLDS.hard_sell_strength_min) failed.push(`hard_sell=${c.hard_sell_strength_score}`);
  if (c.idea_score < IDEA_THRESHOLDS.idea_min) failed.push(`idea=${c.idea_score}`);
  if (c.compliance_risk_score > IDEA_THRESHOLDS.compliance_risk_max) failed.push(`compliance=${c.compliance_risk_score}`);

  if (failed.length === 0) return { status: "pass", failed, reason: "All thresholds met." };
  return { status: "needs_alternatives", failed, reason: failed.join(", ") };
}
