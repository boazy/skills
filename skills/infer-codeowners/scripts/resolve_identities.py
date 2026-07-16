#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Resolve author clusters from ownership.json to validated GitHub logins (identities.json)."""

import argparse
import json
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

NOREPLY_RE = re.compile(
    r"^(?:\d+\+)?([a-z\d](?:[a-z\d-]*[a-z\d])?)@users\.noreply\.github\.com$", re.I
)
SSH_URL_RE = re.compile(r"^(?:[\w.-]+@)?([\w.-]+):(.+?)(?:\.git)?/?$")
SSH_PROTO_RE = re.compile(r"^ssh://(?:[\w.-]+@)?([\w.-]+)(?::\d+)?/(.+?)(?:\.git)?/?$")
HTTP_URL_RE = re.compile(r"^https?://(?:[^@/]+@)?([\w.-]+)(?::\d+)?/(.+?)(?:\.git)?/?$")


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def die(msg: str) -> None:
    log(f"error: {msg}")
    sys.exit(1)


def run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


# ---------------------------------------------------------------- remote parsing

def parse_remote_url(url: str) -> tuple[str, str] | None:
    """Return (host, owner/name) or None."""
    for rx in (HTTP_URL_RE, SSH_PROTO_RE, SSH_URL_RE):
        if m := rx.match(url.strip()):
            host, path = m.group(1), m.group(2).strip("/")
            parts = path.split("/")
            if len(parts) >= 2:
                path = "/".join(parts[-2:])
            return host.lower(), path
    return None


def detect_remote(repo: Path) -> tuple[str | None, str | None]:
    """Detect (host, owner/name) from origin or the first remote."""
    proc = run(["git", "-C", str(repo), "remote", "get-url", "origin"])
    url = proc.stdout.strip() if proc and proc.returncode == 0 else ""
    if not url:
        proc = run(["git", "-C", str(repo), "remote"])
        remotes = proc.stdout.split() if proc and proc.returncode == 0 else []
        if remotes:
            proc = run(["git", "-C", str(repo), "remote", "get-url", remotes[0]])
            url = proc.stdout.strip() if proc and proc.returncode == 0 else ""
    if not url:
        return None, None
    parsed = parse_remote_url(url)
    return parsed if parsed else (None, None)


# ---------------------------------------------------------------- gh wrapper

@dataclass
class Gh:
    hostname: str
    available: bool = False
    calls: int = 0
    _user_cache: dict[str, tuple[bool, str]] = field(default_factory=dict)
    _team_cache: dict[str, bool | None] = field(default_factory=dict)

    def probe(self) -> None:
        proc = run(["gh", "--version"])
        if proc is None or proc.returncode != 0:
            log("note: gh CLI not found; running offline")
            return
        proc = run(["gh", "auth", "status", "--hostname", self.hostname])
        if proc is None or proc.returncode != 0:
            log(f"note: gh not authenticated for {self.hostname}; running offline")
            return
        self.available = True

    def api(self, path: str) -> tuple[object | None, bool, bool]:
        """GET `gh api PATH`. Returns (data, ok, http_404)."""
        if not self.available:
            return None, False, False
        proc = run(["gh", "api", "--hostname", self.hostname, path], timeout=60)
        if proc is None:
            return None, False, False
        self.calls += 1
        if proc.returncode == 0:
            try:
                return json.loads(proc.stdout), True, False
            except json.JSONDecodeError:
                return None, False, False
        return None, False, "HTTP 404" in proc.stderr

    def validate(self, login: str, repo_slug: str | None) -> tuple[bool | None, str]:
        """Return (valid, permission) for a login; cached across clusters."""
        if login in self._user_cache:
            return self._user_cache[login]
        if not self.available:
            return None, "unknown"
        _, ok, is_404 = self.api(f"users/{login}")
        if is_404:
            result: tuple[bool | None, str] = (False, "unknown")
        elif not ok:
            result = (None, "unknown")
        else:
            permission = "unknown"
            if repo_slug:
                data, ok2, _ = self.api(f"repos/{repo_slug}/collaborators/{login}/permission")
                if ok2 and isinstance(data, dict):
                    permission = data.get("permission") or "unknown"
            result = (True, permission)
        self._user_cache[login] = result
        return result

    def graphql(self, query: str) -> dict | None:
        """POST to the GraphQL endpoint; returns the parsed body (which may hold
        partial data alongside an errors array) or None when nothing parseable came back."""
        if not self.available:
            return None
        proc = run(["gh", "api", "graphql", "--hostname", self.hostname,
                    "-f", f"query={query}"], timeout=60)
        if proc is None:
            return None
        self.calls += 1
        try:
            body = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return None
        return body if isinstance(body, dict) else None

    def validate_team(self, org: str, slug: str) -> bool | None:
        """Does org/slug exist as a team? False only on a definite 404; cached."""
        key = f"{org}/{slug}".lower()
        if key in self._team_cache:
            return self._team_cache[key]
        if not self.available:
            return None
        _, ok, is_404 = self.api(f"orgs/{org}/teams/{slug}")
        result = True if ok else (False if is_404 else None)
        self._team_cache[key] = result
        return result


