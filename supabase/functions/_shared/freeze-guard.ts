// _shared/freeze-guard.ts
// Global autopilot freeze switch + system heartbeat helpers.
//
// FREEZE: platform_settings.autopilot_frozen.value_json.frozen === true
//   → every automated worker returns early. Manual invocations (with an
//     `override_freeze: true` body flag) still run so the owner can force
//     one-off actions from the admin UI.
//
// HEARTBEAT: writes `system_heartbeat` (source PK). A companion check in
// health-monitor raises `system_dead` when the newest beat is older than
// DEAD_THRESHOLD_MS.

// deno-lint-ignore no-explicit-any
export async function isAutopilotFrozen(db: any): Promise<boolean> {
  try {
    const { data } = await db
      .from("platform_settings")
      .select("value_json")
      .eq("key", "autopilot_frozen")
      .maybeSingle();
    return !!(data?.value_json?.frozen);
  } catch {
    return false; // fail-open on read errors — worker logs will surface it
  }
}

// deno-lint-ignore no-explicit-any
export async function writeHeartbeat(db: any, source: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.from("system_heartbeat").upsert({
      source,
      last_beat_at: new Date().toISOString(),
      detail,
    }, { onConflict: "source" });
  } catch (e) {
    console.warn(`[heartbeat:${source}] write failed:`, (e as Error)?.message);
  }
}

export const DEAD_THRESHOLD_MS = 60_000; // 60 seconds — owner spec
