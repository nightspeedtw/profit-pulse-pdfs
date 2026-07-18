# Immune-System Doctrine (v1)

**Standing rule.** SecretPDF must get *smarter* at not failing, not just
faster at cleaning up failures. Every past defect is now encoded as an
automated check that runs *before* another instance can hurt production.

## The three layers

1. **Deploy-time invariants** — `src/__tests__/immune-invariants.test.ts`
   Grep + AST checks that fail CI. Catches violating edits before they
   ship. Fast, deterministic, no DB access.

2. **Nightly self-audit** — `supabase/functions/nightly-self-audit`
   SQL + config reads over live data (zero AI). Emits rows into
   `self_audit_findings`; critical findings mirror into `alert_log` so
   the existing health-monitor Resend + admin banner path picks them up
   without duplicated code. Cron: nightly + on-demand.

3. **Runtime watchdogs** (existing) — stall-watchdog, health-monitor.
   Last line of defence for classes not yet encodable statically.

## Defect classes currently monitored

| Class | Deploy check | Nightly check |
|---|---|---|
| `persistence_contract` (reader/writer field agreement) | worker-tick ↔ health-monitor heartbeat pair | `pc_worker_heartbeat_writer_missing` |
| `ceiling_without_consequence` | attempt-counter writes must reference ceiling + park helper | `ce_counter_over_cap_unparked` |
| `provider_monoculture` | book-critical files must go through failover helper | (deploy-only) |
| `state_nobody_owns` | every non-terminal `pipeline_status` literal must be claimed by a dispatcher `.in()`/`.eq()` | `sn_orphan_pipeline_status` |
| `plan_loss` | (runtime-only) | `pl_assets_without_plan` |
| `resource_limit` (BigInt / oversized payload) | BigInt into `JSON.stringify` requires sanitizer import | `rl_oversized_metadata` |
| `unbounded_retry` | (runtime-only, requires cost history) | `ur_pair_over_10_calls_24h` |

## Blast-radius rule (mandatory for every new feature)

Any feature/PR that changes backend behaviour MUST answer, in the change
description itself, before merge:

1. **New states introduced.** For each new `pipeline_status`, `awaiting`,
   or `blocker_reason` value: which dispatcher claims it (`.in()` /
   `.eq()` reference)? Which watchdog resumes it if it stalls?
2. **External calls added.** For each provider call: what is the failover
   chain, the per-book ceiling, the cost-log `step` label, and the
   parking action when the ceiling is hit?
3. **Fields written.** For each new field a gate/reader consumes: which
   function writes it, and is there a deploy-time invariant asserting
   both sides exist?
4. **New defect class observed.** If the fix reveals a class not already
   in the table above, the same PR must add a check to
   `immune-invariants.test.ts` and/or `nightly-self-audit`. A fix without
   a check is not done.

A feature that can't answer 1–4 is rejected regardless of code quality.
This is how new failure classes stop appearing, not just old ones stop
recurring.

## Pre-deploy checklist (agent self-follow)

Before declaring a backend change complete:

```
bun run test -- immune-invariants
```

Plus the existing project checks. If any invariant test fails, do NOT
patch the test — fix the code the test is protecting.

## Adding a new check

Nightly (SQL/runtime): append a `checkXxx()` function in
`supabase/functions/nightly-self-audit/index.ts` and wire it into
`runAllChecks()`. Use `defect_class` from the table above or add a new
row here first.

Deploy-time (grep/AST): append an `it(...)` block in
`src/__tests__/immune-invariants.test.ts` scoped to a defect class.
Prefer a single expressive test per class over many micro-tests.

Both layers should reference `known-regressions.md` so the heuristic's
provenance is traceable.
