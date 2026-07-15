import { describe, expect, it } from "vitest";
import { parseSegmentedWriterOutput, validateSegments } from "../../supabase/functions/_shared/kids-segments";
import type { KidsSegment, SegmentedManuscript } from "../../supabase/functions/_shared/kids-segments";

const page = (n: number) => ({ page: n, text: `Chef Pip stirred bright berry jam with a patient little spoon on page ${n}.` });
const pagesOf = (value: Record<string, unknown>) => value.pages as KidsSegment[];

describe("kids segmented writer parser recovery", () => {
  it("recovers markdown-fenced JSON", () => {
    const raw = `\`\`\`json\n${JSON.stringify({ title: "Chef Pip", refrain: "Stir, Pip, stir!", pages: [page(1), page(2)] })}\n\`\`\``;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(pagesOf(parsed.value)).toHaveLength(2);
    expect(parsed.diagnostics.repairs).toContain("code_fence_stripped");
  });

  it("extracts the outer JSON object before trailing garbage", () => {
    const raw = `${JSON.stringify({ title: "Chef Pip", refrain: "Stir, Pip, stir!", pages: [page(1)] })}\nThanks for reading!`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(pagesOf(parsed.value)[0].page).toBe(1);
    expect(parsed.diagnostics.repairs).toContain("outer_json_extracted");
  });

  it("repairs a missing comma after a string property value", () => {
    const raw = `{"title":"Chef Pip","refrain":"Stir, Pip, stir!","pages":[{"page":1,"text":"Chef Pip stirred sticky jam with care." "note":"bad comma"},{"page":2,"text":"The spoon made tiny circles in the pot."}]}`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(pagesOf(parsed.value)).toHaveLength(2);
    expect(parsed.diagnostics.repairs).toEqual(expect.arrayContaining(["missing_comma_inserted"]));
  });

  it("salvages complete page objects from a truncated array element", () => {
    const raw = `{"title":"Chef Pip","refrain":"Stir, Pip, stir!","pages":[${JSON.stringify(page(1))},${JSON.stringify(page(2))},{"page":3,"text":"broken`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.partial).toBe(true);
    expect(pagesOf(parsed.value).map((p) => p.page)).toEqual([1, 2]);
    expect(parsed.diagnostics.repairs).toContain("complete_pages_salvaged");
  });

  it("treats an empty JSON object as a parse failure so the retry ladder continues", () => {
    const parsed = parseSegmentedWriterOutput("{}");
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.errors.some((e) => e.includes("writer_output_missing_pages"))).toBe(true);
    expect(parsed.diagnostics.raw_model_output).toBe("{}");
  });

  it("treats a JSON object with an empty pages array as a parse failure", () => {
    const parsed = parseSegmentedWriterOutput(JSON.stringify({ title: "x", refrain: "y", pages: [] }));
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.errors.some((e) => e.includes("writer_output_missing_pages"))).toBe(true);
  });

  it("treats a JSON object with a mis-keyed pages field as a parse failure (no silent success)", () => {
    // Model returns valid JSON but uses `story` instead of `pages`.
    const parsed = parseSegmentedWriterOutput(JSON.stringify({ title: "x", refrain: "y", story: [page(1), page(2)] }));
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.errors.some((e) => e.includes("writer_output_missing_pages"))).toBe(true);
  });
});