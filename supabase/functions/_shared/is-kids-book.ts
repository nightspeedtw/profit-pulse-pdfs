// Detect kids picture-book ebooks so adult-book pipelines (generate-outline,
// write-chapters, qc-fix, autopilot-orchestrator) don't stomp their title,
// subtitle, TOC, or chapters. Kids books use a completely different pipeline
// (rewrite-kids-manuscript → render-pdf with per-spread illustrations) and
// share none of the adult schema (10-chapter TOC, worksheets, bonuses).
export function isKidsBook(ebook: Record<string, unknown> | null | undefined): boolean {
  if (!ebook) return false;
  const e = ebook as Record<string, any>;
  if (e.kids_scene_briefs_json && typeof e.kids_scene_briefs_json === "object") return true;
  if (e.kids_visual_bible && typeof e.kids_visual_bible === "object") return true;
  const slug = String(e.category_slug ?? "").toLowerCase();
  if (slug === "parenting-kids" || slug === "kids-books" || slug === "kids") return true;
  const pt = String(e.product_type ?? "").toLowerCase();
  if (pt === "kids-book" || pt === "picture-book" || pt === "children-book") return true;
  return false;
}

export function kidsGuardResponse(ebookId: string, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({
      skipped: true,
      reason: "kids-book",
      message:
        "This ebook is a kids picture book. Adult ebook pipelines (outline, chapters, qc-fix) are skipped to avoid overwriting the kids manuscript. Use rewrite-kids-manuscript + render-pdf instead.",
      ebook_id: ebookId,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
