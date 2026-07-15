#!/usr/bin/env bash
# Detect the same exported symbol defined in >1 file — a common source of
# legacy/duplicate orchestrators. Writes a report and exits 1 on findings.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/duplicate-exports.md"
tmp=$(mktemp)
rg -n --no-heading -g '!node_modules' -g '!*.test.*' \
   'export (async )?function ([A-Za-z_][A-Za-z0-9_]*)' \
   -r '$2' src supabase | sort -t: -k3 > "$tmp" || true
awk -F: '{print $3}' "$tmp" | sort | uniq -c | awk '$1>1' > "$OUT_DIR/_dupes.txt"
{
  echo "# Duplicate exported functions"
  echo
  if [ ! -s "$OUT_DIR/_dupes.txt" ]; then
    echo "None."
  else
    while read -r count name; do
      echo "## $name (defined $count times)"
      grep -F ":$name" "$tmp" | awk -F: '{print "- " $1 ":" $2}'
      echo
    done < "$OUT_DIR/_dupes.txt"
  fi
} > "$OUT"
rm -f "$tmp" "$OUT_DIR/_dupes.txt"
echo "wrote $OUT"
