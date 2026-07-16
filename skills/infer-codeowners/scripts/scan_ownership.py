#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Scan git history and emit ownership.json with per-module decayed ownership scores."""

from __future__ import annotations

import argparse
import fnmatch
import json
import math
import re
import subprocess
import sys
import tomllib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

COMMIT_MARK = "\x01"
FIELD_SEP = "\x02"

# Paths excluded from all history and HEAD accounting.
IGNORED_DIR_SEGMENTS = frozenset({
    ".git", "node_modules", "vendor", "third_party", "dist", "build",
    ".venv", "venv", "__pycache__", "pbgen", "generated",
})
IGNORED_BASENAMES = frozenset({"package-lock.json", "pnpm-lock.yaml", "go.sum"})
IGNORED_SUFFIXES = (".lock", ".lockb")  # Cargo.lock, uv.lock, yarn.lock, bun.lock(b), ...

BUILTIN_BOT_PATTERNS = (
    r"\[bot\]", r"^dependabot", r"renovate", r"github-actions",
    r"^snyk", r"greenkeeper", r"semantic-release", r"^copilot",
)
GITHUB_NOREPLY_RE = re.compile(r"noreply@github\.com$", re.IGNORECASE)
GITHUB_NOREPLY_NAMES = frozenset({"github", "github actions"})

MANIFEST_RULES = (  # (basename, kind) in per-directory priority order
    ("Cargo.toml", "cargo"),
    ("go.mod", "go"),
    ("package.json", "npm"),
    ("pyproject.toml", "python"),
    ("setup.py", "python"),
    ("setup.cfg", "python"),
    ("pom.xml", "maven"),
    ("build.gradle", "gradle"),
    ("build.gradle.kts", "gradle"),
    ("settings.gradle", "gradle"),
    ("settings.gradle.kts", "gradle"),
)

SPLIT_MIN_COMMITS = 20
SPLIT_COMMIT_FRACTION = 0.08
SPLIT_MIN_FILES = 5
SPLIT_JACCARD_MIN = 1.0 / 3.0

MIN_AUTHOR_COMMITS = 5  # keep unreferenced clusters only above this


