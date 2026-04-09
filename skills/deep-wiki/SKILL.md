---
name: deep-wiki
description: Search and read AI-generated documentation for any public GitHub repository. Use when asked about how an open-source library works, its architecture, API, or internals.
---

# DeepWiki Skill

Query AI-generated documentation for any public GitHub repository via [DeepWiki](https://deepwiki.com). Free, no authentication required.

## Available Scripts

All scripts are run from this skill's directory:

```bash
bunx tsx scripts/<script>.ts [args]
```

Repository identifiers use the format `owner/repo` (e.g., `facebook/react`, `golang/go`).

---

### Get Wiki Structure

```bash
bunx tsx scripts/deepwiki-structure.ts <owner/repo>
```

Returns the table of contents / topic tree for a repository's documentation.

**Use when:** You need to discover what documentation exists before diving into specifics.

Examples:
- `bunx tsx scripts/deepwiki-structure.ts facebook/react`
- `bunx tsx scripts/deepwiki-structure.ts vercel/next.js`

---

### Read Full Wiki

```bash
bunx tsx scripts/deepwiki-read.ts <owner/repo>
```

Returns the complete generated documentation for a repository. Output is large (hundreds of KB for major repos).

**Use when:** You need comprehensive documentation about the entire codebase. Prefer `deepwiki-ask.ts` for targeted questions.

Examples:
- `bunx tsx scripts/deepwiki-read.ts facebook/react`
- `bunx tsx scripts/deepwiki-read.ts expressjs/express`

---

### Ask a Question

```bash
bunx tsx scripts/deepwiki-ask.ts <owner/repo> [owner/repo ...] "<question>"
```

Ask a natural-language question about one or more repositories (max 10) and get an AI-powered, context-grounded answer.

**Use when:** You have a specific question and want a direct answer rather than browsing docs. This is the most useful tool for targeted queries.

Examples:
- `bunx tsx scripts/deepwiki-ask.ts expressjs/express "How does middleware error handling work?"`
- `bunx tsx scripts/deepwiki-ask.ts facebook/react "What is the reconciliation algorithm?"`
- `bunx tsx scripts/deepwiki-ask.ts facebook/react vercel/next.js "How do React Server Components work across these projects?"`

---

## Typical Workflow

For **targeted questions** — use `deepwiki-ask.ts` directly. This is the fastest path.

For **exploring unfamiliar repos**:
1. Run `deepwiki-structure.ts` to see available topics
2. Use `deepwiki-ask.ts` with specific questions about topics of interest
3. Use `deepwiki-read.ts` only when you need the full documentation dump

## Limitations

- **Public repositories only** — Private repos require a Devin account and the Devin MCP server
- **Generated documentation** — Content is AI-generated from the repository source; it may not cover every detail
- **GitHub only** — Does not support GitLab, Bitbucket, or other hosts
