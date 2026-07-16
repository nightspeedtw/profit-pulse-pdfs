import { describe, it, expect, beforeEach } from "vitest";
import {
  AnatomyVerifierBlockedError,
  ANATOMY_VERIFIER_BLOCK_THRESHOLD,
  ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT,
  assertAnatomyVerifierAvailable,
  markVerifierHealthy,
  noteVerifierFailure,
  readAnatomyVerifierModels,
  readVerifierBlockedState,
} from "../../supabase/functions/_shared/coloring/anatomy-verifier-guard.ts";

/**
 * In-memory stub of the tiny Supabase surface the guard uses:
 *   db.from("generation_settings").select("coloring_autopilot").eq("id",1).maybeSingle()
 *   db.from("generation_settings").update({ coloring_autopilot: {...} }).eq("id",1)
 */
function makeDb(initialCfg: Record<string, unknown> = {}) {
  const state = { coloring_autopilot: { ...initialCfg } };
  const from = (_t: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const q: any = {
      select: (_c?: string) => q,
      update: (patch: Record<string, unknown>) => { pendingUpdate = patch; return q; },
      eq: (_c: string, _v: unknown) => {
        if (pendingUpdate) {
          Object.assign(state, pendingUpdate);
          pendingUpdate = null;
          return Promise.resolve({ data: null, error: null });
        }
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: { coloring_autopilot: state.coloring_autopilot }, error: null }),
    };
    return q;
  };
  return { from, _state: state };
}

describe("anatomy verifier guard — verifier_model_deprecated class fix", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb({}); });

  it("default ladder is the live Gemini 3.x models (not the deprecated 2.5-flash)", async () => {
    expect(ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT).toEqual([
      "google/gemini-3.5-flash",
      "google/gemini-3-flash-preview",
      "google/gemini-3.1-flash-lite",
    ]);
    const models = await readAnatomyVerifierModels(db);
    expect(models).toEqual(ANATOMY_VERIFIER_MODEL_LADDER_DEFAULT);
    expect(models).not.toContain("google/gemini-2.5-flash");
  });

  it("respects an override ladder in generation_settings", async () => {
    db = makeDb({ anatomy_verifier_models: ["google/gemini-3.5-flash", "google/gpt-5-mini"] });
    expect(await readAnatomyVerifierModels(db)).toEqual([
      "google/gemini-3.5-flash",
      "google/gpt-5-mini",
    ]);
  });

  it("does NOT block the lane after 1 or 2 verifier failures", async () => {
    await noteVerifierFailure(db, "gemini-3.5-flash:http_500");
    let s = await readVerifierBlockedState(db);
    expect(s.active).toBe(false);
    expect(s.consecutive_failures).toBe(1);

    await noteVerifierFailure(db, "gemini-3.5-flash:http_500");
    s = await readVerifierBlockedState(db);
    expect(s.active).toBe(false);
    expect(s.consecutive_failures).toBe(2);

    // Renders can still dispatch — the lane is not blocked yet.
    await expect(assertAnatomyVerifierAvailable(db)).resolves.toBeUndefined();
  });

  it(`throws AnatomyVerifierBlockedError on the ${ANATOMY_VERIFIER_BLOCK_THRESHOLD}rd consecutive failure`, async () => {
    await noteVerifierFailure(db, "x");
    await noteVerifierFailure(db, "x");
    await expect(noteVerifierFailure(db, "gemini-3.5-flash:http_404 no longer available")).rejects.toBeInstanceOf(AnatomyVerifierBlockedError);
    const s = await readVerifierBlockedState(db);
    expect(s.active).toBe(true);
    expect(s.consecutive_failures).toBe(3);
    expect(s.last_reason).toMatch(/no longer available/);
  });

  it("assertAnatomyVerifierAvailable halts renders once the lane is blocked", async () => {
    await noteVerifierFailure(db, "x");
    await noteVerifierFailure(db, "x");
    await expect(noteVerifierFailure(db, "x")).rejects.toBeInstanceOf(AnatomyVerifierBlockedError);
    await expect(assertAnatomyVerifierAvailable(db)).rejects.toBeInstanceOf(AnatomyVerifierBlockedError);
  });

  it("first healthy verifier call clears the flag AND resets the counter", async () => {
    await noteVerifierFailure(db, "x");
    await noteVerifierFailure(db, "x");
    await expect(noteVerifierFailure(db, "x")).rejects.toBeInstanceOf(AnatomyVerifierBlockedError);
    expect((await readVerifierBlockedState(db)).active).toBe(true);

    await markVerifierHealthy(db);
    const s = await readVerifierBlockedState(db);
    expect(s.active).toBe(false);
    expect(s.consecutive_failures).toBe(0);
    await expect(assertAnatomyVerifierAvailable(db)).resolves.toBeUndefined();
  });

  it("AnatomyVerifierBlockedError family is temporary_provider_error (never a quality verdict)", () => {
    const err = new AnatomyVerifierBlockedError(3, "gemini-2.5-flash 404");
    expect(err.kind).toBe("anatomy_verifier_blocked");
    expect(err.family).toBe("temporary_provider_error");
  });
});
