import { describe, expect, it } from "vitest";
import { parseModelJson, callAndParseModelJson, modelJsonViolations } from "../../supabase/functions/_shared/model-json";

describe("parseModelJson — tolerant model-output parser", () => {
  it("parses vanilla JSON", () => {
    const r = parseModelJson<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    expect(r.value.a).toBe(1);
  });

  it("strips markdown fences", () => {
    const r = parseModelJson('```json\n{"a":1}\n```');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.repairs).toContain("code_fence_stripped");
  });

  it("extracts outermost object when the model appends commentary", () => {
    const r = parseModelJson('Here you go:\n{"a":1}\nHope that helps!');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.repairs).toContain("outer_json_extracted");
  });

  it("repairs trailing commas", () => {
    const r = parseModelJson('{"a":1,}');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.repairs).toContain("trailing_comma_removed");
  });

  it("repairs a missing comma between adjacent string-valued properties", () => {
    const r = parseModelJson('{"a":"one" "b":"two"}');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.repairs).toContain("missing_comma_inserted");
  });

  it("fails on an unterminated string (no crash, diagnostics captured)", () => {
    const r = parseModelJson('{"a":"unterminated');
    expect(r.ok).toBe(false);
    expect(r.diagnostics.errors.length).toBeGreaterThan(0);
    expect(r.diagnostics.raw_model_output).toContain("unterminated");
  });

  it("fails on empty object when a requiredKey is declared", () => {
    const r = parseModelJson("{}", { requiredKey: "pages" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.errors.some((e) => e.includes("missing_required_key"))).toBe(true);
  });

  it("fails on mis-keyed root when a requiredKey is declared", () => {
    const r = parseModelJson('{"story":[{"page":1,"text":"hi"}]}', { requiredKey: "pages" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.errors.some((e) => e.includes("missing_required_key"))).toBe(true);
  });

  it("enforces minItems on the required array key", () => {
    const r = parseModelJson('{"pages":[]}', { requiredKey: "pages", minItems: 1 });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.errors.some((e) => e.includes("required_key_empty_array"))).toBe(true);
  });

  it("accepts a non-empty required array", () => {
    const r = parseModelJson('{"pages":[{"page":1}]}', { requiredKey: "pages", minItems: 1 });
    expect(r.ok).toBe(true);
  });

  it("rejects a required string that is empty", () => {
    const r = parseModelJson('{"title":""}', { requiredKey: "title" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.errors.some((e) => e.includes("required_key_empty_string"))).toBe(true);
  });
});

describe("callAndParseModelJson — retry ladder with violation feedback", () => {
  it("succeeds on first attempt when parse passes", async () => {
    let calls = 0;
    const r = await callAndParseModelJson<{ a: number }>(async () => {
      calls++;
      return '{"a":1}';
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
    expect(r.attempts).toBe(1);
  });

  it("feeds violations back on retry then succeeds", async () => {
    let calls = 0;
    const seen: string[][] = [];
    const r = await callAndParseModelJson<{ pages: unknown[] }>(async (violations) => {
      seen.push(violations);
      calls++;
      if (calls === 1) return "{}";
      return '{"pages":[{"page":1}]}';
    }, { schema: { requiredKey: "pages", minItems: 1 } });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(seen[0]).toEqual([]);
    expect(seen[1].some((v) => v.includes("previous_response_malformed_json"))).toBe(true);
  });

  it("falls back to fallbackModel on the last attempt", async () => {
    const used: (string | undefined)[] = [];
    const r = await callAndParseModelJson(async (_v, model) => {
      used.push(model);
      return "{"; // always bad
    }, { primaryAttempts: 2, fallbackModel: "gemini-pro", schema: { requiredKey: "x" } });
    expect(r.ok).toBe(false);
    expect(used).toEqual([undefined, undefined, "gemini-pro"]);
    expect(r.parseFailures.length).toBe(3);
  });
});

describe("modelJsonViolations — retry-prompt payload", () => {
  it("returns empty when there were no errors", () => {
    expect(modelJsonViolations({ repairs: [], errors: [], raw_excerpt: "", raw_model_output: "" })).toEqual([]);
  });
  it("summarises errors without dumping the raw output", () => {
    const violations = modelJsonViolations({
      repairs: [],
      errors: ["Unterminated string in JSON at position 21", "missing_required_key: \"pages\""],
      raw_excerpt: "raw",
      raw_model_output: "raw",
    });
    expect(violations[0]).toContain("Unterminated string");
    expect(violations[0]).toContain("missing_required_key");
    expect(violations.join(" ")).not.toContain("raw");
  });
});
