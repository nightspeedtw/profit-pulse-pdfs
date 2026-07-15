#!/usr/bin/env bash
# Placeholder: real detection queries pipeline_step_logs via supabase.
# This CI-safe version reads a JSON dump at artifacts/step-logs-24h.json
# (produced by an operator or nightly job) and applies the 3x-in-24h rule.
set -euo pipefail
IN="${1:-artifacts/step-logs-24h.json}"
[ -f "$IN" ] || { echo "no step-log dump at $IN"; exit 0; }
python3 - "$IN" <<'PY'
import json, sys, collections
logs = json.loads(open(sys.argv[1]).read())
c = collections.Counter()
for r in logs:
    if r.get("error_code"):
        fp = (r["step"], r.get("error_code"), r.get("book_id"))
        c[fp] += 1
recurring = [k for k,v in c.items() if v >= 3]
print(json.dumps({"recurring": recurring, "count": len(recurring)}))
sys.exit(1 if recurring else 0)
PY
