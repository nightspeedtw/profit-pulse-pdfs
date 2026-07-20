// ensureColoringLabel — coloring books must always advertise themselves as a
// "Coloring Book" on the storefront (owner order 2026-07-20). Titles like
// "Cyber City Countdown" confuse buyers unless the category is spelled out.
// Non-destructive: if the raw title already contains "Coloring", we return it
// unchanged. Otherwise we append " Coloring Book".
export function ensureColoringLabel(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  if (!t) return "Coloring Book";
  if (/coloring/i.test(t)) return t;
  return `${t} Coloring Book`;
}
