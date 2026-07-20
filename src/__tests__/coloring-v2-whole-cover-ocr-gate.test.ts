// External-audit finding #1 (2026-07-20): the title-only OCR law was too
// narrow — Ideogram's baked "fake author" / "fake publisher" gibberish and
// duplicate age-badges slipped through. The gate now covers the WHOLE
// cover: any extra glyph outside {title, subtitle, one age badge, brand}
// = reject; any duplicate age-badge = reject. These fixtures MUST FAIL
// under the pre-fix code and PASS under the post-fix code.

import { describe, it, expect } from "vitest";
import {
  countAgeBadges,
  diffTokens,
  tokenize,
} from "../../supabase/functions/_shared/coloring/cover-text-transcription.ts";

describe("whole-cover OCR gate (external-audit #1)", () => {
  const approved = [
    ...tokenize("Soulful Symmetry Coloring Book"),
    ...tokenize("32 Coloring Pages · Ages 13-17"),
    ...tokenize("Ages 13-17"),
  ];

  it("FIXTURE A — Soulful cover with 'Childre-Cloving Booer' + 'Metaton's Cube' gibberish FAILS", () => {
    const raw =
      "Soulful Symmetry | Childre-Cloving Booer | Metaton's Cube | Ages 13-17";
    const detected = Array.from(new Set(tokenize(raw)));
    const { extra } = diffTokens(Array.from(new Set(approved)), detected);
    // The gibberish tokens must show up as extras — the gate rejects on any extra.
    expect(extra.length).toBeGreaterThan(0);
    expect(extra).toEqual(
      expect.arrayContaining(["childre", "booer", "metaton", "cube"]),
    );
  });

  it("FIXTURE B — Cyber cover with 'LITEEN GREM' gibberish FAILS", () => {
    const cyberApproved = Array.from(new Set([
      ...tokenize("Cyber City Countdown Coloring Book"),
      ...tokenize("32 Coloring Pages · Ages 13-17"),
    ]));
    const raw = "Cyber City Countdown | LITEEN GREM | Ages 13-17";
    const detected = Array.from(new Set(tokenize(raw)));
    const { extra } = diffTokens(cyberApproved, detected);
    expect(extra).toEqual(expect.arrayContaining(["liteen", "grem"]));
  });

  it("FIXTURE C — duplicate age badge (baked + overlay) is detected", () => {
    const raw = "Soulful Symmetry | Ages 13-17 | 32 Coloring Pages Ages 13-17";
    expect(countAgeBadges(raw)).toBe(2);
  });

  it("FIXTURE D — single age badge passes duplicate check", () => {
    const raw = "Soulful Symmetry | 32 Coloring Pages · Ages 13-17";
    expect(countAgeBadges(raw)).toBe(1);
  });

  it("FIXTURE E — zero age badge → not duplicate", () => {
    const raw = "Soulful Symmetry Coloring Book";
    expect(countAgeBadges(raw)).toBe(0);
  });

  it("FIXTURE F — clean cover with only approved text passes (no extras)", () => {
    const raw = "Soulful Symmetry Coloring Book | 32 Coloring Pages Ages 13-17";
    const detected = Array.from(new Set(tokenize(raw)));
    const { extra, missing } = diffTokens(Array.from(new Set(approved)), detected);
    expect(extra).toEqual([]);
    expect(missing.filter((t) => ["soulful", "symmetry"].includes(t))).toEqual([]);
    expect(countAgeBadges(raw)).toBe(1);
  });
});
