#!/usr/bin/env bash
# For each supabase table, list every read and write call site.
# Helps identify producer→gate contracts and shadow writers.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/table-io.md"
{
  echo "# Table read/write paths"
  echo
  for verb in select insert update upsert delete; do
    echo "## $verb"
    rg -n --no-heading -g '!node_modules' \
      "\.from\(\s*['\"]([a-z_]+)['\"]\s*\)[^;]*\.$verb\b" \
      -r '$1  →  ($verb)' src supabase 2>/dev/null || true
    echo
  done
  echo "## Raw .from('<table>') references"
  rg -n --no-heading -g '!node_modules' "\.from\(\s*['\"]([a-z_]+)['\"]" -r '$1' src supabase || true
} > "$OUT"
echo "wrote $OUT"
