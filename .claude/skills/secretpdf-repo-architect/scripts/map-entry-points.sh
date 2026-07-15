#!/usr/bin/env bash
# Map every entry point that can mutate pipeline state.
# Writes artifacts/architecture/entry-points.md and exits 0.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/entry-points.md"
{
  echo "# Entry points"
  echo
  echo "Generated $(date -u +%FT%TZ)"
  echo
  echo "## Deno.serve handlers (edge functions)"
  rg -n --no-heading -g 'supabase/functions/**/index.ts' '^Deno\.serve' || true
  echo
  echo "## Cron / scheduled invocations"
  rg -n --no-heading -g '!node_modules' 'cron|schedule|kids-repair-tick|kids-autopilot-watchdog|autopilot-tick' src supabase || true
  echo
  echo "## Client-side supabase.functions.invoke call sites"
  rg -n --no-heading -g 'src/**/*.{ts,tsx}' 'supabase\.functions\.invoke\(\s*["'\''`]([^"'\''`]+)' -r '$1' || true
  echo
  echo "## Server-to-server fetch(SUPABASE_URL/functions/v1/...)"
  rg -n --no-heading -g 'supabase/functions/**/*.ts' 'functions/v1/([a-z0-9-]+)' -r '$1' || true
} > "$OUT"
echo "wrote $OUT"
