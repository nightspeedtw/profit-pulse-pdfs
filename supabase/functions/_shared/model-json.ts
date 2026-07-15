// Shared tolerant JSON parser for MODEL OUTPUT across every producer.
//
// Rationale: LLMs periodically emit malformed JSON — trailing commentary,
// markdown fences, truncated strings, missing commas, mis-keyed root, or an
// empty `{}`. A naive `JSON.parse(raw)` in a producer throws and retires the
// whole run. This helper centralises the tolerant contract so every sibling
// (style bible, character bible, concept, storefront copy, judges/QC vision,
// scene planner, cover lettering, bonus pages, thumbnail QC, ...) shares
// exactly one hardening path. Fix once → every producer benefits.
//
// Contract:
//   parseModelJson<T>(raw, { requiredKey?, minItems? })
//     - strips markdown fences
//     - extracts the outermost balanced JSON object
//     - repairs trailing commas + missing commas + concatenated objects
//     - validates the required top-level key exists (schema-key check)
//     - validates a minimum non-empty semantic shape (e.g. pages[] ≥ 1)
//     - returns { ok, value, diagnostics } with raw output captured so the
//       caller can log evidence into autopilot_kids_steps.output.
//
// Retry ladder:
//   callAndParseModelJson(call, { schema, primaryAttempts, fallbackModel })
//     - runs the caller's model-invocation `call(violations, model)` twice on
//       primary, feeding parseModelJson violations back as an explicit
//       "fix these" instruction, then one last attempt on the fallback model.
//     - never throws on parse failure — returns the final ParseResult so the
//       producer decides between throw / substitute / continue.

export interface ModelJsonSchema {
  /** Required top-level key that must exist in the parsed object. */
  requiredKey?: string;
  /**
   * When requiredKey points at an array, minimum length required for
   * `ok:true`. Default 0 (no minimum). Set to 1 to reject empty arrays.
   */
  minItems?: number;
  /**
   * Optional extra keys that must all exist at the top level.
   */
  requiredKeys?: string[];
}

export interface ModelJsonDiagnostics {
  repairs: string[];
  errors: string[];
  raw_excerpt: string;
  raw_model_output: string;
}

export interface ModelJsonResult<T> {
  ok: boolean;
  value: T;
  diagnostics: ModelJsonDiagnostics;
}

function stripCodeFence(raw: string, repairs: string[]): string {
  const trimmed = String(raw ?? "").trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    repairs.push("code_fence_stripped");
    return fenced[1].trim();
  }
  const loose = trimmed.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (loose !== trimmed) repairs.push("code_fence_stripped");
  return loose;
}

function extractOutermostJsonObject(text: string, repairs: string[]): string | null {
  // Look for either { or [ as first structural char.
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const start = firstObj < 0 ? firstArr : firstArr < 0 ? firstObj : Math.min(firstObj, firstArr);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const out = text.slice(start, i + 1).trim();
        if (start > 0 || i < text.length - 1) repairs.push("outer_json_extracted");
        return out;
      }
    }
  }
  return null;
}

function repairJsonText(text: string, repairs: string[]): string {
  const before = text;
  let repaired = text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/("(?:\\.|[^"\\])*")\s+(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "$1,")
    .replace(/}\s*{/g, "},{")
    .replace(/]\s*(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "],")
    .replace(/}\s*(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g, "},");
  if (repaired !== before) {
    if (before.replace(/,\s*([}\]])/g, "$1") !== before) repairs.push("trailing_comma_removed");
    if (/("(?:\\.|[^"\\])*")\s+(?="[^"\\]*(?:\\.[^"\\]*)*"\s*:)/.test(before)) repairs.push("missing_comma_inserted");
  }
  return repaired;
}

function passesSchema(value: unknown, schema?: ModelJsonSchema): { ok: boolean; error?: string } {
  if (!schema) return { ok: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `parsed_value_not_object: got ${Array.isArray(value) ? "array" : typeof value}` };
  }
  const obj = value as Record<string, unknown>;
  const needed = [schema.requiredKey, ...(schema.requiredKeys ?? [])].filter(Boolean) as string[];
  for (const key of needed) {
    if (!(key in obj)) return { ok: false, error: `missing_required_key: "${key}"` };
    const v = obj[key];
    if (v === null || v === undefined) return { ok: false, error: `required_key_null_or_undefined: "${key}"` };
    if (typeof v === "string" && v.trim() === "") return { ok: false, error: `required_key_empty_string: "${key}"` };
  }
  if (schema.requiredKey && (schema.minItems ?? 0) > 0) {
    const v = obj[schema.requiredKey];
    if (!Array.isArray(v)) return { ok: false, error: `required_key_not_array: "${schema.requiredKey}"` };
    if (v.length < (schema.minItems ?? 0)) {
      return { ok: false, error: `required_key_empty_array: "${schema.requiredKey}" length ${v.length} < ${schema.minItems}` };
    }
  }
  return { ok: true };
}

