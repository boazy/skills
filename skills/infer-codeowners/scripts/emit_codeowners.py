#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Emit a CODEOWNERS file and a markdown evidence report from ownership.json + identities.json."""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from itertools import combinations
from pathlib import Path

DAYS_PER_MONTH = 30.4375


def err(msg: str) -> None:
    print(msg, file=sys.stderr)


def fail(msg: str, code: int = 1) -> None:
    err(f"error: {msg}")
    sys.exit(code)


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def load_json(path: Path, what: str) -> dict:
    try:
        with path.open("rb") as f:
            data = json.load(f)
    except OSError as e:
        fail(f"cannot read {what} at {path}: {e}")
    except json.JSONDecodeError as e:
        fail(f"{what} at {path} is not valid JSON: {e}")
    if not isinstance(data, dict):
        fail(f"{what} at {path}: expected a JSON object")
    return data


def load_config(explicit: Path | None, repo_root: str | None) -> dict:
    path = explicit
    if path is None and repo_root:
        candidate = Path(repo_root) / ".codeowners.toml"
        if candidate.is_file():
            path = candidate
    if path is None:
        return {}
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except OSError as e:
        if explicit is not None:
            fail(f"cannot read config at {path}: {e}")
        return {}
    except tomllib.TOMLDecodeError as e:
        fail(f"config at {path} is not valid TOML: {e}")
    return {}  # unreachable; keeps type-checkers happy


@dataclass(frozen=True)
class SelectionParams:
    max_owners: int
    min_share_ratio: float
    min_commits: int
    inactive_months: float
    default_owners: tuple[str, ...]


@dataclass
class ModuleRow:
    path: str
    kind: str
    split_from: str | None
    owners: list[str] = field(default_factory=list)  # emitted handles, post-fold
    evidence: list[dict] = field(default_factory=list)  # aggregated top-3
    inherited: bool = False
    bus_factor: bool = False
    suppressed: bool = False
    uncovered: bool = False
    is_root: bool = False
    override: bool = False
    logins: list[str] = field(default_factory=list)  # selected bare logins, pre-fold


# CODEOWNERS requires write access. The legacy `.permission` field is
# admin/write/read/none, but be defensive about role-style values leaking in.
PERM_ALLOWED = frozenset({"admin", "maintain", "write", "push"})
PERM_DENIED = frozenset({"none", "read", "pull", "triage"})

# Managed-block markers. Matching is on exact line content after stripping
# trailing whitespace; the block's content is the only thing this tool ever
# rewrites inside an existing CODEOWNERS.
MARKER_BEGIN = "# >>> infer-codeowners: managed rules (regenerate instead of editing) <<<"
MARKER_END = "# >>> infer-codeowners: end managed rules <<<"

GLOB_CHARS = frozenset("*?[]!")


def build_owner_map(
    ownership: dict, identities: dict
) -> tuple[dict[str, str], list[tuple[str, str, str]], list[str]]:
    """author-key -> bare github login, for eligible authors only.

    Also returns:
    - [(author-key, login, permission)] for authors excluded because they lack
      repo write access (CODEOWNERS requires write for review assignment);
    - [login] for eligible owners whose access could NOT be verified
      (permission "unknown": offline mode, non-GitHub host, or a 403 on the
      permission endpoint). They stay eligible — excluding them would empty the
      output for offline/limited-token runs — but must be surfaced loudly.
    """
    authors = ownership.get("authors", {})
    ignored = set(identities.get("ignored", []))
    owner_map: dict[str, str] = {}
    no_access: list[tuple[str, str, str]] = []
    unverified: list[str] = []
    for key, info in identities.get("resolved", {}).items():
        login = (info or {}).get("login")
        if not login or key in ignored:
            continue
        if (info or {}).get("valid") is False:
            continue
        if authors.get(key, {}).get("is_bot"):
            continue
        permission = ((info or {}).get("permission") or "unknown").lower()
        if permission in PERM_DENIED:
            no_access.append((key, login, permission))
            continue
        if permission not in PERM_ALLOWED and login not in unverified:
            # "unknown" or an unrecognized (custom-role) value: keep, but flag.
            unverified.append(login)
        owner_map[key] = login
    return owner_map, no_access, unverified


def aggregate_entries(entries: list[dict], owner_map: dict[str, str]) -> list[dict]:
    """Merge OwnerEntries whose author-keys resolve to the same login (AMENDMENT 1).

    Sums score/commits/lines/share, takes max last_commit. Unresolved entries pass
    through untouched. Result is sorted by score descending.
    """
    by_login: dict[str, dict] = {}
    out: list[dict] = []
    for e in entries:
        login = owner_map.get(e.get("author", ""))
        if login is None:
            out.append(dict(e))
            continue
        agg = by_login.get(login)
        if agg is None:
            agg = dict(e)
            agg["login"] = login
            agg["author_keys"] = [e.get("author")]
            by_login[login] = agg
            out.append(agg)
            continue
        agg["score"] = round(agg.get("score", 0.0) + e.get("score", 0.0), 4)
        agg["share"] = round(agg.get("share", 0.0) + e.get("share", 0.0), 4)
        agg["commits"] = agg.get("commits", 0) + e.get("commits", 0)
        agg["lines"] = agg.get("lines", 0) + e.get("lines", 0)
        a, b = parse_iso(agg.get("last_commit")), parse_iso(e.get("last_commit"))
        if b is not None and (a is None or b > a):
            agg["last_commit"] = e.get("last_commit")
        agg["author_keys"].append(e.get("author"))
    out.sort(key=lambda e: e.get("score", 0.0), reverse=True)
    return out


