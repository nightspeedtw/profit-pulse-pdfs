#!/usr/bin/env python3
"""Create a lightweight SecretPDF repository architecture inventory."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

KEY_PATTERNS = {
    "orchestrator": re.compile(r"orchestrator|pipeline", re.I),
    "watchdog_recovery": re.compile(r"watchdog|recovery|supervisor", re.I),
    "qc": re.compile(r"qc|quality", re.I),
    "pdf": re.compile(r"pdf|render", re.I),
    "cover_thumbnail": re.compile(r"cover|thumbnail|mockup", re.I),
    "kids_illustrated": re.compile(r"kids|children|storybook|illustrat", re.I),
    "sales_storefront": re.compile(r"sales|product|storefront|shopify", re.I),
}

SEARCH_TERMS = [
    "computeQcGates",
    "final_pdf_url",
    "pdf_url",
    "reader_experience",
    "cover_thumb",
    "Fix All",
    "final_pdf_ready",
    "publish_live",
]

TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".sql", ".py", ".md", ".json", ".yaml", ".yml"}


def collect_files(repo: Path) -> list[Path]:
    ignored = {"node_modules", ".git", "dist", "build", ".next", "coverage"}
    files: list[Path] = []
    for path in repo.rglob("*"):
        if any(part in ignored for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            files.append(path)
    return files


def audit(repo: Path) -> dict:
    files = collect_files(repo)
    relative = [str(path.relative_to(repo)) for path in files]

    categories = {
        name: [item for item in relative if pattern.search(item)]
        for name, pattern in KEY_PATTERNS.items()
    }

    term_hits: dict[str, list[dict[str, object]]] = {term: [] for term in SEARCH_TERMS}
    for path in files:
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = content.splitlines()
        for term in SEARCH_TERMS:
            for line_no, line in enumerate(lines, start=1):
                if term in line:
                    term_hits[term].append({
                        "file": str(path.relative_to(repo)),
                        "line": line_no,
                        "text": line.strip()[:240],
                    })

    supabase_functions = repo / "supabase" / "functions"
    migrations = repo / "supabase" / "migrations"

    function_dirs = []
    if supabase_functions.exists():
        function_dirs = sorted(
            str(path.relative_to(repo))
            for path in supabase_functions.iterdir()
            if path.is_dir() and not path.name.startswith("_")
        )

    migration_files = []
    if migrations.exists():
        migration_files = sorted(
            str(path.relative_to(repo))
            for path in migrations.glob("*.sql")
        )

    return {
        "repo": str(repo.resolve()),
        "text_file_count": len(files),
        "supabase_function_count": len(function_dirs),
        "migration_count": len(migration_files),
        "agent_files": [item for item in relative if Path(item).name in {"AGENTS.md", "CLAUDE.md"}],
        "categories": categories,
        "term_hits": term_hits,
        "supabase_functions": function_dirs,
        "migrations": migration_files,
        "warnings": [
            "Inventory is heuristic; confirm the runtime call graph with code tracing and tests.",
            "Multiple files in an entry-point category may indicate duplicate logic, not necessarily a defect.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.repo.is_dir():
        print(f"Repository directory not found: {args.repo}", file=sys.stderr)
        return 2

    result = audit(args.repo)
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(args.output)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
