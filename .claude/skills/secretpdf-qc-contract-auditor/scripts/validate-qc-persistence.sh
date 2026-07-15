#!/usr/bin/env bash
# Verify every gate reloads the persisted record before computing verdicts.
set -euo pipefail
OUT_DIR="artifacts/qc"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/persistence-reload.md"
{
  echo "# Gate persistence reload audit"
  echo
  echo "Files that compute a verdict without a preceding .select() reload:"
  rg -l -g 'supabase/functions/**/*.ts' 'verdict|passed:\s*(true|false)' supabase/functions | while read -r f; do
    if ! rg -q "\.select\(" "$f"; then
      echo "- $f (no .select before verdict)"
    fi
  done
} > "$OUT"
echo "wrote $OUT"
