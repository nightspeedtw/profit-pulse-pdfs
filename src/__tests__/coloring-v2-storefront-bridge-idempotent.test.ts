// Regression: the V2 → ebooks_kids storefront bridge must be idempotent.
// Root cause of the July 2026 duplicate-storefront-cards bug: the publish
// stage did a blind `.insert()` into ebooks_kids on every republish, so one
// V2 book showed as 4 live cards. Fix = upsert keyed on the dedicated
// `coloring_v2_book_id` column, protected by a partial UNIQUE index.
//
// This test locks in BOTH halves of the invariant:
//   1. The bridge code calls `.upsert(..., { onConflict: "coloring_v2_book_id" })`
//      and sets `coloring_v2_book_id` on the payload — never a bare
//      `.insert()` — so 3 publishes yield exactly 1 storefront row.
//   2. The unique-index migration file exists and targets that column.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BRIDGE_PATH = "supabase/functions/coloring-v2-publish/index.ts";
const MIGRATIONS_DIR = "supabase/migrations";

describe("coloring_v2_storefront_bridge_idempotent", () => {
  const src = readFileSync(BRIDGE_PATH, "utf-8");

  it("bridge upserts on coloring_v2_book_id (no blind insert)", () => {
    // The payload must carry the FK column so the ON CONFLICT clause has
    // something to match, and the write must go through upsert(...).
    expect(src).toMatch(/coloring_v2_book_id:\s*book_id/);
    expect(src).toMatch(
      /\.upsert\([^)]*\{\s*onConflict:\s*["']coloring_v2_book_id["']/,
    );
    // Guard against regression to the old blind-insert path.
    expect(src).not.toMatch(/\.from\(["']ebooks_kids["']\)\s*\.insert\(/);
  });

  it("a migration installs the partial UNIQUE index that enforces one storefront row per V2 book", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const hit = files.some((f) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
      return (
        /add column if not exists\s+coloring_v2_book_id\s+uuid/i.test(sql) &&
        /create unique index[^;]*coloring_v2_book_id[^;]*where\s+coloring_v2_book_id\s+is\s+not\s+null/i.test(
          sql,
        )
      );
    });
    expect(hit).toBe(true);
  });
});
