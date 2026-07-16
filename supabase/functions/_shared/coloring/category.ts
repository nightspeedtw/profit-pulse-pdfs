// Coloring-book category loader + subject gating.
// Categories live in public.coloring_categories; this module is the ONLY
// place callers should reach them from — never inline subject lists.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck  Edge-runtime module; Deno + npm: specifiers not typed by app tsconfig.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
declare const Deno: any;

export interface ColoringCategory {
  id: string;
  category_key: string;
  category_name: string;
  category_description: string;
  target_age_min: number;
  target_age_max: number;
  allowed_subjects: string[];
  allowed_supporting_elements: string[];
  forbidden_subjects: string[];
  line_art_style: string;
  complexity_level: "simple" | "medium" | "complex";
  background_complexity: string;
  trim_size: string;
  coloring_page_count: number;
}

export async function loadColoringCategory(
  supabase: SupabaseClient,
  category_key: string,
): Promise<ColoringCategory> {
  const { data, error } = await supabase
    .from("coloring_categories")
    .select("*")
    .eq("category_key", category_key)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`coloring category '${category_key}' not found`);
  return data as ColoringCategory;
}

/** Hard gate — main subject must belong to the category or the page fails. */
export function assertSubjectInCategory(
  cat: Pick<ColoringCategory, "allowed_subjects" | "forbidden_subjects" | "category_key">,
  subject: string,
): void {
  const s = subject.trim().toLowerCase();
  if (!s) throw new Error("empty subject");
  const forbidden = cat.forbidden_subjects.map((x) => x.toLowerCase());
  if (forbidden.some((f) => s.includes(f))) {
    throw new Error(`subject '${subject}' is forbidden in category '${cat.category_key}'`);
  }
  const allowed = cat.allowed_subjects.map((x) => x.toLowerCase());
  if (!allowed.some((a) => s === a || s.includes(a))) {
    throw new Error(`subject '${subject}' is not in allowed_subjects for '${cat.category_key}'`);
  }
}

export function isSubjectAllowed(
  cat: Pick<ColoringCategory, "allowed_subjects" | "forbidden_subjects">,
  subject: string,
): boolean {
  try {
    assertSubjectInCategory(cat as ColoringCategory, subject);
    return true;
  } catch {
    return false;
  }
}

export function makeServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}