def die(msg: str) -> "sys.NoReturn":  # type: ignore[name-defined]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_git(repo: Path | str, *args: str) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True
        )
    except FileNotFoundError:
        die("git executable not found on PATH")
    if proc.returncode != 0:
        die(f"git {args[0]} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout


def is_ignored_path(path: str) -> bool:
    base = path.rpartition("/")[2]
    if base in IGNORED_BASENAMES or base.endswith(IGNORED_SUFFIXES):
        return True
    return any(seg in IGNORED_DIR_SEGMENTS for seg in path.split("/")[:-1])


def unquote_git_path(path: str) -> str:
    """Undo git's C-style path quoting in numstat output."""
    if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
        try:
            path = (
                path[1:-1]
                .encode("utf-8")
                .decode("unicode_escape")
                .encode("latin-1")
                .decode("utf-8", "replace")
            )
        except UnicodeError:
            path = path[1:-1]
    return path


def norm_name(name: str) -> str:
    return " ".join(name.lower().replace(".", "").split())


def compile_bot_patterns(extra: list[str]) -> list[re.Pattern[str]]:
    out = []
    for pat in (*BUILTIN_BOT_PATTERNS, *extra):
        try:
            out.append(re.compile(str(pat), re.IGNORECASE))
        except re.error as exc:
            die(f"invalid bot pattern {pat!r}: {exc}")
    return out


def pair_is_bot(name: str, email: str, patterns: list[re.Pattern[str]]) -> bool:
    if any(rx.search(name) or rx.search(email) for rx in patterns):
        return True
    return bool(GITHUB_NOREPLY_RE.search(email)) and name.strip().lower() in GITHUB_NOREPLY_NAMES


def load_config(explicit: Path | None, repo_root: Path) -> dict:
    if explicit is not None:
        if not explicit.is_file():
            die(f"config file not found: {explicit}")
        target = explicit
    else:
        target = repo_root / ".codeowners.toml"
        if not target.is_file():
            return {}
    try:
        with open(target, "rb") as fh:
            return tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        die(f"cannot read config {target}: {exc}")


# ---------------------------------------------------------------------------
# History scan


@dataclass
class Pair:
    """One observed (author name, author email) combination."""

    name: str
    email: str
    commits: int = 0
    first_ts: float = math.inf
    last_ts: float = -math.inf
    shas: list[tuple[float, str]] = field(default_factory=list)  # up to 3, newest first


# A record is (pair_id, timestamp, [(path, lines_changed, is_binary), ...]).
Record = tuple[int, float, list[tuple[str, int, bool]]]


def parse_log(repo: Path, since: str | None) -> tuple[list[Pair], list[Record]]:
    fmt = f"{COMMIT_MARK}%H{FIELD_SEP}%aN{FIELD_SEP}%aE{FIELD_SEP}%ad"
    cmd = [
        "git", "-C", str(repo), "log", "--use-mailmap", "--no-renames",
        "--no-merges", "--numstat", "--date=iso-strict", f"--pretty=format:{fmt}",
    ]
    if since:
        cmd.append(f"--since={since}")
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        die("git executable not found on PATH")

    pair_ids: dict[tuple[str, str], int] = {}
    pairs: list[Pair] = []
    records: list[Record] = []
    path_cache: dict[str, str] = {}
    bad_headers = 0
    cur_files: list[tuple[str, int, bool]] | None = None

    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith(COMMIT_MARK):
            parts = line[1:].split(FIELD_SEP)
            if len(parts) != 4:
                bad_headers += 1
                cur_files = None
                continue
            sha, name, email, date = parts
            try:
                ts = datetime.fromisoformat(date).timestamp()
            except ValueError:
                bad_headers += 1
                cur_files = None
                continue
            pid = pair_ids.get((name, email))
            if pid is None:
                pid = pair_ids[(name, email)] = len(pairs)
                pairs.append(Pair(name=name, email=email))
            pair = pairs[pid]
            pair.commits += 1
            pair.first_ts = min(pair.first_ts, ts)
            pair.last_ts = max(pair.last_ts, ts)
            if len(pair.shas) < 3:  # log is newest-first
                pair.shas.append((ts, sha))
            cur_files = []
            records.append((pid, ts, cur_files))
        elif cur_files is not None and "\t" in line:
            added, deleted, path = line.split("\t", 2)
            path = unquote_git_path(path)
            if is_ignored_path(path):
                continue
            path = path_cache.setdefault(path, path)
            if added == "-":  # binary: no line counts, still a touch
                cur_files.append((path, 0, True))
            else:
                try:
                    cur_files.append((path, int(added) + int(deleted), False))
                except ValueError:
                    continue

    err_tail = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        die(f"git log failed: {err_tail.strip()}")
    if bad_headers:
        info(f"warning: skipped {bad_headers} commits with unparseable headers")
    return pairs, records


# ---------------------------------------------------------------------------
# Identity clustering (email-only union; see contract AMENDMENT 1)


@dataclass
class Cluster:
    key: str
    name: str
    names: list[str]
    emails: list[str]
    commits: int
    first_ts: float
    last_ts: float
    is_bot: bool
    suspect_shared: bool
    recent_shas: list[str]


class UnionFind:
    __slots__ = ("parent",)

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        p = self.parent
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def cluster_key(pairs: list[Pair], ids: list[int]) -> str:
    email_counts: Counter[str] = Counter()
    for i in ids:
        email = pairs[i].email.strip().lower()
        if email:
            email_counts[email] += pairs[i].commits
    if email_counts:
        return min(email_counts, key=lambda e: (-email_counts[e], e))
    name_counts: Counter[str] = Counter()
    for i in ids:
        name_counts[pairs[i].name] += pairs[i].commits
    best = min(name_counts, key=lambda n: (-name_counts[n], n))
    return "name:" + (norm_name(best) or "unknown")


def suspect_shared_email(names: list[str]) -> bool:
    """>=3 distinct normalized names with pairwise-disjoint token sets (AMENDMENT 4)."""
    token_sets = [set(n.split()) for n in {norm_name(n) for n in names} if n]
    if len(token_sets) < 3:
        return False
    return all(
        token_sets[i].isdisjoint(token_sets[j])
        for i in range(len(token_sets))
        for j in range(i + 1, len(token_sets))
    )


def build_clusters(
    pairs: list[Pair], bot_patterns: list[re.Pattern[str]]
) -> tuple[dict[int, Cluster], list[int]]:
    """Union pairs on identical lowercased email only; returns clusters + pair->root map."""
    uf = UnionFind(len(pairs))
    by_email: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(pairs):
        email = p.email.strip().lower()
        if email:
            by_email[email].append(i)
    for ids in by_email.values():
        for other in ids[1:]:
            uf.union(ids[0], other)

    # Author-keys must be unique; the only possible collision left is identical
    # normalized names on email-less pairs — those are indistinguishable, merge them.
    while True:
        groups: dict[int, list[int]] = defaultdict(list)
        for i in range(len(pairs)):
            groups[uf.find(i)].append(i)
        seen: dict[str, int] = {}
        dup: tuple[int, int] | None = None
        keys: dict[int, str] = {}
        for root, ids in groups.items():
            key = cluster_key(pairs, ids)
            if key in seen:
                dup = (seen[key], root)
                break
            seen[key] = root
            keys[root] = key
        if dup is None:
            break
        uf.union(*dup)

    clusters: dict[int, Cluster] = {}
    for root, ids in groups.items():
        name_counts: Counter[str] = Counter()
        email_counts: Counter[str] = Counter()
        commits = 0
        first_ts, last_ts = math.inf, -math.inf
        shas: list[tuple[float, str]] = []
        is_bot = False
        for i in ids:
            p = pairs[i]
            if p.name.strip():
                name_counts[p.name.strip()] += p.commits
            email = p.email.strip().lower()
            if email:
                email_counts[email] += p.commits
            commits += p.commits
            first_ts = min(first_ts, p.first_ts)
            last_ts = max(last_ts, p.last_ts)
            shas.extend(p.shas)
            is_bot = is_bot or pair_is_bot(p.name, p.email, bot_patterns)
        names = sorted(name_counts, key=lambda n: (-name_counts[n], n))
        emails = sorted(email_counts, key=lambda e: (-email_counts[e], e))
        shas.sort(key=lambda t: -t[0])
        key = keys[root]
        clusters[root] = Cluster(
            key=key,
            name=names[0] if names else key,
            names=names,
            emails=emails,
            commits=commits,
            first_ts=first_ts,
            last_ts=last_ts,
            is_bot=is_bot,
            suspect_shared=suspect_shared_email(names),
            recent_shas=[sha for _, sha in shas[:3]],
        )
    pair_root = [uf.find(i) for i in range(len(pairs))]
    return clusters, pair_root


def name_alias_groups(clusters: dict[int, Cluster], keep: set[str]) -> list[list[str]]:
    """Groups of kept non-bot clusters sharing a >=2-token normalized display name."""
    by_norm: dict[str, set[str]] = defaultdict(set)
    for c in clusters.values():
        if c.is_bot or c.key not in keep:
            continue
        for name in c.names:
            norm = norm_name(name)
            if len(norm.split()) >= 2:
                by_norm[norm].add(c.key)
    groups = {tuple(sorted(keys)) for keys in by_norm.values() if len(keys) >= 2}
    return [list(g) for g in sorted(groups)]


# ---------------------------------------------------------------------------
# Module detection


@dataclass
class Module:
    path: str
    kind: str
    name: str
    split_from: str | None = None


def _read_text(fp: Path) -> str:
    return fp.read_text(encoding="utf-8", errors="replace")


def parse_cargo(fp: Path) -> str | None:
    """Package name ('' if unknown) for a [package] manifest, None for workspace-only."""
    try:
        data = tomllib.loads(_read_text(fp))
    except tomllib.TOMLDecodeError:
        try:
            text = _read_text(fp)
        except OSError:
            return ""
        if re.search(r"(?m)^\s*\[package\]", text) is None:
            return None
        m = re.search(r'(?m)^\s*name\s*=\s*"([^"]+)"', text)
        return m.group(1) if m else ""
    except OSError:
        return ""  # unreadable from working tree; assume package
    pkg = data.get("package")
    if not isinstance(pkg, dict):
        return None
    name = pkg.get("name")
    return name if isinstance(name, str) else ""


def manifest_name(fp: Path, base: str, kind: str) -> str | None:
    try:
        if kind == "go":
            for line in _read_text(fp).splitlines():
                line = line.strip()
                if line.startswith("module ") or line.startswith("module\t"):
                    return line.split()[1].strip('"').rpartition("/")[2]
        elif kind == "npm":
            name = json.loads(_read_text(fp)).get("name")
            return name if isinstance(name, str) else None
        elif kind == "python" and base == "pyproject.toml":
            data = tomllib.loads(_read_text(fp))
            for section in (data.get("project"), data.get("tool", {}).get("poetry")):
                if isinstance(section, dict) and isinstance(section.get("name"), str):
                    return section["name"]
        elif kind == "maven":
            text = re.sub(r"<parent>.*?</parent>", "", _read_text(fp), flags=re.DOTALL)
            m = re.search(r"<artifactId>\s*([^<]+?)\s*</artifactId>", text)
            return m.group(1) if m else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError, tomllib.TOMLDecodeError):
        return None
    return None


