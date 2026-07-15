#!/usr/bin/env bash
# For each gate name, list producer write paths and gate read paths side by side.
set -euo pipefail
OUT_DIR="artifacts/qc"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/producer-vs-gate.md"
GATES=(story_judge reader_experience character_consistency cover_qc pdf_preflight formatting title_gate sales_page)
{
  echo "# Producer vs gate field comparison"
  for g in "${GATES[@]}"; do
    echo
    echo "## $g"
    echo "### Producer write sites"
    rg -n --no-heading -g 'supabase/functions/**/*.ts' "qc_scorecard[^=]*$g" || echo "  none"
    echo "### Gate read sites"
    rg -n --no-heading -g 'supabase/functions/**/*.ts' "scorecard[^)]*\.$g|qc\.$g" || echo "  none"
  done
} > "$OUT"
echo "wrote $OUT"
