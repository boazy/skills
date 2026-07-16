---
name: infer-codeowners
description: Generate or update a CODEOWNERS file for a repository from its git commit history. Detects module boundaries (Cargo crates, Go modules, npm packages, significant submodules), scores contributors with recency weighting, resolves authors to valid GitHub accounts via the GitHub CLI, detects departed/inactive owners, and asks the user only about identities it cannot map. Use when asked to create, infer, deduce, update, refresh, or improve a CODEOWNERS file, or to figure out code ownership / who owns what in a repo.
---

# Infer CODEOWNERS

Deduce and generate a `CODEOWNERS` file for a repository that has none (or has minimal coverage), based on commit history and per-module contribution levels — or **update an existing one**: pick up new modules, ownership shifts, owners who left GitHub or the org, and owners who went inactive.

Three self-contained scripts (run with `uv run`, stdlib only) do the heavy lifting so you never page through raw `git log`:

```
scan_ownership.py    git history -> module boundaries + decay-weighted contributor scores
        |
resolve_identities.py   author identities -> validated GitHub logins (gh CLI)
        |            \-- unresolved identities -> ask the user, record in .codeowners.toml, re-run
emit_codeowners.py   selection policy -> CODEOWNERS + evidence report
```

All scripts are read-only with respect to the target repo. Keep intermediate JSON in a scratch dir (e.g. `/tmp/codeowners-work/`), never inside the repo.

## Prerequisites

- `git`, `uv` (scripts declare PEP 723 metadata; `uv run scripts/<name>.py` just works).
- Optional but strongly recommended for GitHub repos: `gh` CLI, authenticated for the repo's host (`gh auth status`). Without it the skill still works, but identity validation is limited to user-provided mappings and GitHub noreply emails.

## Workflow

### Step 0 — Preflight

1. Check for an existing file: `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`. If one exists with real coverage, **ask the user** whether to *update* it (default — see "Updating an existing CODEOWNERS" below) or regenerate from scratch. Never silently overwrite.
2. Confirm the target is a git repo and note the remote host (`git remote get-url origin`). GitHub (or GHE) remote + working `gh` auth unlocks account validation and commit→login correlation. If `gh auth status` fails, tell the user — do not fight authentication yourself.
3. Ask the user up front if they have known identity mappings or an existing `.codeowners.toml` (see Config below). Providing mappings early avoids a second resolve pass.

### Step 1 — Scan

```bash
uv run scripts/scan_ownership.py --repo <REPO> --out /tmp/codeowners-work/ownership.json
```

Useful knobs:
- `--since 2.years` — cap history on very large/old repos (decay already discounts old work; `--since` just speeds up the scan).
- `--half-life-days 365` — recency decay half-life. Shorten (180) for fast-moving teams, lengthen for stable/mature code.
- `--config <path>` — `.codeowners.toml` (module excludes/extras, bot patterns).

What it does (so you can explain or tune it):
- One pass of `git log --use-mailmap --no-merges --numstat`; lockfiles, vendored and generated dirs are ignored.
- **Modules** = dirs with a package manifest (Cargo `[package]`, `go.mod`, `package.json`, pyproject, pom, gradle). Files under no manifest fall to a root module. A root-level manifest makes the repo one monolithic module — that's where submodule splitting matters most.
- **Divergent submodules**: a subdirectory with substantial activity whose top authors differ markedly from the rest of its module is split into its own module (`split_from` marks the parent). This catches "one crate, two teams" and monolithic npm/Java repos.
- **Scoring**: per author per module, `Σ 0.5^(age/half_life) · log2(1 + lines_touched)` — recency-weighted, log-damped so one giant refactor commit doesn't dominate. Bots are detected and excluded.
- Identities are only auto-merged on unambiguous evidence (same email, `.mailmap`). Same-name clusters are reported as `name_alias_groups` hints — resolution (or the user) settles whether they're one person.

### Step 2 — Resolve identities

```bash
uv run scripts/resolve_identities.py --ownership /tmp/codeowners-work/ownership.json \
    --repo <REPO> --out /tmp/codeowners-work/identities.json [--config <path>]
```

