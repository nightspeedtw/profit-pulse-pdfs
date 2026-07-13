// Weighted-random style picker with recency penalty so the autopilot rotates
// through the style pool instead of locking one style forever.
import { createClient } from "npm:@supabase/supabase-js@2";

type Db = ReturnType<typeof createClient>;

export type StylePreset = {
  id: string;
  slug: string;
  label: string;
  prompt_suffix: string;
  negative_prompt: string | null;
  weight: number;
  times_used: number;
  last_used_at: string | null;
};

/**
 * Pick a style using weight × recency-penalty. Styles used in the last N picks
 * get their effective weight halved so we don't repeat immediately.
 */
export async function pickStyle(db: Db): Promise<StylePreset> {
  const { data, error } = await db
    .from("kids_style_presets")
    .select("id, slug, label, prompt_suffix, negative_prompt, weight, times_used, last_used_at")
    .eq("enabled", true);
  if (error) throw error;
  const styles = (data ?? []) as StylePreset[];
  if (!styles.length) throw new Error("no enabled style presets");

  const now = Date.now();
  const scored = styles.map((s) => {
    let w = Math.max(1, s.weight);
    if (s.last_used_at) {
      const ageHrs = (now - new Date(s.last_used_at).getTime()) / 36e5;
      if (ageHrs < 6) w *= 0.25;
      else if (ageHrs < 24) w *= 0.6;
    }
    return { s, w };
  });
  const total = scored.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * total;
  for (const { s, w } of scored) {
    r -= w;
    if (r <= 0) return s;
  }
  return scored[scored.length - 1].s;
}

export async function markStyleUsed(db: Db, id: string): Promise<void> {
  const { data } = await db.from("kids_style_presets").select("times_used").eq("id", id).single();
  const t = ((data as { times_used?: number } | null)?.times_used ?? 0) + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from("kids_style_presets") as any)
    .update({ last_used_at: new Date().toISOString(), times_used: t })
    .eq("id", id);
}
