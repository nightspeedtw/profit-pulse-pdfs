import { supabase } from "@/integrations/supabase/client";

export interface KidsAgeGroup {
  id: string;
  slug: string;
  label_th: string;
  label_en: string;
  min_age: number;
  max_age: number;
  sort_order: number;
}

export interface KidsTheme {
  id: string;
  slug: string;
  label_th: string;
  label_en: string;
  icon_name: string | null;
  sort_order: number;
}

export interface BookSeries {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  sort_order: number;
}

export async function listAgeGroups(): Promise<KidsAgeGroup[]> {
  const { data, error } = await supabase
    .from("kids_age_groups")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KidsAgeGroup[];
}

export async function listThemes(): Promise<KidsTheme[]> {
  const { data, error } = await supabase
    .from("kids_themes")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KidsTheme[];
}

export async function listSeries(): Promise<BookSeries[]> {
  const { data, error } = await supabase
    .from("book_series")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BookSeries[];
}
