#!/usr/bin/env python3
"""Small cross-platform source watcher used when fswatch/inotify are absent."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

EXCLUDED_DIRS = {
    ".git",
    ".vite",
    ".wrangler",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "secrets",
    "test-results",
    "tests",
}


def parse_args() -> tuple[list[Path], list[str]]:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise SystemExit("expected -- before the sync command") from exc
    roots = [Path(value) for value in sys.argv[1:separator]]
    command = sys.argv[separator + 1 :]
    if not roots or not command:
        raise SystemExit("expected watched paths and a sync command")
    return roots, command


def snapshot(roots: list[Path]) -> dict[str, tuple[int, int, int]]:
    entries: dict[str, tuple[int, int, int]] = {}
    for root in roots:
        if not root.exists():
            continue
        paths = [root] if root.is_file() else []
        if root.is_dir():
            for directory, child_dirs, files in os.walk(root):
                child_dirs[:] = [name for name in child_dirs if name not in EXCLUDED_DIRS]
                paths.extend(Path(directory) / name for name in files)
        for path in paths:
            try:
                info = path.stat()
            except OSError:
                continue
            entries[str(path)] = (info.st_mtime_ns, info.st_size, info.st_ino)
    return entries


def main() -> int:
    roots, command = parse_args()
    previous = snapshot(roots)
    while True:
        time.sleep(1)
        current = snapshot(roots)
        if current == previous:
            continue
        changed = set(previous) ^ set(current)
        changed.update(
            path
            for path in previous.keys() & current.keys()
            if previous[path] != current[path]
        )
        print(f"Source changed ({len(changed)} paths); syncing…", flush=True)
        time.sleep(0.2)
        result = subprocess.run(command, check=False)
        if result.returncode:
            print(f"Sync exited with status {result.returncode}; watching continues.", flush=True)
        previous = snapshot(roots)


if __name__ == "__main__":
    raise SystemExit(main())
