#!/usr/bin/env bash
# Flag any gate that scores 0 / "n/a" when the underlying data is missing.
set -euo pipefail
OUT_DIR="artifacts/qc"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/na-gates.md"
{
  echo "# n/a and null-coalesce-to-zero gate patterns"
  echo
  rg -n --no-heading -g 'supabase/functions/**/*.ts' \
    "(\?\?\s*0|score:\s*0\b|score:\s*'n/a'|score:\s*\"n/a\"|verdict:\s*['\"]n/a)" || echo "none"
} > "$OUT"
echo "wrote $OUT"
