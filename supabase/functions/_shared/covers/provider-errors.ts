// Pure helpers for the cover ladder — kept free of Deno imports so unit
// tests (vitest) can pull them without dragging edge-runtime modules.

/**
 * Provider billing / quota errors are NOT rung faults. They mean the
 * generator's wallet is empty or throttled — burning 5 rungs on the same
 * $0 wallet just destroys evidence. Detect and short-circuit into a paused
 * blocker state instead.
 *
 * Evidence patterns captured from the a05a5086 ladder run:
 *   • fal 403: "User is locked. Reason: Exhausted balance."
 *   • gemini 429: "You exceeded your current quota"
 */
export function classifyProviderError(reason: string | null | undefined):
  | "billing_exhausted"
  | "quota_exceeded"
  | null {
  if (!reason) return null;
  const s = reason.toLowerCase();
  if (
    s.includes("user is locked") ||
    s.includes("exhausted balance") ||
    s.includes("insufficient credit") ||
    s.includes("top up your balance")
  ) return "billing_exhausted";
  if (
    s.includes(" 429") ||
    s.includes("quota") ||
    s.includes("rate limit") ||
    s.includes("exceeded your current quota")
  ) return "quota_exceeded";
  return null;
}
