#!/usr/bin/env python3
"""Run every fixtures/*/run.sh and aggregate results."""
import json, os, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
OUT = pathlib.Path("artifacts/regression-suite.json")

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    results, all_ok = [], True
    if not FIXTURES.exists():
        print("no fixtures directory yet — nothing to run"); OUT.write_text("[]"); sys.exit(0)
    for fx in sorted(FIXTURES.iterdir()):
        run = fx / "run.sh"
        if not run.exists(): continue
        t0 = time.time()
        r = subprocess.run(["bash", str(run)], capture_output=True, text=True)
        ok = r.returncode == 0
        all_ok &= ok
        results.append({
            "fixture": fx.name, "ok": ok, "duration_ms": int((time.time()-t0)*1000),
            "stdout_tail": r.stdout[-400:], "stderr_tail": r.stderr[-400:],
        })
        print(f"[{'PASS' if ok else 'FAIL'}] {fx.name}")
    OUT.write_text(json.dumps(results, indent=2))
    sys.exit(0 if all_ok else 1)

if __name__ == "__main__": main()