export function parseModelJson<T = unknown>(raw: string, schema?: ModelJsonSchema): ModelJsonResult<T> {
  const repairs: string[] = [];
  const errors: string[] = [];
  const raw_model_output = String(raw ?? "");
  const raw_excerpt = raw_model_output.slice(0, 8_000);
  const diag = (): ModelJsonDiagnostics => ({ repairs: [...new Set(repairs)], errors, raw_excerpt, raw_model_output });

  const cleaned = stripCodeFence(raw_model_output, repairs);
  const candidates = [cleaned];
  const outer = extractOutermostJsonObject(cleaned, repairs);
  if (outer && outer !== cleaned) candidates.push(outer);

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJsonText(candidate, repairs)]) {
      if (!attempt) continue;
      try {
        const value = JSON.parse(attempt);
        const check = passesSchema(value, schema);
        if (check.ok) return { ok: true, value: value as T, diagnostics: diag() };
        errors.push(check.error ?? "schema_check_failed");
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return { ok: false, value: {} as T, diagnostics: diag() };
}

/**
 * Human-readable violation messages the caller can splice into the model
 * prompt for the retry attempt. Never leaks the whole raw output — just the
 * class of failure and the last two error strings.
 */
export function modelJsonViolations(diag: ModelJsonDiagnostics): string[] {
  if (!diag.errors.length) return [];
  return [
    `previous_response_malformed_json: ${diag.errors.slice(-2).join("; ")}`,
    "Return one valid JSON object only. No markdown fences, no commentary, no trailing text, no truncated arrays.",
  ];
}

// ---------------------------------------------------------------------------
// Retry ladder — every producer that calls a model for JSON should route
// through this helper so the tolerant-parse + violation-feedback + fallback
// model pattern is applied consistently.
// ---------------------------------------------------------------------------

export interface CallAndParseOpts<T> {
  schema?: ModelJsonSchema;
  /** How many primary-model attempts before falling back. Default 2. */
  primaryAttempts?: number;
  /**
   * Optional fallback model identifier passed to the caller's `call` on the
   * last attempt. When omitted, the ladder uses primary for the final try.
   */
  fallbackModel?: string;
  /** Optional label used in warning logs. */
  label?: string;
  /** Optional coercion applied to parsed value before returning. */
  coerce?: (value: unknown) => T;
}

export interface CallAndParseResult<T> extends ModelJsonResult<T> {
  attempts: number;
  parseFailures: ModelJsonDiagnostics[];
}

export async function callAndParseModelJson<T = unknown>(
  call: (violations: string[], model?: string) => Promise<string>,
  opts: CallAndParseOpts<T> = {},
): Promise<CallAndParseResult<T>> {
  const primaryAttempts = Math.max(1, opts.primaryAttempts ?? 2);
  const totalAttempts = primaryAttempts + (opts.fallbackModel ? 1 : 0);
  const parseFailures: ModelJsonDiagnostics[] = [];
  let lastResult: ModelJsonResult<T> | null = null;
  let violations: string[] = [];

  for (let i = 0; i < totalAttempts; i++) {
    const usingFallback = opts.fallbackModel && i === totalAttempts - 1;
    const raw = await call(violations, usingFallback ? opts.fallbackModel : undefined);
    const result = parseModelJson<T>(raw, opts.schema);
    lastResult = result;
    if (result.ok) {
      const coerced = opts.coerce ? opts.coerce(result.value) : result.value;
      return { ...result, value: coerced, attempts: i + 1, parseFailures };
    }
    parseFailures.push(result.diagnostics);
    violations = modelJsonViolations(result.diagnostics);
    if (opts.label) {
      console.warn(`[model-json:${opts.label}] attempt ${i + 1} failed: ${result.diagnostics.errors.slice(-1)[0] ?? "unknown"}`);
    }
  }

  const final = lastResult ?? { ok: false, value: {} as T, diagnostics: { repairs: [], errors: ["no_attempts"], raw_excerpt: "", raw_model_output: "" } };
  return { ...final, attempts: totalAttempts, parseFailures };
}
