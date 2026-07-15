#!/usr/bin/env bash
# Inventory every env / config read so silent toggles are visible.
set -euo pipefail
OUT_DIR="artifacts/architecture"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/feature-flags.md"
{
  echo "# Feature flag / env inventory"
  echo
  echo "## Deno.env.get(...)"
  rg -n --no-heading -g 'supabase/functions/**/*.ts' "Deno\.env\.get\(\s*['\"]([A-Z0-9_]+)['\"]" -r '$1' || true
  echo
  echo "## import.meta.env.VITE_*"
  rg -n --no-heading -g 'src/**/*.{ts,tsx}' "import\.meta\.env\.(VITE_[A-Z0-9_]+)" -r '$1' || true
  echo
  echo "## platform_settings reads"
  rg -n --no-heading -g '!node_modules' "platform_settings" src supabase || true
  echo
  echo "## generation_settings reads"
  rg -n --no-heading -g '!node_modules' "generation_settings" src supabase || true
} > "$OUT"
echo "wrote $OUT"
