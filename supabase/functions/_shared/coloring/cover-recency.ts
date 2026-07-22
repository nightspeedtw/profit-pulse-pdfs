// Recency-avoidance selector for cover style/layout families.
// Reads the last N cover picks from `coloring_v2_assets.meta.cover_family`
// (kind='cover_final') so the catalog stays visually diverse.

import type { StyleFamilyId, LayoutFamilyId } from "./style-families.ts";

export interface RecencyPicks {
  families: StyleFamilyId[];
  layouts: LayoutFamilyId[];
}

// Deno-lite: caller supplies a `db` client compatible with supabase-js.
export async function loadRecencyPicks(db: any, windowSize = 15): Promise<RecencyPicks> {
  try {
    const { data } = await db.from("coloring_v2_assets")
      .select("meta, created_at")
      .eq("kind", "cover_final")
      .order("created_at", { ascending: false })
      .limit(windowSize);
    const families: StyleFamilyId[] = [];
    const layouts: LayoutFamilyId[] = [];
    for (const row of (data ?? [])) {
      const m = (row?.meta ?? {}) as Record<string, any>;
      const fam = m?.cover_family?.style_family_id ?? m?.style_family_id;
      const lay = m?.cover_family?.layout_family_id ?? m?.layout_family_id;
      if (typeof fam === "string") families.push(fam as StyleFamilyId);
      if (typeof lay === "string") layouts.push(lay as LayoutFamilyId);
    }
    return { families, layouts };
  } catch {
    return { families: [], layouts: [] };
  }
}
