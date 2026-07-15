#!/usr/bin/env bash
# Phase-1 boundary: kids/adult PDF pipeline must not import Shopify, SEO,
# publish, royalty, or trading code. Exits 1 on violations.
set -euo pipefail
PATTERN='shopify|storefront-publish|kdp|seo|royalty|exchange|trading'
violations=$(rg -n --no-heading -g 'supabase/functions/kids-*/**/*.ts' -g 'supabase/functions/autopilot-*/**/*.ts' \
  -g 'supabase/functions/build-pdf/**/*.ts' -g 'supabase/functions/kids-build-picture-pdf/**/*.ts' \
  -g 'supabase/functions/kids-render-interior/**/*.ts' \
  "import[^;]*(?i)($PATTERN)" || true)
if [ -n "$violations" ]; then
  echo "PHASE1 BOUNDARY VIOLATIONS:"
  echo "$violations"
  exit 1
fi
echo "phase1 boundary clean"
