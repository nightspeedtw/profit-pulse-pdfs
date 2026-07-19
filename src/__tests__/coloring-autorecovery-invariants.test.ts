import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("coloring technical auto-recovery invariants", () => {
  it("quota wake sweep treats Runware as a healthy provider and never waits on fal", () => {
    const src = read("supabase/functions/coloring-worker-tick/index.ts");
    expect(src).toContain("runwareHealthy");
    expect(src).toContain("provider_billing_blocked.runware");
    expect(src).toContain("falHealthy = false");
    expect(src).toContain("all_configured_providers_still_dry");
    expect(src).not.toContain("both_providers_still_dry");
  });

  it("cover retry ceiling is consistent across dispatcher and cover workers", () => {
    const worker = read("supabase/functions/coloring-worker-tick/index.ts");
    const splitGenerate = read("supabase/functions/coloring-cover-generate/index.ts");
    const legacyCover = read("supabase/functions/coloring-book-cover/index.ts");

    expect(worker).toContain("const COVER_INVOCATION_CEILING = 8");
    expect(splitGenerate).toContain("const MAX_COVER_INVOCATIONS_PER_BOOK = 8");
    expect(legacyCover).toContain("const MAX_COVER_INVOCATIONS_PER_BOOK = 8");
  });

  it("missing max_parallel defaults to batch_size, not a single slot", () => {
    const worker = read("supabase/functions/coloring-worker-tick/index.ts");
    expect(worker).toContain("cfg.max_parallel ?? cfg.batch_size ?? 3");
  });

  it("paid ceiling no longer creates owner-wait dead states for coloring recovery", () => {
    const paid = read("supabase/functions/_shared/paid-ceiling.ts");
    expect(paid).toContain("coloring_cover_any: 40");
    expect(paid).toContain('pipeline_status: "queued"');
    expect(paid).not.toContain('pipeline_status: "awaiting_owner"');
  });

  it("cover workers use singleton backend clients", () => {
    const generate = read("supabase/functions/coloring-cover-generate/index.ts");
    const cover = read("supabase/functions/coloring-book-cover/index.ts");
    expect(generate).toContain("const db = createClient(SUPABASE_URL, SERVICE_KEY");
    expect(cover).toContain("const db = createClient(SUPABASE_URL, SERVICE_KEY");
  });

  it("coloring cover ceiling is not a human-review pause", () => {
    const generate = read("supabase/functions/coloring-cover-generate/index.ts");
    const cover = read("supabase/functions/coloring-book-cover/index.ts");
    const worker = read("supabase/functions/coloring-worker-tick/index.ts");
    expect(`${generate}\n${cover}\n${worker}`).not.toContain('awaiting: "human_review"');
    expect(`${generate}\n${cover}\n${worker}`).not.toContain('human_review');
    expect(`${generate}\n${cover}\n${worker}`).not.toMatch(/human review/i);
    expect(`${generate}\n${cover}\n${worker}`).toContain('awaiting: "cover_retry_ceiling"');
  });
});