def detect_modules(repo_root: Path, head_files: list[str], cfg: dict) -> dict[str, Module]:
    basenames_by_dir: dict[str, set[str]] = defaultdict(set)
    for path in head_files:
        d, _, base = path.rpartition("/")
        basenames_by_dir[d].add(base)

    modules: dict[str, Module] = {}
    for d, basenames in basenames_by_dir.items():
        for base, kind in MANIFEST_RULES:
            if base not in basenames:
                continue
            fp = repo_root / d / base if d else repo_root / base
            if kind == "cargo":
                name = parse_cargo(fp)
                if name is None:  # [workspace]-only Cargo.toml is not a module
                    continue
            else:
                name = manifest_name(fp, base, kind)
            fallback = d.rpartition("/")[2] if d else repo_root.name
            modules[d] = Module(path=d, kind=kind, name=name or fallback)
            break

    mod_cfg = cfg.get("modules")
    mod_cfg = mod_cfg if isinstance(mod_cfg, dict) else {}
    for extra in mod_cfg.get("extra", []):
        d = str(extra).strip("/")
        if d and d not in modules:
            modules[d] = Module(path=d, kind="dir", name=d.rpartition("/")[2])
    for pat in mod_cfg.get("exclude", []):
        for mpath in [m for m in modules if fnmatch.fnmatch(m, str(pat))]:
            del modules[mpath]
    if "" not in modules:
        modules[""] = Module(path="", kind="root", name=repo_root.name)
    return modules


