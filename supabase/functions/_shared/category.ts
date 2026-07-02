// Ebook category classifier + worksheet/kind gating.
// Keeps debt/finance-specific templates out of unrelated books (energy,
// productivity, wellness, etc.) and provides safer default prompts.

export type EbookCategory =
  | "finance_debt"
  | "finance_cashflow"
  | "productivity"
  | "energy_health"
  | "wellness"
  | "relationship"
  | "career"
  | "business"
  | "marketing"
  | "ai_automation"
  | "other";

export function classifyEbook(title: string, subtitle?: string | null): EbookCategory {
  const t = `${title ?? ""} ${subtitle ?? ""}`.toLowerCase();
  if (/\b(debt|creditor|apr|payoff|snowball|avalanche|collections?)\b/.test(t)) return "finance_debt";
  if (/\b(cash\s*flow|budget|save|savings?|fortress|financ|money|income|wealth|frugal|emergency\s*fund|net\s*worth)\b/.test(t)) return "finance_cashflow";
  if (/\b(focus|deep\s*work|productiv|distraction|interruption|calendar|meeting|workday|attention|procrastin)\b/.test(t)) return "productivity";
  if (/\b(energy|fatigue|sleep|caffeine|circadian|crash|burnout|recover|adrenal)\b/.test(t)) return "energy_health";
  if (/\b(health|wellness|nutrition|diet|fitness|exercise|weight|habit)\b/.test(t)) return "wellness";
  if (/\b(relationship|dating|marriage|communicat|boundar|conflict)\b/.test(t)) return "relationship";
  if (/\b(career|resume|interview|promotion|leadership|manager)\b/.test(t)) return "career";
  if (/\b(business|startup|founder|entrepreneur|revenue|client|freelanc)\b/.test(t)) return "business";
  if (/\b(marketing|seo|copywrit|funnel|ads?|social\s*media|brand)\b/.test(t)) return "marketing";
  if (/\b(ai|automation|chatgpt|prompt|workflow|no[-\s]?code)\b/.test(t)) return "ai_automation";
  return "other";
}

// Kinds allowed per category. If a chapter tries to use a kind not in this list,
// we fall back to `prompts` with category-appropriate default prompts.
const ALLOWED: Record<EbookCategory, string[]> = {
  finance_debt: ["debt_tracker", "velocity_calculator", "negotiation_script", "automation_flow", "resilience_scorecard", "operating_manual", "sprint_timeline", "prompts"],
  finance_cashflow: ["velocity_calculator", "automation_flow", "resilience_scorecard", "operating_manual", "sprint_timeline", "prompts"],
  productivity: ["prompts", "sprint_timeline", "automation_flow", "operating_manual", "resilience_scorecard"],
  energy_health: ["prompts", "resilience_scorecard", "operating_manual", "automation_flow"],
  wellness: ["prompts", "resilience_scorecard", "operating_manual"],
  relationship: ["prompts", "resilience_scorecard"],
  career: ["prompts", "resilience_scorecard", "negotiation_script"],
  business: ["prompts", "operating_manual", "automation_flow", "sprint_timeline"],
  marketing: ["prompts", "operating_manual", "sprint_timeline"],
  ai_automation: ["prompts", "automation_flow", "operating_manual"],
  other: ["prompts", "resilience_scorecard", "operating_manual"],
};

export function isKindAllowed(category: EbookCategory, kind: string): boolean {
  return (ALLOWED[category] ?? ALLOWED.other).includes(kind);
}

export function defaultPromptsFor(category: EbookCategory, chapterTitle: string): string[] {
  const t = chapterTitle || "this chapter";
  switch (category) {
    case "productivity":
      return [
        `What is the single biggest source of interruption during your deepest work window this week?`,
        `Which specific meeting, message channel, or task can you remove in the next 24 hours?`,
        `What signal will tell you the change is working within 7 days?`,
      ];
    case "energy_health":
      return [
        `When did your energy last crash today, and what happened in the 90 minutes before?`,
        `Which one input (caffeine, screen, sleep, food) will you adjust first, and how?`,
        `What will you measure this week to know the change is real?`,
      ];
    case "wellness":
      return [
        `Which small daily habit from this chapter fits your current routine?`,
        `What obstacle is most likely to stop you, and what will you do when it appears?`,
        `How will you track progress for the next 14 days?`,
      ];
    case "finance_debt":
    case "finance_cashflow":
      return [
        `Which single dollar amount from this chapter matters most for your situation?`,
        `What one action in the next 48 hours moves the number in the right direction?`,
        `What weekly check will you set up to keep it on track?`,
      ];
    case "business":
    case "marketing":
      return [
        `Which specific customer or offer does this chapter point you toward?`,
        `What is the smallest test you can run this week to validate it?`,
        `What number will tell you the test worked?`,
      ];
    default:
      return [
        `What is the most important lesson from "${t}" for your situation right now?`,
        `What will you do in the next 24 hours to apply it?`,
        `What will you notice when it's working?`,
      ];
  }
}
