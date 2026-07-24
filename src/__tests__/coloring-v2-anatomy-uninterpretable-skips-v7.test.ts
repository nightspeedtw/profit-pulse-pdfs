// anatomy_uninterpretable_skips_v7 (2026-07-24).
// Owner law: if the anatomy verifier can't verify or can't interpret the
// subject, the page is UNMEASURED (degraded=true), never a defect. The
// render step uploads with anatomy_unmeasured=true and the book keeps
// moving. Only measured real deformities of a canonical creature form
// still block.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { V2_ANATOMY_GATE_VERSION } from "../../supabase/functions/_shared/coloring-v2/anatomy-check.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const anatomySrc = readFileSync(
  resolve(__dirname, "../../supabase/functions/_shared/coloring-v2/anatomy-check.ts"),
  "utf8",
);

// Import the private normalizer indirectly by re-declaring the branch
// contract as source text — we assert behavior through the module source
// because normalizeVerdict is not exported. This keeps the guardrails
// visible in one place and cheap to run.
describe("anatomy_uninterpretable_skips_v7", () => {
  it("gate version bumped", () => {
    expect(V2_ANATOMY_GATE_VERSION).toBe("v7:uninterpretable_skips");
  });

  it("declares a REAL_ANATOMY_DEFECT_RE with the canonical tokens", () => {
    expect(anatomySrc).toMatch(/REAL_ANATOMY_DEFECT_RE\s*=/);
    for (const token of [
      "two[_\\s-]?heads?",
      "fused",
      "missing[_\\s-]?(?:limb",
      "extra[_\\s-]?(?:limb",
      "severed",
      "floating[_\\s-]?(?:limb",
      "wrong[_\\s-]?number[_\\s-]?of",
      "malformed[_\\s-]?body",
      "amorphous[_\\s-]?blob",
    ]) {
      expect(anatomySrc).toContain(token);
    }
  });

  it("normalizeVerdict routes !recognizable && !anyReal through degraded=true", () => {
    // The branch must set degraded:true and pass:true so callers upload with
    // anatomy_unmeasured and do not park the book.
    expect(anatomySrc).toMatch(/if\s*\(\s*!recognizable\s*&&\s*!anyReal\s*\)/);
    // In that branch, pass=true and degraded=true.
    const branch = anatomySrc.match(/if\s*\(\s*!recognizable\s*&&\s*!anyReal\s*\)\s*{[\s\S]*?}\s*\n/);
    expect(branch).toBeTruthy();
    expect(branch![0]).toMatch(/pass:\s*true/);
    expect(branch![0]).toMatch(/degraded:\s*true/);
  });

  it("normalizeVerdict treats non-anatomy defects as uninterpretable too", () => {
    expect(anatomySrc).toMatch(/mergedDefects\.length\s*>\s*0\s*&&\s*!anyReal/);
  });

  it("only real anatomy defects can produce pass=false", () => {
    // The final pass computation must require anyReal for a hard fail path.
    expect(anatomySrc).toMatch(/const\s+pass\s*=\s*parsed\?\.pass\s*===\s*true\s*&&\s*score\s*>=\s*90\s*&&\s*!anyReal\s*&&\s*recognizable/);
  });

  it("render-page keeps its degraded → upload-with-unmeasured contract", () => {
    const renderSrc = readFileSync(
      resolve(__dirname, "../../supabase/functions/coloring-v2-render-page/index.ts"),
      "utf8",
    );
    // degraded verdicts must NOT retry and must NOT park the book.
    expect(renderSrc).toMatch(/verdict\.degraded/);
    expect(renderSrc).toMatch(/anatomy_unmeasured/);
    // The uninterpretable branch reuses the degraded path — no dedicated
    // retry loop is added.
    const degradedIdx = renderSrc.indexOf("verdict.degraded");
    const parkIdx = renderSrc.indexOf("anatomy_unrecoverable_page_");
    expect(degradedIdx).toBeGreaterThan(-1);
    expect(parkIdx).toBeGreaterThan(-1);
    // Parking is guarded by !verdict.pass && !verdict.degraded (implicit
    // via the else-if chain).
    expect(renderSrc).toMatch(/}\s*else\s+if\s*\(\s*!verdict\.pass\s*\)/);
  });
});