def select_owners(
    entries: list[dict],
    owner_map: dict[str, str],
    params: SelectionParams,
    cutoff: datetime,
) -> tuple[list[str], bool, list[dict]]:
    """Pick owner logins from OwnerEntries.

    Returns (bare logins in score order, bus_factor_flag, aggregated entries for evidence).
    """
    aggregated = aggregate_entries(entries, owner_map)
    eligible = [e for e in aggregated if "login" in e]
    if not eligible:
        return [], False, aggregated

    def is_active(e: dict) -> bool:
        ts = parse_iso(e.get("last_commit"))
        return ts is not None and ts >= cutoff

    active = [e for e in eligible if is_active(e)]
    bus_factor = not active
    candidates = active if active else [eligible[0]]

    top = candidates[0]
    selected = [top]
    for e in candidates[1:]:
        if len(selected) >= params.max_owners:
            break
        if e.get("score", 0.0) < params.min_share_ratio * top.get("score", 0.0):
            break
        if e.get("commits", 0) < params.min_commits:
            continue  # not monotone in score order — skip, don't stop
        selected.append(e)
    return [e["login"] for e in selected], bus_factor, aggregated


def fold_team(logins: list[str], teams: dict[str, list[str]]) -> str | None:
    """Return a team handle replacing `logins`, or None when no fold applies."""
    if len(logins) < 2:
        return None
    s = set(logins)
    best: tuple[str, set[str]] | None = None
    for handle, members in teams.items():
        m = {str(x) for x in members}
        if len(s & m) >= 2 and s <= m and (best is None or len(m) < len(best[1])):
            best = (handle, m)
    return best[0] if best else None


def to_handles(logins: list[str], teams: dict[str, list[str]]) -> list[str]:
    team = fold_team(logins, teams)
    return [team] if team else [f"@{login}" for login in logins]


def ancestor_paths(path: str):
    parts = path.split("/")
    for i in range(len(parts) - 1, 0, -1):
        yield "/".join(parts[:i])


def applicable_owners(
    path: str, emitted: dict[str, list[str]], star_owners: list[str]
) -> list[str]:
    """Owners of the rule that would already match `path` (nearest ancestor rule, else `*`)."""
    for anc in ancestor_paths(path):
        if anc in emitted:
            return emitted[anc]
    return star_owners


def evidence_cell(entries: list[dict]) -> str:
    bits = []
    for e in entries[:3]:
        who = e.get("login") or e.get("author", "?")
        keys = e.get("author_keys") or []
        merged = f" [{'+'.join(keys)}]" if len(keys) > 1 else ""
        last = (e.get("last_commit") or "?")[:10]
        bits.append(
            f"`{who}`{merged} s={e.get('score', 0.0):g} "
            f"sh={e.get('share', 0.0) * 100:.0f}% c={e.get('commits', 0)} last={last}"
        )
    return "<br>".join(bits) if bits else "—"


def team_suggestions(
    raw_sets: list[frozenset[str]], teams: dict[str, list[str]]
) -> list[tuple[frozenset[str], int]]:
    """Owner sets (size >= 2) selected together in >= 3 modules, not covered by a configured team."""
    counter: Counter[frozenset[str]] = Counter()
    for s in raw_sets:
        for r in range(2, len(s) + 1):
            for combo in combinations(sorted(s), r):
                counter[frozenset(combo)] += 1
    team_members = [{str(x) for x in m} for m in teams.values()]
    hits = {
        c: n
        for c, n in counter.items()
        if n >= 3 and not any(c <= t for t in team_members)
    }
    maximal = [c for c in hits if not any(c < other for other in hits)]
    return sorted(((c, hits[c]) for c in maximal), key=lambda x: (-x[1], sorted(x[0])))


# --- update mode (`--existing`) ---------------------------------------------


def norm_pattern(pat: str) -> str:
    """Normalize a CODEOWNERS pattern for exact-equivalence checks (`/p/` == `/p`)."""
    if pat == "*":
        return pat
    stripped = pat.rstrip("/")
    return stripped or "/"


