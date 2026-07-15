#!/usr/bin/env bash
# Clean install + typecheck + tests + build. Writes artifacts/clean-build.json.
set -uo pipefail
mkdir -p artifacts
OUT="artifacts/clean-build.json"
declare -A r
run() { local name="$1"; shift; if "$@" > "artifacts/${name}.log" 2>&1; then r[$name]=true; else r[$name]=false; fi; }
run install bun install --frozen-lockfile
run typecheck bunx tsgo --noEmit
run tests bunx vitest run
run build bun run build
python3 -c "import json,sys; d={k:(v=='true') for k,v in dict(zip('${!r[@]}'.split(),'${r[@]}'.split())).items()}; print(json.dumps(d))" > "$OUT"
all=true; for k in install typecheck tests build; do [[ "${r[$k]:-false}" == "true" ]] || all=false; done
$all && exit 0 || exit 1
