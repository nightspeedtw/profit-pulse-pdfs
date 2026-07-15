#!/usr/bin/env python3
"""Install this skill into a Claude Code project's .claude/skills directory."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

SKILL_NAME = "secretpdf-release-guardian"


def ignore(_directory: str, names: list[str]) -> set[str]:
    ignored = {"__pycache__", ".DS_Store", "skill.zip"}
    return {name for name in names if name in ignored or name.endswith(".pyc")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path, help="Target repository root")
    parser.add_argument("--force", action="store_true", help="Replace an existing installation")
    args = parser.parse_args()

    repo = args.repo.expanduser().resolve()
    if not repo.exists() or not repo.is_dir():
        parser.error(f"Repository directory does not exist: {repo}")

    source = Path(__file__).resolve().parent.parent
    destination = repo / ".claude" / "skills" / SKILL_NAME
    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.exists():
        if not args.force:
            parser.error(
                f"Destination exists: {destination}. Use --force to replace it."
            )
        shutil.rmtree(destination)

    shutil.copytree(source, destination, ignore=ignore)
    print(f"Installed {SKILL_NAME} at {destination}")
    print("Next: add the CLAUDE.md snippet from references/claude-integration.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
