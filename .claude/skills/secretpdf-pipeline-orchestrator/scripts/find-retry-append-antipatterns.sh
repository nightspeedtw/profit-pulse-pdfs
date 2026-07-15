#!/usr/bin/env bash
# Look for retry-append antipatterns: pushing to a jsonb array without an
# idempotency key or upsert-by-canonical-id.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/retry-append-antipatterns.md"
{
  echo "# Retry-append antipatterns"
  echo
  rg -n --no-heading -g 'supabase/functions/**/*.ts' \
    '(\.push\(\s*rec|interior_illustrations:\s*\[\.\.\..*rec)' || echo "none"
  echo
  echo "## Callers of legacy appendSpreadsToPdf (should be zero outside one-shot repair)"
  rg -n --no-heading -g '!*.test.*' "appendSpreadsToPdf" supabase src || echo "none"
} > "$OUT"
echo "wrote $OUT"
