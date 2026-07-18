// Boundary guard for values crossing into HTTP provider payloads.
//
// Runtime bug class: a DB column or upstream helper returns a value that is
// not safely JSON-serializable (BigInt from a bigint/int8 column, Date,
// Uint8Array, function). JSON.stringify then throws a generic
// "Cannot convert a BigInt value to a number" / "Do not know how to
// serialize a BigInt" and the failure surfaces as a mystery cover crash.
//
// Use `coerceForProviderPayload(obj, "runware_ideogram")` on the task object
// immediately before JSON.stringify. It:
//   - converts BigInt → Number (throws if out of safe-integer range)
//   - rejects unsupported types with a clear message NAMING the field path
//   - preserves plain objects, arrays, strings, numbers, booleans, null
//
// This deliberately fails LOUDLY at the boundary rather than letting a bad
// value crash JSON.stringify with a stack that doesn't name the offender.

export function coerceForProviderPayload<T>(value: T, label: string): T {
  return walk(value, label, "$") as T;
}

function walk(v: unknown, label: string, path: string): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") {
    if (!Number.isFinite(v as number)) {
      throw new Error(`payload_guard[${label}]: non-finite number at ${path}`);
    }
    return v;
  }
  if (t === "bigint") {
    const n = Number(v as bigint);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`payload_guard[${label}]: BigInt at ${path} exceeds safe integer range (${String(v)})`);
    }
    return n;
  }
  if (Array.isArray(v)) return v.map((el, i) => walk(el, label, `${path}[${i}]`));
  if (t === "object") {
    // Reject known non-serializable shapes with a clear message.
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
      throw new Error(`payload_guard[${label}]: binary buffer at ${path} — encode as base64 before sending`);
    }
    if (v instanceof Date) return (v as Date).toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(val, label, `${path}.${k}`);
    }
    return out;
  }
  throw new Error(`payload_guard[${label}]: unsupported ${t} at ${path}`);
}
