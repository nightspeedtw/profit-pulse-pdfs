// plan-rehydrate.ts — defect class fix for the "page-plan persistence"
// contract violation.
//
// Defect: a coloring_book row can lose metadata.coloring_page_plan.plan
// after creation. Suspected root cause: patchMeta uses a non-atomic
// read-merge-write; two overlapping updates race and the later writer
// clobbers content-identity keys with an older snapshot that predates
// coloring-book-start's write.
//
// Detection heuristic (contract violation):
//   book_type='coloring_book'
//   AND (metadata->'coloring_page_plan'->'plan') IS NULL
//   AND (row exists past initial insert — e.g. any coloring_* op keys present,
//        or coloring_pages already contains entries, or ebook_assets rows exist).
//
// Recovery contract (this module):
//   1. If existing coloring_pages exist → derive category_key from them.
//   2. Else derive category_key from row.metadata.coloring_category_key.
//   3. Else infer category_key from title (whitelist match).
//   4. Regenerate the deterministic PagePlan and persist it back with
//      the theme_bible and style_contract, so downstream renders resume
//      from checkpoint (donePages already stored).
//   5. Never overwrite an existing plan.
//
// This is idempotent and cheap. Emits a warning log so we can track how
// often the race actually fires in production.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { loadColoringCategory } from "./category.ts";
import { generatePagePlan } from "./page-plan.ts";
import { DEFAULT_KIDS_4_6_STYLE } from "./style-contract.ts";
import { sanitizeMetadataPatchForPersist } from "./metadata-bloat-guard.ts";

export interface RehydrateResult {
  restored: boolean;
  reason: string | null;
  plan: any[];
  planWrap: { plan: any[]; category_key: string; generated_at?: string };
  category_key: string | null;
}

/** Titles → category_key inference. Whitelist-only; unmatched returns null. */
function inferCategoryKeyFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/dinosaur/i, "dinosaurs"],
    [/sea animal|ocean creature|under.?the.?sea/i, "sea_animals"],
    [/mermaid/i, "mermaid_ocean_fantasy"],
    [/farm.*wood|woodland/i, "farm_and_woodland"],
    [/pet|cats?.*dogs?|puppies|kittens/i, "pets_cats_dogs"],
    [/floral|botanical|flower/i, "floral_botanical"],
    [/unicorn/i, "unicorn_fantasy"],
    [/princess|fairy|magic/i, "princess_fairy_magic"],
    [/preschool|toddler/i, "preschool_toddler"],
    [/holiday|season|christmas|halloween|easter/i, "seasonal_holidays"],
  ];
  for (const [re, key] of table) if (re.test(t)) return key;
  return null;
}

export async function rehydratePagePlan(
  db: any,
  row: { id: string; title: string | null; metadata: Record<string, unknown> | null },
): Promise<RehydrateResult> {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const existingWrap = meta.coloring_page_plan as
    | { plan?: any[]; category_key?: string; generated_at?: string }
    | undefined;
  if (existingWrap?.plan && Array.isArray(existingWrap.plan) && existingWrap.plan.length > 0) {
    return {
      restored: false,
      reason: null,
      plan: existingWrap.plan,
      planWrap: {
        plan: existingWrap.plan,
        category_key: existingWrap.category_key ?? (meta.coloring_category_key as string) ?? "",
        generated_at: existingWrap.generated_at,
      },
      category_key: existingWrap.category_key ?? (meta.coloring_category_key as string) ?? null,
    };
  }

  // Resolve category_key from the strongest available source.
  const storedPages = (meta.coloring_pages as Array<{ category_key?: string }> | undefined) ?? [];
  const fromPages = storedPages.find((p) => p && typeof p.category_key === "string")?.category_key;
  const fromMeta = (meta.coloring_category_key as string | undefined)
    ?? ((meta.coloring_theme_bible as any)?.category_key as string | undefined);
  const fromTitle = inferCategoryKeyFromTitle(row.title);
  const category_key = fromPages ?? fromMeta ?? fromTitle;
  if (!category_key) {
    return {
      restored: false,
      reason: "no_category_key_inferable",
      plan: [],
      planWrap: { plan: [], category_key: "" },
      category_key: null,
    };
  }

  const cat = await loadColoringCategory(db, category_key);
  const count = Number(meta.coloring_page_count as number | undefined)
    || cat.coloring_page_count
    || 32;
  const pagePlan = generatePagePlan({ ...cat, coloring_page_count: count });

  // Merge back safely. Preserve all other operational keys; only set the
  // content-identity keys that are missing or stale.
  const { data: current } = await db
    .from("ebooks_kids").select("metadata").eq("id", row.id).maybeSingle();
  const cur = (current?.metadata ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = sanitizeMetadataPatchForPersist({
    ...cur,
    coloring_category_key: cur.coloring_category_key ?? category_key,
    coloring_page_count: cur.coloring_page_count ?? count,
    coloring_theme_bible: cur.coloring_theme_bible ?? {
      category_key: cat.category_key,
      category_name: cat.category_name,
      allowed_subjects: cat.allowed_subjects,
      forbidden_subjects: cat.forbidden_subjects,
    },
    coloring_style_contract: cur.coloring_style_contract ?? DEFAULT_KIDS_4_6_STYLE,
    coloring_page_plan: pagePlan,
    coloring_plan_rehydrated_at: new Date().toISOString(),
    coloring_plan_rehydrated_reason: "persistence_contract_violation_recovered",
  });
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", row.id);

  // Best-effort event log for observability. Not fatal if the table denies.
  try {
    await db.from("pipeline_step_logs").insert({
      ebook_id: row.id,
      step: "plan_rehydrate",
      status: "recovered",
      error_class: "persistence_contract_bug",
      details: {
        source: fromPages ? "coloring_pages" : fromMeta ? "metadata" : "title",
        category_key,
        page_count: count,
        had_stored_pages: storedPages.length,
      },
    });
  } catch (_e) { /* best-effort */ }

  console.warn(
    `[plan-rehydrate] restored plan for ${row.id} category=${category_key} count=${count} ` +
    `source=${fromPages ? "coloring_pages" : fromMeta ? "metadata" : "title"}`,
  );

  return {
    restored: true,
    reason: "persistence_contract_violation_recovered",
    plan: pagePlan.plan,
    planWrap: { plan: pagePlan.plan, category_key, generated_at: pagePlan.generated_at },
    category_key,
  };
}
