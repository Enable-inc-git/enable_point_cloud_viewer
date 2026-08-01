#!/usr/bin/env python3
"""Back up Claude Code's project memory to Google Drive.

The memory directory lives outside this repo (in the user profile) and is the
one irreplaceable thing not covered by `git clone` — see RECOVERY.md section 5.
This copies every memory file into a Google Drive folder, rebuilds a dated
archive, and verifies each copy by SHA-256.

It relies on **Google Drive for Desktop** mounting the account as a normal
drive, so the backup is a plain file copy: no upload step, no transcoding, and
the files land byte-exact. If Drive for Desktop is not installed, install it
(or pass --dest to point somewhere else, e.g. a OneDrive or USB path).

Usage:
    python scripts/backup_memory.py                 # auto-detect everything
    python scripts/backup_memory.py --dest "D:/backups/viewer-memory"
    python scripts/backup_memory.py --check         # verify only, copy nothing
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

FOLDER_NAME = "Enable Viewer — Claude Code Memory Backup"

# Drive-for-Desktop roots to try, in order. Add to this list if the mount
# letter changes; the account that owns the backup folder is kevin@enable-inc.com.
DRIVE_ROOTS = [
    Path("H:/My Drive"),
    Path("G:/My Drive"),
    Path.home() / "My Drive",
    Path.home() / "Google Drive/My Drive",
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def find_memory_dir() -> Path:
    """Locate this project's Claude Code memory directory.

    The slug is derived from the repo's absolute path, so it differs per
    machine (e.g. C:\\enable_point_cloud_viewer -> C--enable-point-cloud-viewer).
    Rather than hardcode it, find the project dir whose memory/ holds MEMORY.md
    and mentions this project. If several match, take the most recently touched.
    """
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        sys.exit(f"No Claude Code projects directory at {projects}")

    candidates = []
    for mem in projects.glob("*/memory"):
        index = mem / "MEMORY.md"
        if not index.is_file():
            continue
        if "Point Cloud Viewer" not in index.read_text(encoding="utf-8", errors="ignore"):
            continue
        candidates.append(mem)

    if not candidates:
        sys.exit(
            "Could not find the viewer's memory directory under "
            f"{projects}. Start a Claude Code session in this repo first."
        )
    return max(candidates, key=lambda p: p.stat().st_mtime)


def find_dest(explicit: str | None) -> Path:
    if explicit:
        dest = Path(explicit)
        dest.mkdir(parents=True, exist_ok=True)
        return dest
    for root in DRIVE_ROOTS:
        if root.is_dir():
            dest = root / FOLDER_NAME
            dest.mkdir(parents=True, exist_ok=True)
            return dest
    sys.exit(
        "Google Drive for Desktop does not appear to be mounted (looked for "
        + ", ".join(str(r) for r in DRIVE_ROOTS)
        + ").\nInstall it, or pass --dest to back up somewhere else."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", help="Destination folder (default: auto-detect Google Drive)")
    ap.add_argument("--check", action="store_true", help="Verify the existing backup; copy nothing")
    args = ap.parse_args()

    src = find_memory_dir()
    dest = find_dest(args.dest)
    dest_mem = dest / "memory"
    files = sorted(src.glob("*.md"))
    if not files:
        sys.exit(f"No .md files in {src} — refusing to overwrite the backup with nothing.")

    print(f"source : {src}  ({len(files)} files, {sum(f.stat().st_size for f in files):,} bytes)")
    print(f"dest   : {dest}")

    if args.check:
        missing = [f.name for f in files if not (dest_mem / f.name).is_file()]
        differing = [
            f.name for f in files
            if (dest_mem / f.name).is_file() and sha256(f) != sha256(dest_mem / f.name)
        ]
        if missing:
            print(f"MISSING from backup ({len(missing)}): {', '.join(missing)}")
        if differing:
            print(f"STALE in backup ({len(differing)}): {', '.join(differing)}")
        if not missing and not differing:
            print(f"OK — backup matches all {len(files)} source files.")
            return 0
        return 1

    dest_mem.mkdir(parents=True, exist_ok=True)

    # Drop files that no longer exist upstream, so a deleted memory doesn't
    # linger in the backup and get restored later.
    live = {f.name for f in files}
    for stale in dest_mem.glob("*.md"):
        if stale.name not in live:
            stale.unlink()
            print(f"  removed stale {stale.name}")

    for f in files:
        shutil.copy2(f, dest_mem / f.name)

    bad = [f.name for f in files if sha256(f) != sha256(dest_mem / f.name)]
    if bad:
        sys.exit(f"Checksum mismatch after copy: {', '.join(bad)}")
    print(f"copied and verified {len(files)} files -> {dest_mem}")

    # Build the archive LOCALLY first, then copy it across. Writing a tar
    # stream straight onto the Drive-mounted filesystem works, but Drive
    # buffers the write, so stat()/sha256() immediately afterwards report a
    # half-flushed file (it looked like an empty 39-byte archive). Building
    # locally also means the checksum we print is one we actually verified.
    stamp = dt.date.today().isoformat()
    name = f"memory-backup-{stamp}.tar.gz"
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / name
        with tarfile.open(staged, "w:gz") as tar:
            for f in files:
                tar.add(f, arcname=f.name)
        with tarfile.open(staged) as tar:          # read it back before trusting it
            entries = len(tar.getnames())
        if entries != len(files):
            sys.exit(f"Archive holds {entries} entries, expected {len(files)}.")
        digest = sha256(staged)
        size = staged.stat().st_size
        shutil.copy2(staged, dest / name)
    print(f"archive: {name}  ({size:,} bytes, {entries} entries)")
    print(f"sha256 : {digest}")

    # Keep the readable index at the top level too, so it can be skimmed from a
    # phone without opening the memory/ folder.
    index = src / "MEMORY.md"
    if index.is_file():
        shutil.copy2(index, dest / "MEMORY.md (readable index)")

    repo_recovery = Path(__file__).resolve().parent.parent / "RECOVERY.md"
    if repo_recovery.is_file():
        shutil.copy2(repo_recovery, dest / "RECOVERY.md (copy from repo).md")

    print("\nDone. Google Drive for Desktop will sync it up in the background.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
