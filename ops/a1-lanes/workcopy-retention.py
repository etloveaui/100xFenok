#!/usr/bin/env python3
"""A1 adaptation of fh-workcopy-retention: published, idle copies older than seven days."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

AGE_SECONDS = 7 * 86400
SCRIPT_SUFFIXES = {".py", ".sh", ".mjs", ".js", ".cjs", ".service", ".timer"}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "site-packages"}


def run(argv, cwd=None):
    result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=60,
                            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})
    if result.returncode:
        raise RuntimeError(f"command_failed:{Path(argv[0]).name}:{result.returncode}")
    return result.stdout


def git(repo, *args):
    return run(["git", "-C", str(repo), *args]).strip()


def no_links(path):
    return path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents))


def allowed(path):
    if not no_links(path) or Path("/data") not in path.parents:
        return False
    relative = path.relative_to("/data")
    return (len(relative.parts) == 1 and path.name.startswith("wt-")) or (
        len(relative.parts) >= 3 and relative.parts[1] == "_tmp")


def product_origin(repo):
    url = git(repo, "remote", "get-url", "origin")
    return url.endswith((":etloveaui/100xFenok.git", "/etloveaui/100xFenok.git",
                         "/etloveaui/100xFenok")) and (
        "github.com" in url or "github-100xf-a1:" in url)


def worktrees(repo):
    output = git(repo, "worktree", "list", "--porcelain", "-z")
    return {Path(field[9:]) for field in output.split("\0") if field.startswith("worktree ")}


def process_paths():
    # Root visibility is required: an unobserved process must not lose its files.
    result = subprocess.run(["sudo", "-n", "/usr/bin/lsof", "-nP", "-Fpn"],
                            text=True, capture_output=True, timeout=60)
    if result.returncode or result.stderr.strip():
        raise RuntimeError("open_file_observation_incomplete")
    names = [line[1:].removesuffix(" (deleted)")
             for line in result.stdout.splitlines() if line.startswith("n/")]
    if not names:
        raise RuntimeError("open_file_observation_empty")
    # lsof already reports kernel paths. Resolving /proc executable links as
    # the user would lose visibility over root processes for no useful reason.
    return [Path(name) for name in names if name == "/data" or name.startswith("/data/")]


def inside(path, roots):
    return any(path == root or root in path.parents for root in roots)


def reference_roots():
    home = Path.home()
    roots = [home / ".config/systemd/user", Path("/etc/systemd/system"),
             Path("/usr/lib/systemd/system"), home / ".local/bin", home / ".local/lib",
             Path("/etc/cron.d"), Path("/etc/cron.daily"), Path("/etc/cron.weekly")]
    for root in Path("/data").iterdir():
        if root.name != "lost+found" and root.is_dir() and no_links(root):
            roots.extend([root / "scripts", root / "ops"])
    return [root for root in roots if root.is_dir()]


def reference_corpus():
    contents = []
    for root in reference_roots():
        for base, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (Path(base) / d).is_symlink()]
            for name in files:
                path = Path(base) / name
                if path.suffix not in SCRIPT_SUFFIXES and root.name not in {"bin", "cron.d", "cron.daily", "cron.weekly"}:
                    continue
                contents.append(path.read_text(errors="replace"))
    cron = subprocess.run(["crontab", "-l"], text=True, capture_output=True, timeout=15)
    if cron.returncode == 0:
        contents.append(cron.stdout)
    elif "no crontab" not in cron.stderr.lower():
        raise RuntimeError("crontab_observation_incomplete")
    return "\n".join(contents)


def scan_copies(root):
    if not root.is_dir() or not no_links(root):
        return
    for base, dirs, files in os.walk(root, followlinks=False):
        here = Path(base)
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (here / d).is_symlink()]
        if (here / ".git").exists():
            yield here
            dirs[:] = []


def eligible(path, repo, registered, handles, references):
    if not allowed(path) or path == repo:
        return "outside_roots_or_symlink"
    if not path.is_dir():
        return "missing"
    stat = path.stat()
    if time.time() - max(stat.st_mtime, stat.st_ctime) <= AGE_SECONDS:
        return "younger_than_7_days"
    if any(inside(handle, [path]) for handle in handles):
        return "process_cwd_or_open_file"
    if str(path) in references:
        return "unit_or_script_reference"
    try:
        if Path(git(path, "rev-parse", "--show-toplevel")).resolve() != path or not product_origin(path):
            return "not_product_repository"
        if path not in registered and len(worktrees(path)) != 1:
            return "clone_has_worktrees"
        if git(path, "status", "--porcelain", "--ignored", "--untracked-files=normal", "--", "."):
            return "dirty_untracked_or_ignored"
        control = Path(git(path, "rev-parse", "--absolute-git-dir"))
        if any(inside(handle, [control]) for handle in handles):
            return "git_control_in_use"
        if any((control / name).exists() for name in (
                "index.lock", "HEAD.lock", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD",
                "rebase-merge", "rebase-apply", "sequencer")):
            return "git_operation_active"
        stamps = [p.stat().st_mtime for p in (control / "HEAD", control / "index", control / "logs/HEAD") if p.exists()]
        if stamps and time.time() - max(stamps) <= AGE_SECONDS:
            return "git_activity_within_7_days"
        git(path, "merge-base", "--is-ancestor", "HEAD", "origin/main")
        if git(path, "stash", "list"):
            return "stash_present"
        if path not in registered:
            for tip in git(path, "for-each-ref", "--format=%(objectname)", "refs/heads").splitlines():
                git(path, "merge-base", "--is-ancestor", tip, "origin/main")
    except (RuntimeError, OSError, subprocess.TimeoutExpired):
        return "git_guard_or_unpublished_revision"
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("/data/100xFenok-a1"))
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    repo = args.repo
    if sys.platform != "linux" or not no_links(repo) or not product_origin(repo):
        raise RuntimeError("A1 product checkout is required")
    before = shutil.disk_usage("/data")
    registered = worktrees(repo)
    candidates = {p for p in registered if allowed(p)}
    for parent in Path("/data").iterdir():
        if parent.name == "lost+found" or not no_links(parent) or not parent.is_dir():
            continue
        candidates.update(scan_copies(parent / "_tmp"))
        if parent.name.startswith("wt-"):
            candidates.update(scan_copies(parent))
    handles = process_paths()
    references = reference_corpus()
    removed = freed = 0
    for candidate in sorted(candidates):
        reason = eligible(candidate, repo, registered, handles, references)
        action = "keep" if reason else "would_remove"
        if not reason and args.apply:
            # Repeat the actual loss-prevention conditions at the removal boundary.
            reason = eligible(candidate, repo, worktrees(repo), process_paths(), reference_corpus())
            if reason:
                action = "keep"
            else:
                size = int(run(["du", "-sk", str(candidate)]).split()[0]) * 1024
                if candidate in registered:
                    git(repo, "worktree", "remove", str(candidate))
                else:
                    shutil.rmtree(candidate)
                action = "removed"
                removed += 1
                freed += size
        print(json.dumps({"path": str(candidate), "action": action, "reason": reason}), flush=True)
    after = shutil.disk_usage("/data")
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", "removed": removed,
                      "bytes_freed": freed, "disk_used_before": before.used,
                      "disk_used_after": after.used, "disk_free_after": after.free}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