def make_module_of(module_paths: frozenset[str]):
    cache: dict[str, str] = {"": ""}  # root "" is always a module

    def dir_module(d: str) -> str:
        got = cache.get(d)
        if got is None:
            got = d if d in module_paths else dir_module(d.rpartition("/")[0])
            cache[d] = got
        return got

    return lambda path: dir_module(path.rpartition("/")[0])


# ---------------------------------------------------------------------------
# Scoring


def decay_factor(ts: float, now_ts: float, half_life_days: float) -> float:
    return 0.5 ** (max(0.0, now_ts - ts) / 86400.0 / half_life_days)


def touch_lines(files: list[tuple[str, int, bool]]) -> tuple[int, int]:
    """(recorded lines, lines for the log term — binary touch counts as 1)."""
    lines = log_lines = 0
    for _, n, binary in files:
        if binary:
            log_lines += 1
        else:
            lines += n
            log_lines += n
    return lines, log_lines


def bucketize(records: list[Record], pair_root: list[int], module_of) -> dict[str, list]:
    """Group commit touches per module: module -> [(cluster_root, ts, files), ...]."""
    buckets: dict[str, list] = defaultdict(list)
    for pid, ts, files in records:
        if not files:
            continue
        by_mod: dict[str, list] = {}
        for f in files:
            by_mod.setdefault(module_of(f[0]), []).append(f)
        root = pair_root[pid]
        for mod, fl in by_mod.items():
            buckets[mod].append((root, ts, fl))
    return buckets


def aggregate(entries: list, now_ts: float, half_life: float) -> tuple[dict[int, list], float]:
    """Per-author [score, commits, lines, last_ts] plus the module's last commit ts."""
    stats: dict[int, list] = {}
    last_ts = -math.inf
    for root, ts, files in entries:
        lines, log_lines = touch_lines(files)
        score = decay_factor(ts, now_ts, half_life) * math.log2(1 + log_lines)
        s = stats.get(root)
        if s is None:
            stats[root] = [score, 1, lines, ts]
        else:
            s[0] += score
            s[1] += 1
            s[2] += lines
            s[3] = max(s[3], ts)
        last_ts = max(last_ts, ts)
    return stats, last_ts


def rank_owners(stats: dict[int, list], clusters: dict[int, Cluster], top: int) -> list[dict]:
    human = [(root, s) for root, s in stats.items() if not clusters[root].is_bot]
    total = sum(s[0] for _, s in human)
    human.sort(key=lambda item: (-item[1][0], -item[1][1], clusters[item[0]].key))
    return [
        {
            "author": clusters[root].key,
            "score": round(s[0], 4),
            "share": round(s[0] / total, 4) if total > 0 else 0.0,
            "commits": s[1],
            "lines": s[2],
            "last_commit": iso(s[3]),
        }
        for root, s in human[:top]
    ]


