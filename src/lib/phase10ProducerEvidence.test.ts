import { describe, expect, it } from "vitest";
import {
  CHILDREN_ILLUSTRATED_STAGE_MAP,
  resolveRequiredSkillContracts,
  assertContractsReady,
  MissingRequiredSkillContract,
} from "./skillRouter";

// Simulates the runtime check that assertFinalReleaseSkillEvidence performs
// server-side: given a set of persisted run_skill_usage rows for a book,
// derive whether the final_release evidence contract is satisfied.

interface UsageRow { book_id: string; skill_key: string; stage: string; }

function evaluateFinalReleaseEvidence(bookId: string, rows: UsageRow[]): string[] {
  const required = CHILDREN_ILLUSTRATED_STAGE_MAP.final_release;
  const present = new Set(
    rows.filter((r) => r.book_id === bookId).map((r) => r.skill_key),
  );
  return required.filter((k) => !present.has(k));
}

const BOOK = "chef-pip";

function usageForFullyLoggedBook(): UsageRow[] {
  return [
    { book_id: BOOK, stage: "final_release", skill_key: "qc_contract_auditor" },
    { book_id: BOOK, stage: "final_release", skill_key: "regression_evaluation" },
    { book_id: BOOK, stage: "final_release", skill_key: "release_guardian" },
  ];
}

describe("Phase 10 — producer evidence & final release gate", () => {
  it("all mandatory final_release skills logged → release evidence passes", () => {
    expect(evaluateFinalReleaseEvidence(BOOK, usageForFullyLoggedBook())).toEqual([]);
  });

  it("deleting one usage row blocks release (missing_skill_evidence)", () => {
    const rows = usageForFullyLoggedBook().filter((r) => r.skill_key !== "release_guardian");
    const missing = evaluateFinalReleaseEvidence(BOOK, rows);
    expect(missing).toEqual(["release_guardian"]);
    // Downstream: publish endpoint pushes `missing_skill_evidence:release_guardian`.
  });

  it("deleting all rows blocks with all three missing", () => {
    expect(evaluateFinalReleaseEvidence(BOOK, [])).toEqual([
      "qc_contract_auditor", "regression_evaluation", "release_guardian",
    ]);
  });

  it("usage rows for a different book do not satisfy the gate for this book", () => {
    const rows = usageForFullyLoggedBook().map((r) => ({ ...r, book_id: "other-book" }));
    expect(evaluateFinalReleaseEvidence(BOOK, rows)).toHaveLength(3);
  });

  it("resolver still refuses to run generate_cover if any contract is missing from the registry", () => {
    const partialRegistry = [
      {
        skill_key: "character_reference", skill_version: "1.0.0", enabled: true,
        supported_book_types: ["children_illustrated"],
        supported_pipeline_stages: ["generate_cover", "generate_interior", "generate_character_bible"],
      },
    ];
    const r = resolveRequiredSkillContracts(
      { bookType: "children_illustrated", pipelineStage: "generate_cover" },
      partialRegistry,
    );
    expect(() => assertContractsReady(r)).toThrow(MissingRequiredSkillContract);
    expect(r.missing).toEqual(expect.arrayContaining([
      "illustration_style_lock", "cover_art_direction", "image_artifact_guard",
    ]));
  });
});