def parse_rule(line: str) -> tuple[str, list[str]] | None:
    """(pattern, owners) for a rule line; None for blank/comment lines."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    tokens = stripped.split()
    owners: list[str] = []
    for tok in tokens[1:]:
        if tok.startswith("#"):
            break
        owners.append(tok)
    return tokens[0], owners


def module_shaped_path(pattern: str) -> str | None:
    """Repo-relative module path when `pattern` looks like a generated module rule."""
    if not pattern.startswith("/") or any(c in GLOB_CHARS for c in pattern):
        return None
    return pattern.strip("/") or None


def lookup_handle(owner: str, handles: dict) -> dict | None:
    info = handles.get(owner)
    if info is None:
        lowered = {str(k).lower(): v for k, v in handles.items()}
        info = lowered.get(owner.lower())
    return info if isinstance(info, dict) else None


def handle_issues(owner: str, handles: dict) -> list[str]:
    """Health problems for an owner handle, per identities.json `handles`."""
    info = lookup_handle(owner, handles)
    if info is None:
        return []
    issues: list[str] = []
    if info.get("valid") is False:
        issues.append("not found on GitHub")
    permission = (info.get("permission") or "unknown").lower()
    if permission in PERM_DENIED:
        issues.append(f"no repo write access (permission: {permission})")
    if info.get("active_recently") is False:
        issues.append("inactive")
    return issues


def owner_annotations(
    old_owners: list[str], new_owners: list[str], handles: dict, evidence: list[dict]
) -> list[str]:
    """Per-owner change annotations (AMENDMENT 5) for a same-pattern owner diff."""
    shares = {f"@{e['login']}": e.get("share") for e in evidence if e.get("login")}
    notes: list[str] = []
    for o in old_owners:
        if o in new_owners:
            continue
        info = lookup_handle(o, handles) or {}
        if info.get("valid") is False:
            notes.append(f"removed `{o}`: no longer available on GitHub")
        elif (info.get("permission") or "").lower() in PERM_DENIED:
            notes.append(f"removed `{o}`: lost repo access")
        else:
            share = shares.get(o)
            extra = f" (current share {share * 100:.0f}%)" if share is not None else ""
            notes.append(f"removed `{o}`: no longer meets selection{extra}")
    for o in new_owners:
        if o in old_owners:
            continue
        share = shares.get(o)
        if share is not None:
            notes.append(f"added `{o}`: share now {share * 100:.0f}%")
        else:
            notes.append(f"added `{o}`")
    return notes


@dataclass
class UpdateResult:
    mode: str  # human-readable mode description for the report
    text: str  # merged CODEOWNERS content
    added: list[dict] = field(default_factory=list)       # {pattern, owners}
    changed: list[dict] = field(default_factory=list)     # {pattern, old, new, notes}
    proposals: list[dict] = field(default_factory=list)   # {line, pattern, old, new, notes}
    stale: list[dict] = field(default_factory=list)       # {line, pattern}
    conflicts: list[dict] = field(default_factory=list)   # {line, pattern, owners, kind, with?}
    custom_health: list[dict] = field(default_factory=list)  # {line, pattern, owner, issues}
    appended_block: bool = False


def patterns_overlap(existing_pat: str, gen_pattern: str) -> bool:
    """Conservative test: can `existing_pat` match files that `gen_pattern` also matches?

    `gen_pattern` is always a generated rule: "*" or "/path/". Used to warn about
    last-match-wins shadowing; false positives are acceptable, silence is not.
    """
    if existing_pat == "*" or gen_pattern == "*":
        return True
    gen_path = gen_pattern.strip("/")
    # gitignore anchoring: a pattern is root-relative only when it starts with "/"
    # or contains an interior "/". Anything else — literal (`docs`, `Makefile`,
    # `foo/`) or glob (`*.sql`) — matches at ANY depth, so it can match files
    # under every generated rule.
    if not existing_pat.startswith("/") and "/" not in existing_pat.rstrip("/"):
        return True
    if any(c in GLOB_CHARS for c in existing_pat):
        # anchored glob: compare its literal prefix with the generated path
        literal = existing_pat.lstrip("/")
        for ch in GLOB_CHARS:
            literal = literal.split(ch)[0]
        literal = literal.rpartition("/")[0]  # drop the partial segment the glob starts in
        return (
            not literal
            or literal == gen_path
            or literal.startswith(gen_path + "/")
            or gen_path.startswith(literal + "/")
        )
    e = existing_pat.strip("/")
    return e == gen_path or e.startswith(gen_path + "/") or gen_path.startswith(e + "/")


def merge_existing(
    existing_text: str,
    gen_rules: list[tuple[str, list[str]]],
    adopt_exact: bool,
    module_paths: set[str],
    handles: dict,
    evidence_by_pattern: dict[str, list[dict]],
) -> UpdateResult:
    """Merge generated rules into an existing CODEOWNERS (AMENDMENTS 5+6).

    Positional preservation is the invariant: rules the tool did not positively
    author are never moved, reordered, or deleted.
    """
    lines = existing_text.split("\n")
    # Lines inserted into a CRLF file must carry \r too: split("\n") keeps the \r
    # on existing lines, so preservation is automatic — only NEW lines need it.
    cr = "\r" if "\r\n" in existing_text else ""
    begins = [i for i, l in enumerate(lines) if l.rstrip() == MARKER_BEGIN]
    ends = [i for i, l in enumerate(lines) if l.rstrip() == MARKER_END]
    if len(begins) > 1 or len(ends) > 1:
        fail(
            "existing CODEOWNERS contains more than one managed block "
            f"({max(len(begins), len(ends))} markers); merge them by hand first"
        )
    if len(begins) != len(ends) or (begins and ends[0] < begins[0]):
        fail("existing CODEOWNERS has a malformed managed block (unpaired/misordered markers)")

    gen_by_norm = {norm_pattern(p): (p, owners) for p, owners in gen_rules}
    rule_lines = [f"{p} {' '.join(owners)}{cr}" for p, owners in gen_rules]

    def annotate(pattern: str, old: list[str], new: list[str]) -> list[str]:
        evidence = evidence_by_pattern.get(norm_pattern(pattern), [])
        return owner_annotations(old, new, handles, evidence)

    def is_stale(pattern: str) -> bool:
        path = module_shaped_path(pattern)
        if path is None or norm_pattern(pattern) in gen_by_norm:
            return False
        return path not in module_paths and not any(
            m.startswith(path + "/") for m in module_paths
        )

    def health_of(line_no: int, pattern: str, owners: list[str]) -> list[dict]:
        return [
            {"line": line_no, "pattern": pattern, "owner": o, "issues": issues}
            for o in owners
            if (issues := handle_issues(o, handles))
        ]

    if begins:  # --- Case A: splice into the single managed block ------------
        b, e = begins[0], ends[0]
        res = UpdateResult(mode="managed-block update (Case A)", text="")
        old_block: dict[str, tuple[str, list[str]]] = {}
        for line in lines[b + 1 : e]:
            rule = parse_rule(line)
            if rule:
                old_block[norm_pattern(rule[0])] = rule
        for pattern, owners in gen_rules:
            old = old_block.get(norm_pattern(pattern))
            if old is None:
                res.added.append({"pattern": pattern, "owners": owners})
            elif set(old[1]) != set(owners):
                res.changed.append(
                    {"pattern": pattern, "old": old[1], "new": owners,
                     "notes": annotate(pattern, old[1], owners)}
                )
        for i, line in enumerate(lines):
            if b <= i <= e:
                continue
            rule = parse_rule(line)
            if rule is None:
                continue
            pattern, owners = rule
            if norm_pattern(pattern) in gen_by_norm:
                res.conflicts.append(
                    {"line": i + 1, "pattern": pattern, "owners": owners, "kind": "duplicate"}
                )
            elif i > e and (shadowed := [
                p for p, _ in gen_rules if patterns_overlap(pattern, p)
            ]):
                # a rule after the managed block wins over these generated rules
                res.conflicts.append(
                    {"line": i + 1, "pattern": pattern, "owners": owners,
                     "kind": "shadows", "with": shadowed[:3], "with_count": len(shadowed)}
                )
            if is_stale(pattern):
                res.stale.append({"line": i + 1, "pattern": pattern})
            res.custom_health.extend(health_of(i + 1, pattern, owners))
        res.text = "\n".join(lines[: b + 1] + rule_lines + lines[e:])
        return res

    # --- Case B: no managed block (hand-written file) -----------------------
    mode = "append-only (Case B)" + (" with --adopt-exact" if adopt_exact else "")
    res = UpdateResult(mode=mode, text="")
    existing_norms: set[str] = set()
    for i, line in enumerate(lines):
        rule = parse_rule(line)
        if rule is None:
            continue
        pattern, owners = rule
        norm = norm_pattern(pattern)
        existing_norms.add(norm)
        gen = gen_by_norm.get(norm)
        if gen is not None and set(owners) != set(gen[1]):
            if adopt_exact:
                indent = line[: len(line) - len(line.lstrip())]
                lines[i] = f"{indent}{pattern} {' '.join(gen[1])}{cr}"
                res.changed.append(
                    {"pattern": pattern, "old": owners, "new": gen[1],
                     "notes": annotate(pattern, owners, gen[1])}
                )
            else:
                res.proposals.append(
                    {"line": i + 1, "pattern": pattern, "old": owners, "new": gen[1],
                     "notes": annotate(pattern, owners, gen[1])}
                )
        if is_stale(pattern):
            res.stale.append({"line": i + 1, "pattern": pattern})
        res.custom_health.extend(health_of(i + 1, pattern, owners))

    to_append = []
    for p, owners in gen_rules:
        if norm_pattern(p) in existing_norms:
            continue
        if p == "*":
            # NEVER append `*` after hand-written rules: last-match-wins would let it
            # steal every path not covered by a later module rule. Proposal only.
            res.proposals.append(
                {"line": 0, "pattern": "*", "old": [], "new": owners,
                 "notes": ["a `*` default rule belongs at the TOP of the file — "
                           "add it manually (or migrate the file to a managed block)"]}
            )
            continue
        to_append.append((p, owners))
    if to_append:
        # Every existing rule that can match files under an appended rule is now
        # shadowed by it for those paths (the appended block comes last).
        for i, line in enumerate(lines):
            rule = parse_rule(line)
            if rule is None or norm_pattern(rule[0]) in gen_by_norm:
                continue
            shadowed = [p for p, _ in to_append if patterns_overlap(rule[0], p)]
            if shadowed:
                res.conflicts.append(
                    {"line": i + 1, "pattern": rule[0], "owners": rule[1],
                     "kind": "shadowed-by-append", "with": shadowed[:3],
                     "with_count": len(shadowed)}
                )
    res.added = [{"pattern": p, "owners": owners} for p, owners in to_append]
    body = lines[:]
    if body and body[-1] == "":
        body.pop()  # the trailing-newline artifact of split("\n") — re-added below
    if to_append:
        if cr and body and not body[-1].endswith("\r"):
            body[-1] += cr  # file lacked a final newline; keep the CRLF convention
        block = ([cr] if body else []) + [MARKER_BEGIN + cr]
        block += [f"{p} {' '.join(owners)}{cr}" for p, owners in to_append]
        block.append(MARKER_END + cr)
        res.text = "\n".join(body + block) + "\n"
        res.appended_block = True
    else:
        res.text = "\n".join(lines)  # byte-identical unless --adopt-exact changed lines
    return res


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ownership", required=True, type=Path, help="ownership.json from scan_ownership.py")
    p.add_argument("--identities", required=True, type=Path, help="identities.json from resolve_identities.py")
    p.add_argument("--out", default="-", help="CODEOWNERS output path, or '-' for stdout (default)")
    p.add_argument("--report", type=Path, help="write a markdown evidence report here")
    p.add_argument("--config", type=Path, help=".codeowners.toml (default: <repo_root>/.codeowners.toml)")
    p.add_argument("--max-owners", type=int, help="max owners per rule (default 3)")
    p.add_argument("--min-share-ratio", type=float, help="owner kept while score >= ratio * top score (default 0.33)")
    p.add_argument("--min-commits", type=int, help="min commits for non-top owners (default 3)")
    p.add_argument("--inactive-months", type=float, help="owner inactive after this many months (default 18)")
    p.add_argument("--default-owners", nargs="*", metavar="HANDLE", help="fallback owners, verbatim (e.g. @org/platform)")
    p.add_argument("--fail-on-blocking", action="store_true", help="exit 2 when identities.json has blocking unresolved authors")
    p.add_argument("--existing", type=Path, help="existing CODEOWNERS to update in place (managed-block splice or append-only merge)")
    p.add_argument("--adopt-exact", action="store_true", help="with --existing and no managed block: replace owners in place on rules whose pattern exactly matches a generated one (default: propose only)")
    return p


def main() -> None:
    args = build_arg_parser().parse_args()
    if args.adopt_exact and not args.existing:
        fail("--adopt-exact requires --existing")

    ownership = load_json(args.ownership, "ownership.json")
    identities = load_json(args.identities, "identities.json")
    config = load_config(args.config, ownership.get("repo_root"))
    sel_cfg = config.get("selection", {})
    teams: dict[str, list[str]] = config.get("teams", {}) or {}
    overrides: dict[str, list[str]] = {
        str(k): [str(x) for x in v] for k, v in (config.get("overrides", {}) or {}).items()
    }

    def pick(cli_value, key, builtin):
        if cli_value is not None:
            return cli_value
        return sel_cfg.get(key, builtin)

    params = SelectionParams(
        max_owners=int(pick(args.max_owners, "max_owners", 3)),
        min_share_ratio=float(pick(args.min_share_ratio, "min_share_ratio", 0.33)),
        min_commits=int(pick(args.min_commits, "min_commits", 3)),
        inactive_months=float(pick(args.inactive_months, "inactive_months", 18)),
        default_owners=tuple(pick(args.default_owners, "default_owners", [])),
    )

    blocking = [u for u in identities.get("unresolved", []) if u.get("blocking")]
    if blocking:
        err("=" * 68)
        err("WARNING: unresolved identities likely change CODEOWNERS output:")
        for u in blocking:
            mods = ", ".join(
                f"{b.get('module') or '(root)'} (rank {b.get('rank')}, share {b.get('share', 0) * 100:.0f}%)"
                for b in u["blocking"]
            )
            sugg = u.get("suggestion") or {}
            hint = f" — suggestion: {sugg['login']} ({sugg.get('reason', 'no reason')})" if sugg.get("login") else ""
            err(f"  - {u.get('author')} ({u.get('name', '?')}): blocks {mods}{hint}")
        err("Fix via [identities] in .codeowners.toml or rerun resolve_identities.py.")
        err("=" * 68)
        if args.fail_on_blocking:
            fail("blocking unresolved identities present (--fail-on-blocking)", code=2)

    owner_map, no_access, unverified = build_owner_map(ownership, identities)
    if unverified:
        err(
            f"WARNING: repo access could not be verified for {len(unverified)} owner account(s): "
            + ", ".join(unverified)
        )
        err(
            "  They are kept as owners; after pushing, validate with "
            "`gh api repos/<owner>/<repo>/codeowners/errors` (CODEOWNERS requires write access)."
        )
    if no_access:
        err(f"note: {len(no_access)} resolved account(s) lack repo write access and were excluded as owners:")
        for key, login, permission in no_access:
            err(f"  - {key} -> {login} (permission: {permission})")
    ref = parse_iso(ownership.get("generated_at")) or datetime.now(UTC)
    cutoff = ref - timedelta(days=params.inactive_months * DAYS_PER_MONTH)

    # Update mode must be known BEFORE rule assembly: in Case B (existing file
    # without managed markers) the generated `*` is proposal-only and suppression
    # cannot assume our rules dominate the file — disable it for correctness.
    existing_text: str | None = None
    case_b = False
    if args.existing:
        try:
            with args.existing.open(encoding="utf-8", newline="") as f:
                existing_text = f.read()  # newline="" keeps CRLF intact
        except OSError as e:
            fail(f"cannot read existing CODEOWNERS at {args.existing}: {e}")
        case_b = not any(l.rstrip() == MARKER_BEGIN for l in existing_text.split("\n"))

    # --- `*` default rule -------------------------------------------------
    repo_entries = (ownership.get("repo_totals") or {}).get("owners_ranked", [])
    star_logins, star_bus, star_evidence = select_owners(repo_entries, owner_map, params, cutoff)
    star_owners = to_handles(star_logins, teams) if star_logins else list(params.default_owners)
    if not star_owners:
        err("warning: no owners resolved for the repo and no default_owners configured; omitting the `*` rule")

    # --- per-module rules -------------------------------------------------
    modules = sorted(ownership.get("modules", []), key=lambda m: m.get("path", ""))
    emitted: dict[str, list[str]] = {}
    rows: list[ModuleRow] = []
    raw_owner_sets: list[frozenset[str]] = []

    for mod in modules:
        path = mod.get("path", "")
        row = ModuleRow(
            path=path,
            kind=mod.get("kind", "dir"),
            split_from=mod.get("split_from"),
            is_root=(path == ""),
        )
        logins, row.bus_factor, aggregated = select_owners(
            mod.get("owners_ranked", []), owner_map, params, cutoff
        )
        row.evidence = aggregated
        row.logins = logins
        if path in overrides and not row.is_root:
            # [overrides]: the user's explicit decision — verbatim owners,
            # no eligibility checks, no team folding, no suppression.
            row.owners = list(overrides[path])
            row.override = True
            row.bus_factor = False
            row.logins = []
            emitted[path] = row.owners
            rows.append(row)
            continue
        if len(logins) >= 2:
            raw_owner_sets.append(frozenset(logins))

        if row.is_root:  # covered by `*`; never gets its own rule
            row.owners = list(star_owners)
            row.suppressed = False
            rows.append(row)
            continue

        if logins:
            row.owners = to_handles(logins, teams)
        else:
            inherited = applicable_owners(path, emitted, star_owners) or list(params.default_owners)
            if not inherited:
                row.uncovered = True
                rows.append(row)
                continue
            row.owners = list(inherited)
            row.inherited = True

        already = None if case_b else applicable_owners(path, emitted, star_owners)
        if already and set(already) == set(row.owners):
            row.suppressed = True
        else:
            emitted[path] = row.owners
        rows.append(row)

    # [overrides] for paths without a detected module still emit a rule.
    module_paths = {m.get("path", "") for m in modules}
    for opath in sorted(overrides):
        if not opath or opath in module_paths:
            continue
        emitted[opath] = list(overrides[opath])
        rows.append(ModuleRow(path=opath, kind="—", split_from=None,
                              owners=list(overrides[opath]), override=True))
    rows.sort(key=lambda r: r.path)

    # --- CODEOWNERS text ---------------------------------------------------
    head = ownership.get("head", "unknown")
    header = [
        "# CODEOWNERS — generated by the infer-codeowners skill; do not edit by hand.",
        f"# Generated: {datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"# Repo HEAD: {head}",
        "# Regenerate:",
        "#   uv run scripts/scan_ownership.py --repo . --out ownership.json",
        "#   uv run scripts/resolve_identities.py --ownership ownership.json --out identities.json",
        "#   uv run scripts/emit_codeowners.py --ownership ownership.json --identities identities.json --out CODEOWNERS",
        "",
    ]
    gen_rules: list[tuple[str, list[str]]] = []
    if star_owners:
        gen_rules.append(("*", star_owners))
    for path in sorted(emitted):  # lexicographic: parents precede children (last match wins)
        gen_rules.append((f"/{path}/", emitted[path]))
    rule_lines = [f"{p} {' '.join(owners)}" for p, owners in gen_rules]

    handles: dict = identities.get("handles", {}) or {}
    update: UpdateResult | None = None
    if args.existing:
        assert existing_text is not None  # read during early Case B detection
        evidence_by_pattern: dict[str, list[dict]] = {"*": star_evidence}
        for r in rows:
            if r.path:
                evidence_by_pattern[f"/{r.path}"] = r.evidence  # norm_pattern form
        update = merge_existing(
            existing_text, gen_rules, args.adopt_exact,
            module_paths - {""}, handles, evidence_by_pattern,
        )
        text = update.text
    else:
        # Fresh mode: generation header comments + one managed block, nothing else.
        text = "\n".join(header + [MARKER_BEGIN] + rule_lines + [MARKER_END]) + "\n"

    if args.out == "-":
        sys.stdout.write(text)
    else:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8", newline="")
        err(f"wrote {out_path} ({len(emitted) + (1 if star_owners else 0)} rules)")

    if update is not None:
        if update.appended_block:
            err("=" * 68)
            err("NOTE: a managed block was APPENDED at the end of the file.")
            err("CODEOWNERS is last-match-wins: the appended rules take precedence over")
            err("earlier hand-written rules for those paths. Review before committing.")
            err("=" * 68)
        if update.proposals:
            err(
                f"note: {len(update.proposals)} existing exact-pattern rule(s) differ from the "
                "generated owners; left untouched — see the report "
                "(rerun with --adopt-exact to replace owners in place)"
            )
        if update.conflicts:
            err(
                f"WARNING: {len(update.conflicts)} precedence conflict(s) between custom rules "
                "and generated rules (last-match-wins shadowing; see report)"
            )

    # --- inactivity notices (automatic when identities.json has activity data) --
    activity_days = identities.get("activity_window_days")
    inactive_map: dict[str, list[str]] = {}
    all_inactive: list[dict] = []
    if activity_days is not None:
        login_active: dict[str, bool | None] = {}
        for _key, info in identities.get("resolved", {}).items():
            login = (info or {}).get("login")
            if not login:
                continue
            ar = (info or {}).get("active_recently")
            cur = login_active.get(login)
            if ar is True or cur is True:
                login_active[login] = True
            elif ar is False or cur is False:
                login_active[login] = False
            else:
                login_active[login] = None

        def check_rule(label: str, logins: list[str], display: list[str], evidence: list[dict]) -> None:
            for login in logins:
                if login_active.get(login) is False:
                    inactive_map.setdefault(login, []).append(label)
            if logins and all(login_active.get(login) is False for login in logins):
                alts = []
                for e in evidence:
                    login = e.get("login")
                    if not login or login in logins or login_active.get(login) is False:
                        continue
                    alts.append({"login": login, "share": e.get("share", 0.0)})
                    if len(alts) == 3:
                        break
                all_inactive.append({"label": label, "owners": display, "alternatives": alts})

        if star_owners and star_logins:
            check_rule("*", star_logins, star_owners, star_evidence)
        for r in rows:
            if r.path and r.path in emitted and not r.override and r.logins:
                check_rule(f"/{r.path}/", r.logins, r.owners, r.evidence)

        if all_inactive:
            err("=" * 68)
            err(
                "WARNING: rules whose selected owners are ALL inactive on GitHub "
                f"(no activity in {activity_days} days):"
            )
            for entry in all_inactive:
                alts = ", ".join(
                    f"@{a['login']} (share {a['share'] * 100:.0f}%)" for a in entry["alternatives"]
                ) or "none found in evidence"
                err(f"  - {entry['label']}: {' '.join(entry['owners'])} — alternatives: {alts}")
            err("Selection is unchanged; record replacements via [overrides] in .codeowners.toml.")
            err("=" * 68)

    # --- report ------------------------------------------------------------
    if args.report:
        report = render_report(
            ownership, rows, star_owners, star_bus, star_evidence, blocking,
            team_suggestions(raw_owner_sets, teams), params, no_access, unverified,
            update, activity_days, inactive_map, all_inactive,
        )
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report, encoding="utf-8")
        err(f"wrote {args.report}")


def render_report(
    ownership: dict,
    rows: list[ModuleRow],
    star_owners: list[str],
    star_bus: bool,
    star_evidence: list[dict],
    blocking: list[dict],
    suggestions: list[tuple[frozenset[str], int]],
    params: SelectionParams,
    no_access: list[tuple[str, str, str]],
    unverified: list[str],
    update: UpdateResult | None = None,
    activity_days: int | None = None,
    inactive_map: dict[str, list[str]] | None = None,
    all_inactive: list[dict] | None = None,
) -> str:
    suppressed = [r for r in rows if r.suppressed]
    uncovered = [r for r in rows if r.uncovered]
    bus_rows = [r for r in rows if r.bus_factor]

    md: list[str] = [
        "# CODEOWNERS evidence report",
        "",
        f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} from "
        f"`{ownership.get('repo_root', '?')}` at HEAD `{ownership.get('head', '?')}`.",
        "",
        f"Selection: max_owners={params.max_owners}, min_share_ratio={params.min_share_ratio}, "
        f"min_commits={params.min_commits}, inactive_months={params.inactive_months:g}.",
        "",
        "## Default rule (`*`)",
        "",
        f"Owners: {' '.join(star_owners) if star_owners else '_none — rule omitted_'}"
        + (" ⚠️ bus-factor risk (all candidates inactive)" if star_bus else ""),
        "",
        f"Evidence: {evidence_cell(star_evidence)}",
        "",
        "## Modules",
        "",
        "| Path | Kind | Split from | Owners | Evidence (top 3) | Notes |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        notes = []
        if r.is_root:
            notes.append("root — covered by `*`")
        if r.inherited:
            notes.append("inherited")
        if r.suppressed:
            notes.append("suppressed (same as applicable rule)")
        if r.uncovered:
            notes.append("uncovered")
        if r.bus_factor:
            notes.append("bus-factor ⚠️")
        if r.override:
            notes.append("override" + (" (no detected module)" if r.kind == "—" else ""))
        md.append(
            f"| `{r.path or '(root)'}` | {r.kind} | {r.split_from or '—'} "
            f"| {' '.join(r.owners) or '—'} | {evidence_cell(r.evidence)} | {', '.join(notes) or '—'} |"
        )

    if update is not None:
        md += ["", "## Changes vs existing CODEOWNERS", "", f"Mode: {update.mode}."]
        if update.appended_block:
            md += [
                "",
                "> ⚠️ A managed block was **appended at the end of the file**. CODEOWNERS is "
                "last-match-wins: the appended rules take precedence over earlier hand-written "
                "rules for those paths — review before committing.",
            ]
        md += ["", "### Added", ""]
        md += [
            f"- `{a['pattern']}` → {' '.join(a['owners'])}" for a in update.added
        ] or ["_none_"]
        md += ["", "### Changed", ""]
        if update.changed:
            for c in update.changed:
                md.append(f"- `{c['pattern']}` — `{' '.join(c['old']) or '(no owners)'}` → `{' '.join(c['new'])}`")
                md += [f"  - {note}" for note in c["notes"]]
        else:
            md.append("_none_")
        md += ["", "### Proposed owner updates (not applied)", ""]
        if update.proposals:
            md.append(
                "These existing rules exactly match a generated pattern but have different "
                "owners. The file was left untouched — apply with `--adopt-exact`, an "
                "`[overrides]` entry, or by hand."
            )
            md.append("")
            for p in update.proposals:
                where = f"line {p['line']}" if p.get("line") else "missing rule"
                current = f"current `{' '.join(p['old'])}`, " if p.get("old") else ""
                md.append(
                    f"- {where} `{p['pattern']}` — {current}"
                    f"generated `{' '.join(p['new'])}`"
                )
                md += [f"  - {note}" for note in p["notes"]]
        else:
            md.append("_none_")
        md += ["", "### Possibly stale", ""]
        md += [
            f"- line {s['line']} `{s['pattern']}` — no matching module in ownership.json (left untouched; delete by hand if obsolete)"
            for s in update.stale
        ] or ["_none_"]
        md += ["", "### Precedence conflicts", ""]
        conflict_lines = []
        for c in update.conflicts:
            owners = " ".join(c.get("owners", [])) or "(none)"
            kind = c.get("kind", "duplicate")
            if kind == "duplicate":
                desc = ("duplicates a generated pattern — with last-match-wins the later "
                        "rule governs; resolve manually")
            else:
                examples = ", ".join(f"`{p}`" for p in c.get("with", []))
                n = c.get("with_count", 0)
                more = f" (+{n - len(c.get('with', []))} more)" if n > len(c.get("with", [])) else ""
                if kind == "shadows":
                    desc = (f"comes AFTER the managed block and overrides generated rules "
                            f"{examples}{more} for overlapping paths")
                else:  # shadowed-by-append
                    desc = (f"is overridden by the appended managed rules {examples}{more} "
                            f"for paths they match (the appended block comes last)")
            conflict_lines.append(f"- line {c['line']} `{c['pattern']}` (custom, owners `{owners}`) {desc}")
        md += conflict_lines or ["_none_"]
        md += ["", "### Custom rules health", ""]
        md += [
            f"- line {h['line']} `{h['pattern']}` — `{h['owner']}`: {'; '.join(h['issues'])}"
            for h in update.custom_health
        ] or ["_none — no problems found among custom rule owners_"]

    md += ["", f"## Suppressed rules ({len(suppressed)})", ""]
    md += [f"- `/{r.path}/` — identical owners to its applicable rule" for r in suppressed] or ["_none_"]

    md += ["", "## Bus-factor risks", ""]
    bus_lines = [f"- `*` (repo default): only inactive candidates; kept {' '.join(star_owners)}"] if star_bus else []
    bus_lines += [
        f"- `/{r.path}/`: all eligible owners inactive for > {params.inactive_months:g} months; kept {' '.join(r.owners)}"
        for r in bus_rows
    ]
    md += bus_lines or ["_none_"]

    if activity_days is not None:
        md += ["", f"## Inactive owners (no GitHub activity in {activity_days} days)", ""]
        md += [
            f"- `{login}` — owns: {', '.join(f'`{m}`' for m in mods)}"
            for login, mods in sorted((inactive_map or {}).items())
        ] or ["_none_"]
        if all_inactive:
            md += ["", "### Rules where ALL selected owners are inactive", ""]
            md.append(
                "Selection is unchanged (notification only). To hand a module over, accept an "
                "alternative via `[overrides]` in `.codeowners.toml` (or fix `[identities]`) and re-emit."
            )
            md.append("")
            for entry in all_inactive:
                alts = ", ".join(
                    f"`@{a['login']}` (share {a['share'] * 100:.0f}%)" for a in entry["alternatives"]
                ) or "_none found in evidence_"
                md.append(f"- `{entry['label']}` ({' '.join(entry['owners'])}) — alternatives: {alts}")

    md += ["", "## Uncovered modules", ""]
    md += [f"- `/{r.path}/` — no eligible owners and nothing to inherit" for r in uncovered] or ["_none_"]

    md += ["", "## Action needed — unresolved identities that affect ownership", ""]
    if blocking:
        for u in blocking:
            emails = ", ".join(u.get("emails", []))
            mods = "; ".join(
                f"`{b.get('module') or '(root)'}` (rank {b.get('rank')}, share {b.get('share', 0) * 100:.0f}%)"
                for b in u.get("blocking", [])
            )
            md.append(f"- **{u.get('author')}** — {u.get('name', '?')} <{emails}>")
            md.append(f"  - blocks: {mods}")
            sugg = u.get("suggestion") or {}
            if sugg.get("login"):
                md.append(f"  - suggestion: `{sugg['login']}` — {sugg.get('reason', 'no reason given')}")
            md.append(
                "  - fix: add `\"" + str(u.get("author")) + "\" = \"<login>\"` under `[identities]` in `.codeowners.toml`"
            )
    else:
        md.append("_none — all influential authors resolved_")

    md += ["", "## Unverified repo access", ""]
    if unverified:
        md.append(
            "Access could not be verified for these owners (offline mode, non-GitHub host, or "
            "no permission to query). CODEOWNERS requires **write** access — validate after pushing:"
        )
        md += [f"- `@{login}`" for login in unverified]
    else:
        md.append("_none — all owner permissions verified_")

    md += ["", "## Excluded — resolved accounts without repo write access", ""]
    if no_access:
        md += [
            f"- **{key}** -> `{login}` (permission: {permission}) — likely a stale/departed account; "
            'map the author to their current account or `"!ignore"` under `[identities]`'
            for key, login, permission in no_access
        ]
    else:
        md.append("_none_")

    md += ["", "## Team suggestions", ""]
    if suggestions:
        md += [
            f"- {' + '.join(f'`{login}`' for login in sorted(combo))} — co-selected in {n} modules; "
            "consider a `[teams]` entry"
            for combo, n in suggestions
        ]
    else:
        md.append("_none_")

    return "\n".join(md) + "\n"


if __name__ == "__main__":
    main()