# ---------------------------------------------------------------------------
# Divergent-submodule split


def candidate_dirs(mpath: str, head_files: list[str]) -> set[str]:
    """Direct child dirs of the module root, plus direct children of src/.

    Bare `src` itself is never a candidate: it IS the module's source tree, and
    "splitting" it would leave only manifest churn behind (spurious ownership).
    """
    base = f"{mpath}/" if mpath else ""
    out: set[str] = set()
    for f in head_files:
        parts = f[len(base):].split("/")
        if len(parts) >= 2:
            if parts[0] == "src":
                if len(parts) >= 3:
                    out.add(f"{base}src/{parts[1]}")
            else:
                out.add(base + parts[0])
    return out


def top_authors(entries: list, clusters: dict[int, Cluster], now_ts: float, half_life: float) -> list[int]:
    scores: dict[int, float] = defaultdict(float)
    for root, ts, files in entries:
        if clusters[root].is_bot:
            continue
        _, log_lines = touch_lines(files)
        scores[root] += decay_factor(ts, now_ts, half_life) * math.log2(1 + log_lines)
    return sorted(scores, key=lambda r: (-scores[r], clusters[r].key))[:3]


def find_splits(
    modules: dict[str, Module],
    buckets: dict[str, list],
    module_files: dict[str, list[str]],
    clusters: dict[int, Cluster],
    no_split: set[str],
    now_ts: float,
    half_life: float,
) -> list[Module]:
    new: list[Module] = []
    for mpath in modules:
        if mpath in no_split:
            continue
        entries = buckets.get(mpath)
        head_files = module_files.get(mpath)
        if not entries or not head_files:
            continue
        threshold = max(SPLIT_MIN_COMMITS, SPLIT_COMMIT_FRACTION * len(entries))
        for cand in sorted(candidate_dirs(mpath, head_files)):
            if cand in modules:
                continue
            prefix = cand + "/"
            if sum(1 for f in head_files if f.startswith(prefix)) < SPLIT_MIN_FILES:
                continue
            cand_entries, rest_entries = [], []
            for root, ts, files in entries:
                inside = [f for f in files if f[0].startswith(prefix)]
                if inside:
                    cand_entries.append((root, ts, inside))
                if len(inside) < len(files):
                    outside = [f for f in files if not f[0].startswith(prefix)]
                    rest_entries.append((root, ts, outside))
            if len(cand_entries) < threshold or not rest_entries:
                continue
            cand_top = top_authors(cand_entries, clusters, now_ts, half_life)
            rest_top = top_authors(rest_entries, clusters, now_ts, half_life)
            if not cand_top or not rest_top:
                continue
            cset, rset = set(cand_top), set(rest_top)
            jaccard = len(cset & rset) / len(cset | rset)
            if cand_top[0] not in rset or jaccard < SPLIT_JACCARD_MIN:
                new.append(
                    Module(path=cand, kind="dir", name=cand.rpartition("/")[2], split_from=mpath)
                )
    return new


# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=".", help="path to the git repository (default: .)")
    ap.add_argument("--out", default="ownership.json", help="output file, '-' for stdout")
    ap.add_argument("--config", type=Path, default=None,
                    help="config TOML (default: <repo>/.codeowners.toml)")
    ap.add_argument("--half-life-days", type=float, default=365.0,
                    help="score half-life in days (default: 365)")
    ap.add_argument("--since", default=None, help="git --since filter, e.g. '18.months'")
    ap.add_argument("--top", type=int, default=10, help="owners per module (default: 10)")
    ap.add_argument("--max-split-depth", type=int, default=1,
                    help="divergent-submodule split rounds (default: 1, 0 disables)")
    args = ap.parse_args(argv)

    if args.half_life_days <= 0:
        die("--half-life-days must be > 0")
    if args.top < 1:
        die("--top must be >= 1")
    repo_arg = Path(args.repo)
    if not repo_arg.exists():
        die(f"no such directory: {repo_arg}")
    repo_root = Path(run_git(repo_arg, "rev-parse", "--show-toplevel").strip())
    head_proc = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"], capture_output=True, text=True
    )
    if head_proc.returncode != 0:
        die(f"repository at {repo_root} has no commits")
    head = head_proc.stdout.strip()

    cfg = load_config(args.config, repo_root)
    bots_cfg = cfg.get("bots")
    bot_patterns = compile_bot_patterns(
        bots_cfg.get("patterns", []) if isinstance(bots_cfg, dict) else []
    )
    mod_cfg = cfg.get("modules")
    mod_cfg = mod_cfg if isinstance(mod_cfg, dict) else {}
    no_split = {str(p).strip("/") for p in mod_cfg.get("no_split", [])}

    info(f"scanning {repo_root} ...")
    pairs, records = parse_log(repo_root, args.since)
    if not records:
        die("no commits found" + (f" since {args.since!r}" if args.since else ""))
    clusters, pair_root = build_clusters(pairs, bot_patterns)
    info(f"{len(records)} commits, {len(pairs)} identities, {len(clusters)} clusters")

    head_files = [
        p for p in run_git(repo_root, "ls-files", "-z").split("\0")
        if p and not is_ignored_path(p)
    ]
    modules = detect_modules(repo_root, head_files, cfg)
    info(f"{len(modules)} modules detected")

    now_ts = datetime.now(timezone.utc).timestamp()
    half_life = args.half_life_days

    for round_no in range(max(0, args.max_split_depth)):
        module_of = make_module_of(frozenset(modules))
        module_files: dict[str, list[str]] = defaultdict(list)
        for f in head_files:
            module_files[module_of(f)].append(f)
        buckets = bucketize(records, pair_root, module_of)
        new_mods = find_splits(modules, buckets, module_files, clusters, no_split, now_ts, half_life)
        if not new_mods:
            break
        for m in new_mods:
            modules[m.path] = m
        info(f"split round {round_no + 1}: carved out {len(new_mods)} submodules")

    module_of = make_module_of(frozenset(modules))
    module_files = defaultdict(list)
    for f in head_files:
        module_files[module_of(f)].append(f)
    buckets = bucketize(records, pair_root, module_of)

    out_modules = []
    for mpath in sorted(modules):
        entries = buckets.get(mpath)
        if not entries:  # no activity in window: nothing to own
            continue
        stats, last_ts = aggregate(entries, now_ts, half_life)
        mod = modules[mpath]
        out_modules.append({
            "path": mpath,
            "kind": mod.kind,
            "name": mod.name,
            "split_from": mod.split_from,
            "files": len(module_files.get(mpath, [])),
            "commits": len(entries),
            "last_commit": iso(last_ts),
            "owners_ranked": rank_owners(stats, clusters, args.top),
        })

    repo_stats: dict[int, list] = {}
    for pid, ts, files in records:
        root = pair_root[pid]
        lines, log_lines = touch_lines(files)
        score = decay_factor(ts, now_ts, half_life) * math.log2(1 + log_lines)
        s = repo_stats.get(root)
        if s is None:
            repo_stats[root] = [score, 1, lines, ts]
        else:
            s[0] += score
            s[1] += 1
            s[2] += lines
            s[3] = max(s[3], ts)
    repo_owners = rank_owners(repo_stats, clusters, args.top)

    referenced = {e["author"] for m in out_modules for e in m["owners_ranked"]}
    referenced |= {e["author"] for e in repo_owners}
    authors_out: dict[str, dict] = {}
    for c in sorted(clusters.values(), key=lambda c: c.key):
        if c.key not in referenced and c.commits < MIN_AUTHOR_COMMITS:
            continue
        entry = {
            "name": c.name,
            "names": c.names,
            "emails": c.emails,
            "commits": c.commits,
            "first_commit": iso(c.first_ts),
            "last_commit": iso(c.last_ts),
            "is_bot": c.is_bot,
            "recent_shas": c.recent_shas,
        }
        if c.suspect_shared:
            entry["suspect_shared"] = True
        authors_out[c.key] = entry

    result = {
        "schema": 1,
        "repo_root": str(repo_root),
        "generated_at": iso(now_ts),
        "head": head,
        "params": {
            "half_life_days": float(args.half_life_days),
            "since": args.since,
            "top": args.top,
        },
        "authors": authors_out,
        "name_alias_groups": name_alias_groups(clusters, set(authors_out)),
        "repo_totals": {"commits": len(records), "owners_ranked": repo_owners},
        "modules": out_modules,
    }
    payload = json.dumps(result, indent=1)
    if args.out == "-":
        print(payload)
    else:
        out_path = Path(args.out).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload + "\n", encoding="utf-8")
    info(f"ownership: {len(out_modules)} active modules, {len(authors_out)} authors kept")


if __name__ == "__main__":
    main()
