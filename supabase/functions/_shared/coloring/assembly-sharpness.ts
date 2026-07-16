// Pure assembly-time sharpness preflight. The edge function computes the
// per-page scores from pixels, then uses this helper to decide whether PDF
// assembly may embed the page set or must requeue blurry legacy pages.

export interface AssemblySharpnessRow {
  page: number;
  score: number;
  min_required: number;
  pass: boolean;
  reason?: string | null;
}

export function decideAssemblySharpnessPreflight(rows: AssemblySharpnessRow[]) {
  const failures = rows
    .filter((r) => !r.pass || String(r.reason ?? "").startsWith("unmeasured:"))
    .map((r) => r.page)
    .sort((a, b) => a - b);
  return {
    pass: rows.length > 0 && failures.length === 0,
    failures,
    action: failures.length > 0 ? "regenerate_blurry_pages" as const : "assemble" as const,
  };
}
