#!/usr/bin/env bash
# Detect direct state-mutating helper calls that bypass the canonical
# orchestrator. Flags — does not auto-fix.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/orchestrator-bypasses.md"
{
  echo "# Potential orchestrator bypasses"
  echo
  echo "## Direct writes to ebooks_kids.pipeline_status / listing_status outside orchestrator functions"
  rg -n --no-heading -g '!supabase/functions/autopilot-kids-*/**' -g '!supabase/functions/kids-repair-supervisor/**' \
    "\.update\(\s*\{[^}]*(pipeline_status|listing_status)" src supabase || echo "  none"
  echo
  echo "## Direct kids-* function invocations outside orchestrator"
  rg -n --no-heading -g '!supabase/functions/autopilot-kids-*/**' -g '!supabase/functions/kids-repair-*/**' \
    "functions/v1/kids-(render-interior|build-picture-pdf|qc-run|publish-if-qc-passed)" supabase || echo "  none"
} > "$OUT"
echo "wrote $OUT"