Resolution order per author: user config → GitHub noreply email (`ID+login@users.noreply.github.com`) → GitHub commit→login API (`gh api repos/…/commits/<sha>`, GitHub matches the email server-side). When those fail, weaker evidence is gathered as *suggestions* that only the user can confirm: PR correlation (`gh api repos/…/commits/<sha>/pulls` — the PR author, cited with PR numbers; maintainers sometimes land other people's commits, so this is never auto-accepted) and contributor-list similarity (a repo contributor login matching the email local-part or name). Resolved logins are validated (`gh api users/<login>`) and checked for repo permission where possible. By default only plausible owner candidates are resolved (`--candidates-only`) to keep API usage small.

**Then read the `unresolved` list.** Each entry says which modules it would affect (`blocking`) and may carry a `suggestion`:

- If there are **blocking** unresolved identities, ask the user — present name, emails, sample commit SHAs, and the suggestion if any. Batch all questions into one prompt; don't drip-feed.
- Record the answers in `.codeowners.toml` under `[identities]` (email → login, or `"!ignore"` for shared/CI identities), then **re-run resolve**. This makes the mapping durable for future regenerations — offer to commit the file.
- Non-blocking unresolved identities can be ignored; mention them once.

Multiple emails mapping to the same login are proof of one person — emit aggregates their scores automatically.

Resolve also runs an **activity check** by default (GitHub mode): one batched GraphQL query per ~25 logins asks whether each candidate owner had *any* GitHub contributions in the last `--activity-days` (default 30, visibility follows your gh token). The result (`active_recently`) drives the inactivity notices in Step 3. Disable with `--no-activity-check`.

Runtime: gh calls are serial (~0.5–1 s each); a large repo with dozens of candidate identities takes a few minutes. Run it in the background and do other work.

### Step 3 — Emit

```bash
uv run scripts/emit_codeowners.py --ownership /tmp/codeowners-work/ownership.json \
    --identities /tmp/codeowners-work/identities.json \
    --out /tmp/codeowners-work/CODEOWNERS --report /tmp/codeowners-work/report.md
```

Selection policy (config `[selection]` or flags):
- An owner must map to a **valid account with repo write access** (permission `admin`/`maintain`/`write`/`push`). Accounts with `none`/`read`/`pull`/`triage` (typically stale accounts from an org migration, or departed contributors) are excluded automatically and listed in the report — map them to the person's current account, or `"!ignore"` them, in `[identities]`. Accounts whose access could not be verified (offline mode, no permission to query, or an unrecognized custom role) stay eligible but are flagged under "Unverified repo access" in the report — validate those after pushing (Step 4.4).
- Top eligible contributor always owns; more are added while their score ≥ `min_share_ratio` (default 0.33) of the top score, up to `max_owners` (default 3). This is the "multiple owners, but not too many" balance — raise the ratio or lower the cap if the user wants stricter ownership.
- Contributors inactive in a module for > `inactive_months` (default 18) are skipped when an active alternative exists; a module whose *only* candidates are inactive is kept but flagged as a **bus-factor risk** in the report.
- Modules with no eligible owner inherit from the nearest ancestor rule, then `default_owners`.
- Rules identical to what already applies from a parent rule are suppressed — the file stays small.
- A `*` fallback rule is derived from repo-wide totals.
- `[overrides]` config entries replace the tool's selection for their path — the user's explicit decision, emitted verbatim inside the managed block. (File-level precedence still applies: a hand-written rule that comes *after* the managed block can shadow any generated rule, overrides included — such shadowing is flagged as a precedence conflict in the report.)

Generated rules are wrapped between two exact marker lines:

```
# >>> infer-codeowners: managed rules (regenerate instead of editing) <<<
# >>> infer-codeowners: end managed rules <<<
```

Leave them in place — they are what makes future updates safe and surgical.

**Inactivity notices** (automatic when the activity check ran): owners with no GitHub activity in the window are listed in the report; they are *not* removed from rules. When **all** owners of a module (or of the `*` rule) are inactive, the report lists up to 3 active alternatives (next-ranked eligible contributors with their shares) — **offer these to the user**, and record accepted ones under `[overrides]` in `.codeowners.toml` so they survive regeneration.

### Step 4 — Review and deliver

1. Read `report.md` yourself; sanity-check a few modules against your knowledge of the repo. Present the user the proposed CODEOWNERS **with the evidence table** (owners + score shares), not just the file.
2. Highlight: bus-factor flags, modules that fell back to inherited/default owners, and team suggestions (recurring owner sets that might deserve a GitHub team — creating teams is the user's call; once a team exists, map it in `[teams]` and re-emit to fold members into the handle).
3. On approval, write to `.github/CODEOWNERS` (preferred location). Offer to also commit `.codeowners.toml` so regeneration stays cheap.
4. If the branch is pushed to GitHub, validate with `gh api repos/<owner>/<repo>/codeowners/errors` — GitHub reports unknown owners and syntax problems per line.

## Updating an existing CODEOWNERS

Same pipeline, two extra flags. Run scan as usual, then:

```bash
uv run scripts/resolve_identities.py --ownership .../ownership.json --repo <REPO> \
    --existing <path-to-CODEOWNERS> --out .../identities.json
uv run scripts/emit_codeowners.py --ownership .../ownership.json --identities .../identities.json \
    --existing <path-to-CODEOWNERS> --out .../CODEOWNERS.new --report .../report.md
```

What this adds:
- **Owner health for the whole existing file**: resolve validates every `@handle` already in it — deleted GitHub accounts (`valid: false`), accounts that lost repo access, and inactive owners are all flagged in the report. This is how departed employees are caught even when they don't appear in recent history.
- **New modules and ownership shifts** are picked up by the normal scan/selection, and the report gains a `## Changes vs existing CODEOWNERS` section: added / changed (per-owner reasons: "no longer available on GitHub", "lost repo access", "no longer meets selection", "share now X%") / possibly-stale rules / precedence conflicts.

Merge semantics — CODEOWNERS is last-match-wins, so the tool never moves, reorders, or deletes a rule it did not author:
- File previously generated by this skill (has the managed markers): the marked block is regenerated in place; everything outside it is preserved byte-for-byte. Hand-written rules stay exactly where they were.
- Hand-written file (no markers): the file is preserved verbatim and a managed block is **appended** covering new module paths; generated rules whose exact pattern already exists become **proposals in the report only**. Present the proposals and the precedence warning to the user. Only with explicit user consent, re-run with `--adopt-exact` to also replace owners in-place on exact-pattern matches.
- Never hand-merge rule changes yourself; the scripts own the merge. Your job is presenting the change report and collecting decisions.

## Config reference — `.codeowners.toml`

Lives in the repo root (auto-discovered) or passed via `--config`. All sections optional.

```toml
[identities]                      # email or exact author name -> GitHub login
"jane@corp.com" = "janedoe"
"Old Bob" = "bob-gh"
"ci@corp.com" = "!ignore"         # never an owner (shared/CI identities)

[bots]
patterns = ["^buildkite"]         # extra bot regexes (matched on name and email)

[selection]
max_owners = 3
min_share_ratio = 0.33
min_commits = 3
half_life_days = 365
inactive_months = 18
default_owners = ["@org/platform-team"]

[teams]                           # fold individual owners into a team handle
"@org/backend" = ["alice", "bob", "carol"]

[modules]
extra = ["docs", "infra/terraform"]  # force extra module boundaries
exclude = ["experiments/*"]          # fnmatch; dropped modules fall through to parent
no_split = ["rust/megacrate"]        # never split submodules out of these

[overrides]                          # verbatim owners per module path; replaces selection
"rust/foo" = ["@alice", "@org/team"] # used to accept alternatives for all-inactive modules
```

## Caveats

- **CODEOWNERS is last-match-wins** — the scripts order rules general→specific; preserve that order if you hand-edit.
- Team handles (`@org/team`) require the team to exist and have repo access; the scripts never create teams.
- GitLab/Bitbucket accept nearly the same syntax; the generation pipeline works for them too (run resolve with `--no-github` and rely on `[identities]` mappings), but account validation is GitHub-only.
- Squash-merged repos attribute everything to the PR author — usually what you want for ownership.
- History rewrites, `--since` limits, and shallow clones (`git fetch --unshallow` first!) all skew scores; prefer full history when feasible.
