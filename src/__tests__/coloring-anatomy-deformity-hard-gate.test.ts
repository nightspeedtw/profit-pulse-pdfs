// anatomy_deformity_hard_gate_v1 (owner order 2026-07-19).
// Deformity is a NON-WAIVABLE hard reject for coloring interior pages.
// Fantasy, stylization and cuteness must still PASS.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasDeformity,
  isDeformityDefect,
  ANATOMY_VERIFIER_VERSION,
} from "../../supabase/functions/_shared/coloring/anatomy-verify.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const renderSrc = readFileSync(
  resolve(__dirname, "../../supabase/functions/coloring-book-render/index.ts"),
  "utf8",
);

describe("anatomy_deformity_hard_gate_v1", () => {
  it("version pin: v6 hard gate is in effect", () => {
    expect(ANATOMY_VERIFIER_VERSION).toBe("v6:deformity_hard_gate");
  });

  it("classifies real deformity defects as deformity", () => {
    expect(isDeformityDefect("missing_limb: back legs absent")).toBe(true);
    expect(isDeformityDefect("extra_limb: five legs on the unicorn")).toBe(true);
    expect(isDeformityDefect("fused bodies between two unicorns")).toBe(true);
    expect(isDeformityDefect("floating torso — no legs under body")).toBe(true);
    expect(isDeformityDefect("wrong_count of fingers")).toBe(true);
    expect(isDeformityDefect("6 fingers on hand")).toBe(true);
  });

  it("does NOT classify stylization / fantasy as deformity", () => {
    expect(isDeformityDefect("eyelashes on unicorn")).toBe(false);
    expect(isDeformityDefect("big sparkly eyes")).toBe(false);
    expect(isDeformityDefect("blush marks on cheeks")).toBe(false);
    expect(isDeformityDefect("unicorn has one forehead horn")).toBe(false);
    expect(isDeformityDefect("nine tails on kitsune")).toBe(false);
  });

  it("hasDeformity treats degraded verdicts as unmeasured (never a hard fail)", () => {
    expect(hasDeformity({ defects: ["missing_limb: back legs"], degraded: true })).toBe(false);
    expect(hasDeformity({ defects: ["missing_limb: back legs"], degraded: false })).toBe(true);
    expect(hasDeformity({ defects: ["eyelashes"], degraded: false })).toBe(false);
    expect(hasDeformity(null)).toBe(false);
  });

  it("coloring-book-render enforces the hard reject path (not advisory-only)", () => {
    // The old advisory-only comment must be gone.
    expect(renderSrc).not.toMatch(/Anatomy is advisory, not a\n\s*\/\/\s*hard gate/);
    // The new amendment must be present.
    expect(renderSrc).toMatch(/anatomy_deformity_hard_gate_v1/);
    // Storage must be removed when deformed, and the page dropped from newRecords.
    expect(renderSrc).toMatch(/hasDeformity\(v\)/);
    expect(renderSrc).toMatch(/anatomy_gate:deformity/);
    expect(renderSrc).toMatch(/ebook-covers[\s\S]{0,80}\.remove\(\[rec\.storage_path\]\)/);
  });
});
