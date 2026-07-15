#!/usr/bin/env bash
# Regression proof for the duplicate-page-retry class: the vitest suite
# must pass with the page-ledger tests included.
set -euo pipefail
bunx vitest run src/lib/pageLedger.test.ts
