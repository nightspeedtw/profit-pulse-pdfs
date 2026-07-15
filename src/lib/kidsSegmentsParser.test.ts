import { describe, expect, it } from "vitest";
import { parseSegmentedWriterOutput, validateSegments, classifyProviderTruncation, refrainPagesFor } from "../../supabase/functions/_shared/kids-segments";
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

describe("page_text_completeness_gate — terminal punctuation with closing wrappers", () => {
  const REFRAIN = "Stir, Pip, stir!";
  const filler = (extra: string) => `Chef Pip stirred bright berry jam with a patient little spoon and it went ${extra}`;
  const build = (endings: string[]): SegmentedManuscript => ({
    title: "Chef Pip",
    refrain: REFRAIN,
    target: endings.length,
    pages: endings.map((end, i) => ({ page: i + 1, text: i < 3 ? `${filler(end)} ${REFRAIN}` : filler(end) })),
  });

  it("accepts dialogue-final text ending with terminal punct + closing curly/straight quotes, parens, or ellipsis", () => {
    const ok = build([
      `enjoyed every bite and cheered, "Yum!"`,
      `and everyone shouted PLOOP!”`,
      `and tumbled right back in!”`,
      `finally said, "It is done."`,
      `so they smiled at the mess (again!)`,
      `then whispered "goodnight…"`,
      `and drifted off into a warm dream…`,
    ]);
    const v = validateSegments(ok, { target: 7, minRefrainOccurrences: 3 });
    const completeness = v.violations.filter((s) => s.includes("page_text_completeness_gate"));
    expect(completeness).toEqual([]);
  });

  it("still rejects genuinely truncated text ending with a comma or no terminal punct", () => {
    const bad: SegmentedManuscript = {
      title: "Chef Pip",
      refrain: REFRAIN,
      target: 1,
      pages: [{ page: 1, text: `Chef Pip stirred bright berry jam and then Pip made a big,` }],
    };
    const v = validateSegments(bad, { target: 1, minRefrainOccurrences: 0 });
    expect(v.violations.some((s) => s.includes("page_text_completeness_gate") && s.includes("no terminal punctuation"))).toBe(true);
  });
});
describe("classifyProviderTruncation — output-token cap heuristic", () => {
  const truncatedRaw = `{"title":"Chef Pip","refrain":"Stir!","pages":[{"page":1,"text":"Chef Pip stirred bright berry jam with a patient spoon`;
  const truncatedErrors = ["Unterminated string in JSON at position 120"];
  const completeRaw = `{"title":"Chef Pip","refrain":"Stir!","pages":[{"page":1,"text":"done."}]}`;

  it("flags finish_reason=length as provider_truncation regardless of tail", () => {
    expect(classifyProviderTruncation(completeRaw, [], "length", 100, 16000)).toBe(true);
  });

  it("flags mid-JSON tail + output_tokens near cap as provider_truncation", () => {
    expect(classifyProviderTruncation(truncatedRaw, truncatedErrors, "stop", 15800, 16000)).toBe(true);
  });

  it("does NOT flag well-formed complete JSON with finish_reason=stop", () => {
    expect(classifyProviderTruncation(completeRaw, [], "stop", 200, 16000)).toBe(false);
  });

  it("does NOT flag mid-JSON tail when output_tokens is far below cap (honest content failure, not truncation)", () => {
    expect(classifyProviderTruncation(truncatedRaw, truncatedErrors, "stop", 500, 16000)).toBe(false);
  });
});
