// Client-side mirror of the cover lettering + age-badge selection logic
// used by supabase/functions/coloring-v2-illustrated-cover-once. Kept in
// sync so regression tests can lock the contract without importing Deno.
//
// Law: cover_illustrated_lettering_v13

export const LETTERING_STYLE_IDS = [
  "chunky_puffy_multicolor",
  "cracked_metal_epic",
  "arcade_chrome_neon",
  "hand_painted_storybook",
  "balloon_bubble_gradient",
  "wood_carved_adventure",
] as const;
export type LetteringStyleId = typeof LETTERING_STYLE_IDS[number];

export function pickLetteringStyleId(bookId: string): LetteringStyleId {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 137 + bookId.charCodeAt(i)) >>> 0;
  return LETTERING_STYLE_IDS[h % LETTERING_STYLE_IDS.length];
}

export function ageBadgeLabel(ageBand?: string | null): string | null {
  const s = String(ageBand ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (!m) return null;
  return `AGES ${m[1]}-${m[2]}`;
}
