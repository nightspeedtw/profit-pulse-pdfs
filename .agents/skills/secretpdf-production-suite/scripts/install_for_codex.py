#!/usr/bin/env python3
"""Install this skill into a repository's .agents/skills directory."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

SKILL_NAME = "secretpdf-production-suite"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    repo = args.repo.resolve()
    if not repo.is_dir():
        print(f"Repository directory not found: {repo}", file=sys.stderr)
        return 2

    source = Path(__file__).resolve().parent.parent
    target = repo / ".agents" / "skills" / SKILL_NAME

    if target.exists():
        if not args.force:
            print(f"Target already exists: {target}. Use --force to replace.", file=sys.stderr)
            return 1
        shutil.rmtree(target)

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)

    print(f"Installed: {target}")
    print("Add this to the repository AGENTS.md:")
    print()
    print("For SecretPDF pipeline, PDF, QC, illustrated continuity, cover, thumbnail,")
    print("sales-page, Fix All, or recurring-regression work, invoke:")
    print("$secretpdf-production-suite")
    return 0


if __name__ == "__main__":
    sys.exit(main())
