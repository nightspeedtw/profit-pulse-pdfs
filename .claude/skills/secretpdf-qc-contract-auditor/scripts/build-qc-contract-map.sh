#!/usr/bin/env bash
set -euo pipefail
OUT_DIR="artifacts/qc"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/contract-map.md"
{
  echo "# QC contract map"
  echo
  echo "## qc_scorecard write sites (producer)"
  rg -n --no-heading -g 'supabase/functions/**/*.ts' \
    "qc_scorecard:\s*\{|qc_scorecard\." | rg -v "select\(" || true
  echo
  echo "## qc gate reads"
  rg -n --no-heading -g 'supabase/functions/**/*.ts' \
    "(scorecard|qc)\.[a-z_]+\.(score|dimensions|verdict|passed)" || true
  echo
  echo "## thresholds encoded in code"
  rg -n --no-heading -g 'supabase/functions/**/*.ts' \
    '(threshold|min_score|>=\s*(70|75|80|85|90|92|95))' || true
} > "$OUT"
echo "wrote $OUT"