# ---------------------------------------------------------------- config

def load_config(path_arg: str | None, repo: Path) -> dict:
    path = Path(path_arg) if path_arg else repo / ".codeowners.toml"
    if not path.is_file():
        if path_arg:
            die(f"config file not found: {path}")
        return {}
    try:
        with open(path, "rb") as fh:
            return tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        die(f"cannot read config {path}: {exc}")
    return {}  # unreachable


def config_lookup(identities: dict[str, str], key: str, cluster: dict) -> str | None:
    """Match author-key, then any cluster email, then any display name."""
    lowered = {k.lower(): v for k, v in identities.items()}
    if key.lower() in lowered:
        return lowered[key.lower()]
    for email in cluster.get("emails", []):
        if email.lower() in lowered:
            return lowered[email.lower()]
    for name in cluster.get("names", []):
        if name in identities:
            return identities[name]
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


# ---------------------------------------------------------------- resolution helpers

def squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def noreply_login(cluster: dict) -> str | None:
    for email in cluster.get("emails", []):
        if m := NOREPLY_RE.match(email.strip()):
            return m.group(1)
    return None


def candidate_keys(data: dict, top_n: int = 5) -> set[str]:
    keys = {e["author"] for e in data.get("repo_totals", {}).get("owners_ranked", [])[:top_n]}
    for mod in data.get("modules", []):
        keys.update(e["author"] for e in mod.get("owners_ranked", [])[:top_n])
    return keys


def blocking_modules(data: dict, key: str) -> list[dict]:
    out = []
    for mod in data.get("modules", []):
        for rank, entry in enumerate(mod.get("owners_ranked", [])[:3], start=1):
            if entry["author"] == key:
                out.append({
                    "module": mod["path"],
                    "rank": rank,
                    "share": round(float(entry.get("share", 0.0)), 4),
                })
                break
    out.sort(key=lambda b: -b["share"])
    return out


def fetch_contributors(gh: Gh, repo_slug: str) -> dict[str, str]:
    """Map lowercase and squashed login -> canonical login (max 3 pages of 100)."""
    logins: dict[str, str] = {}
    for page in range(1, 4):
        data, ok, _ = gh.api(f"repos/{repo_slug}/contributors?per_page=100&page={page}")
        if not ok or not isinstance(data, list):
            break
        for item in data:
            login = item.get("login")
            if login:
                logins[login.lower()] = login
                logins.setdefault(squash(login), login)
        if len(data) < 100:
            break
    return logins


def suggest_from_contributors(cluster: dict, contributors: dict[str, str]) -> dict | None:
    for email in cluster.get("emails", []):
        local = email.split("@", 1)[0].lower()
        if local in contributors:
            return {"login": contributors[local],
                    "reason": "repo contributor login matches email local-part"}
    for name in cluster.get("names", []):
        squashed = squash(name)
        if squashed and squashed in contributors:
            return {"login": contributors[squashed],
                    "reason": "repo contributor login matches squashed display name"}
    return None


def pr_correlate(gh: Gh, repo_slug: str, shas: list[str]) -> dict | None:
    """PR-author correlation (amendments 2+3): evidence only, never a confirmed resolution.

    Returns a suggestion dict citing the PR numbers, or None when no sampled sha maps to a PR.
    """
    by_login: dict[str, list] = {}
    for sha in shas:
        pulls, ok, _ = gh.api(f"repos/{repo_slug}/commits/{sha}/pulls")
        if ok and isinstance(pulls, list) and pulls:
            pr = pulls[0]
            login = (pr.get("user") or {}).get("login")
            if login:
                by_login.setdefault(login, []).append(pr.get("number"))
    if not by_login:
        return None
    login, numbers = max(by_login.items(), key=lambda kv: len(kv[1]))
    unique = list(dict.fromkeys(n for n in numbers if n is not None))
    prs = ", ".join(f"#{n}" for n in unique) or "unnumbered PRs"
    return {"login": login,
            "reason": f"PR author of {prs} ({len(numbers)}/{len(shas)} sampled commits)"}


