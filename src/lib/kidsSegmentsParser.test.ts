import { describe, expect, it } from "vitest";
import { parseSegmentedWriterOutput } from "../../supabase/functions/_shared/kids-segments";

const page = (n: number) => ({ page: n, text: `Chef Pip stirred bright berry jam with a patient little spoon on page ${n}.` });

describe("kids segmented writer parser recovery", () => {
  it("recovers markdown-fenced JSON", () => {
    const raw = `\`\`\`json\n${JSON.stringify({ title: "Chef Pip", refrain: "Stir, Pip, stir!", pages: [page(1), page(2)] })}\n\`\`\``;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.value.pages).toHaveLength(2);
    expect(parsed.diagnostics.repairs).toContain("code_fence_stripped");
  });

  it("extracts the outer JSON object before trailing garbage", () => {
    const raw = `${JSON.stringify({ title: "Chef Pip", refrain: "Stir, Pip, stir!", pages: [page(1)] })}\nThanks for reading!`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.value.pages[0].page).toBe(1);
    expect(parsed.diagnostics.repairs).toContain("outer_json_extracted");
  });

  it("repairs a missing comma after a string property value", () => {
    const raw = `{"title":"Chef Pip","refrain":"Stir, Pip, stir!","pages":[{"page":1,"text":"Chef Pip stirred sticky jam with care." "note":"bad comma"},{"page":2,"text":"The spoon made tiny circles in the pot."}]}`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.value.pages).toHaveLength(2);
    expect(parsed.diagnostics.repairs).toEqual(expect.arrayContaining(["missing_comma_inserted"]));
  });

  it("salvages complete page objects from a truncated array element", () => {
    const raw = `{"title":"Chef Pip","refrain":"Stir, Pip, stir!","pages":[${JSON.stringify(page(1))},${JSON.stringify(page(2))},{"page":3,"text":"broken`;
    const parsed = parseSegmentedWriterOutput(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.partial).toBe(true);
    expect(parsed.value.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(parsed.diagnostics.repairs).toContain("complete_pages_salvaged");
  });
});