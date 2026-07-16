# Data contract between the infer-codeowners scripts

Read this only when you need to post-process the intermediate JSON yourself
(custom analyses, merging with external org data) or when maintaining the scripts.

## `ownership.json` (scan_ownership.py → resolve_identities.py, emit_codeowners.py)

```jsonc
{
  "schema": 1,
  "repo_root": "/abs/path",
  "generated_at": "2026-07-16T00:00:00Z",
  "head": "<HEAD sha>",
  "params": {"half_life_days": 365.0, "since": null, "top": 10},

  // Identity clusters. Union is EMAIL-ONLY (plus .mailmap, applied by git).
  // Key ("author-key") = lowercased most-frequent email of the cluster,
  // or "name:<normalized name>" when the cluster has no email.
  "authors": {
    "<author-key>": {
      "name": "Best Display Name",
      "names": ["Best Display Name", "alias"],
      "emails": ["a@x.com", "b@y.com"],
      "commits": 123,
      "first_commit": "ISO", "last_commit": "ISO",
      "is_bot": false,
      "suspect_shared": true,        // optional: one email, >=3 disjoint display names (shared CI/role identity)
      "recent_shas": ["newest", "...", "..."]   // up to 3, for commit->login lookups
    }
  },

  // Clusters sharing a normalized display name — likely the same person,
  // but NEVER auto-merged (two John Smiths exist). Hints for resolution.
  "name_alias_groups": [["<key1>", "<key2>"]],

  "repo_totals": {"commits": 999, "owners_ranked": [/* OwnerEntry */]},

  "modules": [
    {
      "path": "rust/foo",            // repo-relative POSIX; "" = root leftovers (kind "root") or a root manifest
      "kind": "cargo|go|npm|python|maven|gradle|dir|root",
      "name": "foo",
      "split_from": "rust",          // non-null when carved out as a divergent submodule
      "files": 42,                   // HEAD files owned by this module (excluding child modules)
      "commits": 310,
      "last_commit": "ISO",
      "owners_ranked": [/* OwnerEntry, top `params.top`, score desc, bots excluded */]
    }
  ]
}
```

`OwnerEntry = {"author": "<author-key>", "score": 12.3456, "share": 0.45, "commits": 40, "lines": 1234, "last_commit": "ISO"}`

- `score = Σ over commits of 0.5^(age_days/half_life) · log2(1 + lines_touched)` — recency-weighted, log-damped.
- `share` = score / sum of all human scores in that module (not just top-N).

## `identities.json` (resolve_identities.py → emit_codeowners.py)

```jsonc
{
  "schema": 1,
  "host": "github.com",              // or GHE hostname; null when the remote is not GitHub
  "repo": "owner/name",              // null when unknown
  "gh_available": true,
  "activity_window_days": 30,        // present iff the GraphQL activity check ran
  "resolved": {
    "<author-key>": {
      "login": "janedoe",
      "source": "config|noreply|commit-api|guess-confirmed",
      "valid": true,                 // false = login 404s; null = could not verify (offline)
      "permission": "admin|write|read|none|unknown",
      "active_recently": true        // tri-state; key omitted when the check did not run
    }
  },
  // Present iff resolve ran with --existing: every distinct owner handle found in
  // the existing CODEOWNERS file, validated.
  "handles": {
    "@somelogin": {"kind": "user", "valid": true,  "permission": "write",   "active_recently": false},
    "@org/team":  {"kind": "team", "valid": null,  "permission": "unknown", "active_recently": null}
  },
  "ignored": ["<author-key>"],       // mapped to "!ignore" in config
  "unresolved": [
    {
      "author": "<author-key>", "name": "...", "emails": ["..."], "sample_shas": ["..."],
      "suggestion": {"login": "maybe", "reason": "PR author of #123, #130 (2/3 sampled commits)"},
      "blocking": [{"module": "rust/foo", "rank": 1, "share": 0.61}]  // top-3 appearances
    }
  ]
}
```

Trust levels:
- **Confirmed** (may appear in `resolved`): user config, GitHub noreply email (issued per-account),
  GitHub's own commit→account email match (`commit-api`).
- **Suggestion only** (never auto-accepted): PR-author correlation (maintainers land other
  people's commits), contributor-list similarity, name-alias-group siblings, and commit-api
  results for `suspect_shared` clusters.

Emit-side rules that follow from this file:
- Only `resolved` entries with `valid != false` and permission in the allow-list
  `{admin, maintain, write, push}` are eligible owners (CODEOWNERS requires write access).
  `{none, read, pull, triage}` are excluded; `unknown` or unrecognized (custom-role) values
  stay eligible but are reported as "unverified repo access".
- Two author-keys resolving to the same login are the same person: their OwnerEntries are
  aggregated (scores summed) before selection.
- `active_recently: false` marks an owner inactive (no visible GitHub contributions in the
  window) — reported, never auto-removed; `null` means unknown and is never flagged.
- `handles` drives owner-health reporting for rules in an existing CODEOWNERS that the
  generator did not author (update mode).

## Update mode (emit `--existing`)

Generated rules always live inside managed marker comments. Update semantics (last-match-wins
safety — never move, reorder, or delete a rule the tool did not author):
- Managed block present → its content is regenerated in place; all other bytes preserved.
- No markers (hand-written file) → file preserved verbatim + managed block appended for
  uncovered paths; exact-pattern collisions become report-only proposals unless the user
  opts into `--adopt-exact` (in-place owner replacement, position kept).