def alias_suggestion(key: str, group_of: dict[str, list[str]],
                     resolved: dict[str, dict], authors: dict) -> dict | None:
    """Suggest the login of an already-resolved member of the same name-alias group."""
    for sibling in group_of.get(key, []):
        if sibling != key and sibling in resolved:
            shared = authors.get(key, {}).get("name", "")
            login = resolved[sibling]["login"]
            return {"login": login,
                    "reason": (f"name-alias group: shares display name {shared!r} with "
                               f"{sibling}, already resolved to {login}")}
    return None


# ------------------------------------------------ amendment 5: handles + activity

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def parse_codeowners_owners(path: Path) -> list[str]:
    """Distinct owner tokens (@login, @org/team, email) from CODEOWNERS rule lines."""
    try:
        text = path.read_text()
    except OSError as exc:
        die(f"cannot read existing CODEOWNERS: {exc}")
    seen: dict[str, None] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        for tok in stripped.split()[1:]:  # first token is the pattern
            if tok.startswith("#"):       # inline comment: ignore the rest
                break
            if (tok.startswith("@") and len(tok) > 1) or EMAIL_RE.match(tok):
                seen.setdefault(tok, None)
    return list(seen)


def build_handles(gh: Gh, owner_tokens: list[str], repo_slug: str | None) -> dict[str, dict]:
    """Validate each distinct owner handle found in the existing CODEOWNERS."""
    handles: dict[str, dict] = {}
    org = repo_slug.split("/", 1)[0] if repo_slug else None
    for tok in owner_tokens:
        if not tok.startswith("@"):  # bare email: best effort, not validatable
            handles[tok] = {"kind": "user", "valid": None, "permission": "unknown"}
        elif "/" in tok:
            slug = tok[1:].split("/", 1)[1]
            valid = gh.validate_team(org, slug) if org else None
            handles[tok] = {"kind": "team", "valid": valid, "permission": "unknown"}
        else:
            valid, permission = gh.validate(tok[1:], repo_slug)
            handles[tok] = {"kind": "user", "valid": valid, "permission": permission}
    return handles


