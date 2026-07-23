// coloring_v2_anatomy_gate_v1 (2026-07-22).
// Verifies the permanent defect-class fix that stops deformed animals from
// shipping in coloring-book interiors:
//   1) Enlarged INTERIOR_NEGATIVE_PROMPT vocabulary
//   2) defectsToNegativeClause maps verifier defects to prompt clauses
//   3) render + qc functions both call the anatomy gate helper
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INTERIOR_NEGATIVE_PROMPT } from "../../supabase/functions/_shared/coloring-v2/prompts.ts";
import {
  defectsToNegativeClause,
  V2_ANATOMY_GATE_VERSION,
} from "../../supabase/functions/_shared/coloring-v2/anatomy-check.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const renderSrc = readFileSync(
  resolve(__dirname, "../../supabase/functions/coloring-v2-render-page/index.ts"),
  "utf8",
);
const qcSrc = readFileSync(
  resolve(__dirname, "../../supabase/functions/coloring-v2-qc/index.ts"),
  "utf8",
);

describe("coloring_v2_anatomy_gate_v1", () => {
  it("gate version pinned so future changes trip a fixture", () => {
    expect(V2_ANATOMY_GATE_VERSION).toBe("v4:cloudflare_primary");
  });

  it("INTERIOR_NEGATIVE_PROMPT contains the full deformity vocabulary", () => {
    for (const token of [
      "two heads",
      "extra head",
      "duplicated head",
      "fused faces",
      "fused limbs",
      "floating limbs",
      "disembodied parts",
      "wrong number of legs",
      "wrong number of fins",
      "malformed body",
      "frankenstein composition",
      "amorphous blob",
    ]) {
      expect(INTERIOR_NEGATIVE_PROMPT).toContain(token);
    }
  });

  it("defectsToNegativeClause maps verifier defect strings to prompt clauses", () => {
    const clause = defectsToNegativeClause([
      "two_heads: turtle has two heads",
      "extra_limb: 5th leg",
      "unrecognizable_subject:blob",
    ]);
    expect(clause).toContain("two heads");
    expect(clause).toContain("extra limbs");
    expect(clause).toContain("amorphous blob");
  });

  it("defectsToNegativeClause returns empty when nothing matches", () => {
    expect(defectsToNegativeClause([])).toBe("");
    expect(defectsToNegativeClause(["stylization", "cuteness"])).toBe("");
  });

  it("render-page function wires the anatomy gate before upload", () => {
    // Import + call site
    expect(renderSrc).toMatch(/from "\.\.\/_shared\/coloring-v2\/anatomy-check\.ts"/);
    expect(renderSrc).toMatch(/checkPageAnatomy\(/);
    // Gate must run BEFORE uploadAsset — enforce ordering in source.
    const gateIdx = renderSrc.indexOf("checkPageAnatomy(");
    const uploadIdx = renderSrc.indexOf("uploadAsset(book_id, \"interior\"");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(uploadIdx);
  });

  it("render-page parks the book after MAX_ATTEMPTS anatomy failures", () => {
    expect(renderSrc).toMatch(/stage:\s*"failed"/);
    expect(renderSrc).toMatch(/anatomy_unrecoverable_page_/);
    expect(renderSrc).toMatch(/anatomy_deformity_persistent/);
  });

  it("render-page injects defect-specific negative clauses on retry", () => {
    expect(renderSrc).toMatch(/defectsToNegativeClause\(/);
    expect(renderSrc).toMatch(/extraNegative/);
  });

  it("render-page never treats a degraded verdict as a defect", () => {
    // degraded => upload with anatomy_unmeasured=true, do NOT park.
    expect(renderSrc).toMatch(/verdict\.degraded/);
    expect(renderSrc).toMatch(/anatomy_unmeasured/);
  });

  it("qc function runs the anatomy safety net and rewinds on real defects", () => {
    expect(qcSrc).toMatch(/checkPageAnatomy\(/);
    expect(qcSrc).toMatch(/anatomy_deformity_detected/);
    expect(qcSrc).toMatch(/rewound.*interior_render|stage:\s*"interior_render"/s);
  });

  it("qc function drops the hardcoded default 92 score", () => {
    // The old code returned overall = hardFail ? 0 : 92. The new gate must
    // compute overall from measured anatomy scores.
    expect(qcSrc).not.toMatch(/const\s+overall\s*=\s*hardFail\s*\?\s*0\s*:\s*92/);
    expect(qcSrc).toMatch(/minAnatomyScore/);
  });

  it("qc function fails hard when any page is unmeasured (no default pass)", () => {
    expect(qcSrc).toMatch(/anatomy_unmeasured/);
  });
});