def check_activity(gh: Gh, logins: list[str], days: int) -> dict[str, bool | None]:
    """Batched GraphQL probe: lowercased login -> had any contributions in the window.

    Chunks of <=25 logins per call; per-login errors (deleted user, mannequin) and
    whole-batch failures degrade to None — never crash.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    uniq: dict[str, str] = {}
    for login in logins:
        uniq.setdefault(login.lower(), login)
    items = sorted(uniq.items())
    active: dict[str, bool | None] = {}
    batches = 0
    for i in range(0, len(items), 25):
        chunk = items[i:i + 25]
        fields = " ".join(
            f'u{j}: user(login: {json.dumps(login)}) '
            f'{{ contributionsCollection(from: "{since}") {{ hasAnyContributions }} }}'
            for j, (_, login) in enumerate(chunk))
        batches += 1
        resp = gh.graphql("query { " + fields + " }")
        rdata = resp.get("data") if isinstance(resp, dict) else None
        if not isinstance(rdata, dict):
            log(f"warn: activity batch {batches} ({len(chunk)} logins) failed; marking unknown")
            active.update((key, None) for key, _ in chunk)
            continue
        for j, (key, _) in enumerate(chunk):
            node = rdata.get(f"u{j}")
            flag = None
            if isinstance(node, dict):
                cc = node.get("contributionsCollection")
                if isinstance(cc, dict) and isinstance(cc.get("hasAnyContributions"), bool):
                    flag = cc["hasAnyContributions"]
            active[key] = flag
    if items:
        log(f"activity check: {len(items)} logins in {batches} GraphQL batch(es)")
    return active


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ownership", required=True, help="path to ownership.json")
    ap.add_argument("--repo", default=".", help="target repo path (default: .)")
    ap.add_argument("--out", default="identities.json",
                    help="output path, '-' for stdout (default: identities.json)")
    ap.add_argument("--config", help="path to .codeowners.toml (default: <repo>/.codeowners.toml)")
    scope = ap.add_mutually_exclusive_group()
    scope.add_argument("--candidates-only", dest="resolve_all", action="store_false",
                       help="only resolve authors in the top 5 of any module or repo totals (default)")
    scope.add_argument("--all", dest="resolve_all", action="store_true",
                       help="resolve every non-bot author")
    ap.set_defaults(resolve_all=False)
    ap.add_argument("--max-commit-lookups", type=int, default=3, metavar="N",
                    help="max commit->login API lookups per cluster (default: 3)")
    ap.add_argument("--no-github", action="store_true", help="skip all gh API usage")
    ap.add_argument("--hostname", help="treat this host as the GitHub (Enterprise) host")
    ap.add_argument("--existing", metavar="PATH",
                    help="existing CODEOWNERS file: validate its owner handles into 'handles'")
    ap.add_argument("--activity-days", type=int, default=30, metavar="N",
                    help="recent-activity window in days for the GraphQL check (default: 30)")
    ap.add_argument("--no-activity-check", action="store_true",
                    help="skip the batched GraphQL recent-activity check")
    args = ap.parse_args()

    repo = Path(args.repo).expanduser()
    if not repo.is_dir():
        die(f"repo path is not a directory: {repo}")

    ownership_path = Path(args.ownership).expanduser()
    try:
        data = json.loads(ownership_path.read_text())
    except OSError as exc:
        die(f"cannot read ownership file: {exc}")
    except json.JSONDecodeError as exc:
        die(f"ownership file is not valid JSON: {exc}")
    if not isinstance(data, dict) or "authors" not in data:
        die(f"{ownership_path} does not look like ownership.json (missing 'authors')")

    config = load_config(args.config, repo)
    identities_cfg = config.get("identities", {})
    if not isinstance(identities_cfg, dict):
        identities_cfg = {}

    host, repo_slug = detect_remote(repo)
    github_host = None
    if host == "github.com" or (args.hostname and host == args.hostname.lower()):
        github_host = args.hostname or "github.com"

    gh = Gh(hostname=github_host or "github.com")
    if github_host and not args.no_github:
        gh.probe()
    elif args.no_github:
        log("note: --no-github; skipping gh API usage")
    elif host is None:
        log("note: no git remote detected; running offline")
    else:
        log(f"note: remote host {host!r} is not GitHub; running offline")

    authors: dict = data.get("authors", {})
    wanted = set(authors) if args.resolve_all else candidate_keys(data) & set(authors)

    # Amendment 1: name_alias_groups are hints that clusters are the same person.
    # Pull whole groups into scope when any member is wanted, and look them up first.
    group_of: dict[str, list[str]] = {}
    for group in data.get("name_alias_groups", []):
        members = [k for k in group if isinstance(k, str) and k in authors]
        if len(members) < 2:
            continue
        if wanted & set(members):
            wanted.update(members)
        for member in members:
            group_of[member] = members

    resolved: dict[str, dict] = {}
    ignored: list[str] = []
    unresolved_keys: list[str] = []
    api_suggestions: dict[str, dict] = {}  # demoted commit-api / PR-correlation evidence
    hits: dict[str, str] = {}  # author-key -> login (pre-validation)
    sources: dict[str, str] = {}

    for key in sorted(wanted, key=lambda k: (k not in group_of, k)):
        cluster = authors[key]
        if cluster.get("is_bot"):
            continue
        # a. config
        if (login := config_lookup(identities_cfg, key, cluster)) is not None:
            if login == "!ignore":
                ignored.append(key)
            else:
                hits[key], sources[key] = login.lstrip("@"), "config"
            continue
        # b. noreply email
        if login := noreply_login(cluster):
            hits[key], sources[key] = login, "noreply"
            continue
        # c. commit -> login API (amendment 4: suggestion-only for shared/role emails),
        #    then PR correlation on the same shas (amendments 2+3: always suggestion-only)
        if gh.available and repo_slug and args.max_commit_lookups > 0:
            shas = cluster.get("recent_shas", [])[: args.max_commit_lookups]
            login = None
            for sha in shas:
                commit, ok, _ = gh.api(f"repos/{repo_slug}/commits/{sha}")
                if ok and isinstance(commit, dict):
                    login = (commit.get("author") or {}).get("login")
                    if login:
                        break
            if login and not cluster.get("suspect_shared"):
                hits[key], sources[key] = login, "commit-api"
                continue
            if login:  # suspect_shared cluster: demote to suggestion (amendment 4)
                api_suggestions[key] = {
                    "login": login,
                    "reason": (f"email is shared by multiple author names; login {login} "
                               "came from GitHub's email match"),
                }
            elif shas:
                if suggestion := pr_correlate(gh, repo_slug, shas):
                    api_suggestions[key] = suggestion
        unresolved_keys.append(key)

    # Validation (deduped inside Gh.validate).
    for key, login in hits.items():
        source = sources[key]
        if gh.available:
            valid, permission = gh.validate(login, repo_slug)
        else:
            valid = True if source == "config" else None
            permission = "unknown"
        resolved[key] = {"login": login, "source": source,
                         "valid": valid, "permission": permission}

    # d. contributor-list suggestions for unresolved clusters.
    contributors: dict[str, str] = {}
    if gh.available and repo_slug and unresolved_keys:
        contributors = fetch_contributors(gh, repo_slug)

    unresolved: list[dict] = []
    for key in unresolved_keys:
        cluster = authors[key]
        entry = {
            "author": key,
            "name": cluster.get("name", ""),
            "emails": cluster.get("emails", []),
            "sample_shas": cluster.get("recent_shas", []),
            "suggestion": (alias_suggestion(key, group_of, resolved, authors)
                           or api_suggestions.get(key)
                           or (suggest_from_contributors(cluster, contributors)
                               if contributors else None)),
            "blocking": blocking_modules(data, key),
        }
        unresolved.append(entry)
    unresolved.sort(key=lambda e: (
        0 if e["blocking"] else 1,
        -max((b["share"] for b in e["blocking"]), default=0.0),
        e["author"],
    ))

    # Amendment 5: validate owner handles from an existing CODEOWNERS file.
    handles: dict[str, dict] | None = None
    if args.existing:
        existing_path = Path(args.existing).expanduser()
        if not existing_path.is_file():
            die(f"existing CODEOWNERS not found: {existing_path}")
        handles = build_handles(gh, parse_codeowners_owners(existing_path), repo_slug)

    # Amendment 5: batched recent-activity probe (GitHub mode only, on by default).
    # Convention: active_recently is OMITTED when the check did not run, and a
    # tri-state true/false/null everywhere it applies when it did.
    activity_ran = gh.available and not args.no_activity_check
    active_map: dict[str, bool | None] = {}
    if activity_ran:
        logins_to_check = [meta["login"] for meta in resolved.values()]
        if handles:
            logins_to_check.extend(
                h[1:] for h, meta in handles.items()
                if meta["kind"] == "user" and h.startswith("@"))
        active_map = check_activity(gh, logins_to_check, args.activity_days)
        for meta in resolved.values():
            meta["active_recently"] = active_map.get(meta["login"].lower())
        for h, meta in (handles or {}).items():
            if meta["kind"] == "user" and h.startswith("@"):
                meta["active_recently"] = active_map.get(h[1:].lower())
            else:
                meta["active_recently"] = None  # teams / bare emails: not checkable

    out_host = host if host else None
    result = {
        "schema": 1,
        "host": github_host or out_host,
        "repo": repo_slug,
        "gh_available": gh.available,
    }
    if activity_ran:
        result["activity_window_days"] = args.activity_days
    result["resolved"] = resolved
    if handles is not None:
        result["handles"] = handles
    result["ignored"] = sorted(ignored)
    result["unresolved"] = unresolved
    payload = json.dumps(result, indent=2) + "\n"
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        out_path = Path(args.out).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload)
        log(f"wrote {args.out}")

    by_source: dict[str, int] = {}
    for meta in resolved.values():
        by_source[meta["source"]] = by_source.get(meta["source"], 0) + 1
    src_txt = ", ".join(f"{s}: {n}" for s, n in sorted(by_source.items())) or "none"
    n_blocking = sum(1 for e in unresolved if e["blocking"])
    log(f"resolved: {len(resolved)} ({src_txt}); ignored: {len(ignored)}; "
        f"unresolved: {len(unresolved)} ({n_blocking} blocking); gh calls: {gh.calls}")
    if handles is not None:
        n_invalid = sum(1 for m in handles.values() if m["valid"] is False)
        n_noaccess = sum(1 for m in handles.values()
                         if m["valid"] is True and m["permission"] in ("none", "read"))
        log(f"handles: {len(handles)} ({n_invalid} invalid, {n_noaccess} no-access)")
    if activity_ran:
        n_act = sum(1 for v in active_map.values() if v is True)
        n_inact = sum(1 for v in active_map.values() if v is False)
        n_unk = sum(1 for v in active_map.values() if v is None)
        log(f"activity: {n_act} active / {n_inact} inactive / {n_unk} unknown "
            f"(window {args.activity_days}d)")


if __name__ == "__main__":
    main()
