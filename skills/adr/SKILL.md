---
name: adr
description: Manage Architecture Decision Records (ADRs) in Confluence — create new ADRs from template, update existing ones, generate status reports, sync status emojis, and review ADRs for quality. Use when ADR, architecture decision, or design record is mentioned.
---

# ADR Skill

Manage Architecture Decision Records (ADRs) stored in Confluence. This skill covers the full ADR lifecycle: creation, updates, status reporting, emoji sync, and architectural review.

**Requires**: The `atlassian` skill must be loaded alongside this skill for Confluence CRUD operations.

## Key Facts

| Key | Value |
|-----|-------|
| Confluence Space | `CE` (Engineering) |
| ADRs Parent Page ID | `31859277900` |
| Title Format | `ADR-NNN: Short Descriptive Title` |
| Numbering | Sequential from highest existing number + 1 |
| Default Status | `Draft` |
| Page Emoji | Set via `emoji-title-published` and `emoji-title-draft` properties |

### Status Types and Emojis

| Status | Emoji | Confluence Code Point |
|--------|-------|-----------------------|
| Accepted / Approved | ✅ | `2705` |
| Proposal / Proposed / Pending Approval | ⏳ | `23f3` |
| Draft | 🗒️ | `1f5d2` |
| Withdrawn / Rejected | 🚫 | `1f6ab` |
| Postponed | ✋ | `270b` |

If the status is unclear or non-standard, do **not** set an emoji.

---

## 1. Create New ADR

This is the primary purpose of this skill. Follow these steps exactly.

### Step 1: Determine the next ADR number

Search existing ADRs and find the highest number:

```bash
npx tsx scripts/confluence-search.ts "space = CE AND type = page AND ancestor = 31859277900" 50
```

Parse the results, extract all `ADR-NNN` numbers from titles, and use `max + 1`.

### Step 2: Gather information from the user

Collect these details (ask for anything not provided):

- **Title**: Short, descriptive name for the decision
- **Status**: Default to `Draft` unless specified
- **Affects**: Which teams/systems/components are affected
- **Related Tickets**: Jira tickets (or `N/A`)
- **Related ADRs**: Links to related ADRs (or `N/A`)
- **Replaces ADR / Updates ADR**: If this supersedes or amends an existing ADR (or `N/A`)

Then gather the content for the body sections (see "ADR Structure" below).

### Step 3: Build the HTML body

Use the template below. Replace all `{{PLACEHOLDERS}}` with actual content. Preserve the exact HTML structure — the card table styling must match existing ADRs.

### Step 4: Create the page

```bash
npx tsx scripts/confluence-create.ts '{"space": "CE", "title": "ADR-NNN: Title Here", "body": "<HTML_BODY>", "parentId": "31859277900"}'
```

### Step 5: Set the page emoji

```bash
npx tsx scripts/confluence-properties.ts <pageId> set-emoji "<CODE_POINT>"
```

Use the code point from the Status/Emoji table above (e.g., `1f5d2` for Draft).

---

## ADR Structure

Every ADR follows a consistent structure defined in ADR-000. The structure has two parts: the **card table** (metadata) and the **body sections** (content).

### Required Sections

Based on ADR-000 guidelines, these sections are **required at minimum**:

1. **Abstract** — A concise summary (1-2 paragraphs) of the decision. AI may be used to write this after the other sections are complete.
2. **Motivation** — Why this decision is needed. What problem are we solving? Include background context.
3. **Goals** — What we want to achieve. Use bullet points with RFC-style language (MUST, SHOULD, MAY). Include a **Non-goals** subsection if applicable.
4. **Proposal** — The actual decision or design. This is the core of the ADR.
5. **Sign-offs** — Stakeholder approval table (always present, even if empty).

### Optional Sections (include when relevant)

- **Alternatives** — Other options considered, each with Pros/Cons. See ADR-100 for a thorough example.
- **Prior Art** — Links and references to similar decisions in open-source or industry.
- **Benefits** — Explicit enumeration of benefits.
- **Trade-offs** — Known compromises and their implications.
- **End Notes** — Footnotes or clarifications.

### Good Examples to Follow

- **ADR-000** (page `31859277877`): Founding document, defines the ADR process itself
- **ADR-100** (page `31858065546`): Highly detailed with thorough alternatives analysis (Pros/Cons/Conclusion per alternative)
- **ADR-102** (page `31869075458`): Concise, well-structured, good for typical decisions
- **ADR-108** (page `31915343873`): Concise with clean hierarchy and organizational context

### Writing Guidelines

- Use clear, direct language. Avoid jargon without explanation.
- Use RFC 2119 keywords (MUST, SHOULD, MAY, etc.) for requirements.
- Include code examples in `<ac:structured-macro ac:name="code">` blocks when relevant.
- Bullet lists for requirements, numbered lists for sequential steps.
- Every ADR should be self-contained — a reader shouldn't need to read other docs to understand the decision.

---

## HTML Template

Below is the complete HTML template for a new ADR page body. Copy this exactly and replace `{{PLACEHOLDERS}}`.

**IMPORTANT**: When passing this as JSON to `confluence-create.ts`, the HTML must be a single string (escape internal quotes, no unescaped newlines in the JSON value).

```html
<table data-table-width="760" data-layout="default"><colgroup><col style="width: 161.0px;" /><col style="width: 596.0px;" /></colgroup><tbody><tr><td data-highlight-colour="#4c9aff" colspan="2"><h2 style="text-align: center;"><span style="color: rgb(255,255,255);">Architecture Design Record Card</span></h2></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">ID</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{ADR_ID}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Created at</span></strong></p></td><td data-highlight-colour="#deebff"><p><time datetime="{{CREATED_DATE}}" /> </p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Accepted at</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{ACCEPTED_DATE}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Status</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{STATUS}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Affects</span></strong></p></td><td data-highlight-colour="#deebff">{{AFFECTS}}</td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Replaces ADR</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{REPLACES_ADR}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Updates ADR</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{UPDATES_ADR}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Related Tickets</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{RELATED_TICKETS}}</p></td></tr><tr><td data-highlight-colour="#b3d4ff"><p><strong><span style="color: rgb(0,141,166);">Related ADRs</span></strong></p></td><td data-highlight-colour="#deebff"><p>{{RELATED_ADRS}}</p></td></tr></tbody></table>
<h1>Abstract</h1>
<p>{{ABSTRACT}}</p>
<h1>Motivation</h1>
{{MOTIVATION_HTML}}
<h1>Goals</h1>
{{GOALS_HTML}}
<h1>Proposal</h1>
{{PROPOSAL_HTML}}
<h1>Alternatives</h1>
{{ALTERNATIVES_HTML}}
<h1>Sign-offs</h1>
<table data-table-width="760" data-layout="default"><colgroup><col style="width: 359.0px;" /><col style="width: 399.0px;" /></colgroup><tbody><tr><th><p><strong>Stakeholder</strong></p></th><th><p><strong>Signature Date / Comments</strong></p></th></tr><tr><td><p> </p></td><td><p> </p></td></tr><tr><td><p> </p></td><td><p> </p></td></tr><tr><td><p> </p></td><td><p> </p></td></tr></tbody></table>
```

### Template Field Notes

| Placeholder | Format | Example |
|-------------|--------|---------|
| `{{ADR_ID}}` | `ADR-NNN` | `ADR-149` |
| `{{CREATED_DATE}}` | `YYYY-MM-DD` | `2026-02-27` |
| `{{ACCEPTED_DATE}}` | `<time>` tag or empty | ` ` (space if not yet accepted) |
| `{{STATUS}}` | One of the standard statuses | `Draft` |
| `{{AFFECTS}}` | `<ul><li><p>Item</p></li>...</ul>` or `<p>Team Name</p>` | `<ul><li><p>Phoenix Sensor</p></li></ul>` |
| `{{REPLACES_ADR}}` | ADR link or `N/A` | `N/A` |
| `{{UPDATES_ADR}}` | ADR link or `N/A` | `N/A` |
| `{{RELATED_TICKETS}}` | Jira keys or `N/A` | `PHOE-1234` |
| `{{RELATED_ADRS}}` | ADR links or `N/A` | `N/A` |

For body sections (`{{MOTIVATION_HTML}}`, `{{GOALS_HTML}}`, etc.), generate valid Confluence storage-format HTML:
- Paragraphs: `<p>text</p>`
- Bullet lists: `<ul><li><p>item</p></li></ul>`
- Numbered lists: `<ol start="1"><li><p>item</p></li></ol>`
- Sub-headings: `<h2>Subtitle</h2>`, `<h3>Sub-subtitle</h3>`
- Code blocks: `<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">rust</ac:parameter><ac:plain-text-body><![CDATA[code here]]></ac:plain-text-body></ac:structured-macro>`
- Bold: `<strong>text</strong>`
- Italic: `<em>text</em>`
- Links: `<a href="URL">text</a>`

---

## 2. Update ADR

### Workflow

1. **Fetch the existing ADR**:
   ```bash
   npx tsx scripts/confluence-get.ts <pageId>
   ```

2. **Parse the HTML body** and identify the section(s) to modify.

3. **Apply changes** to the HTML body. Preserve the card table structure exactly. Only modify the fields or sections that need updating.

4. **Update the page**:
   ```bash
   npx tsx scripts/confluence-update.ts <pageId> '{"body": "<UPDATED_HTML>"}'
   ```

5. **If the status changed**, update the page emoji:
   ```bash
   npx tsx scripts/confluence-properties.ts <pageId> set-emoji "<CODE_POINT>"
   ```

### Common Update Scenarios

- **Status change** (e.g., Draft → Accepted): Update the Status cell in the card table AND the `Accepted at` date. Then sync the emoji.
- **Content revision**: Modify the relevant body section. Don't touch unrelated sections.
- **Adding sign-offs**: Add rows to the Sign-offs table.

---

## 3. ADR Status Report

Generate a report of all ADRs and their current status.

### Using the script (saves tokens)

```bash
# Markdown format (default)
npx tsx scripts/adr-report.ts

# JSON format
npx tsx scripts/adr-report.ts json
```

Run from: `@path scripts/adr-report.ts` (relative to this skill's directory)

The script:
1. Fetches all child pages of the ADRs parent page in the CE space
2. Parses each page's status from the ADR card table in the HTML body
3. Outputs a formatted report with status, emoji, and last-modified date
4. Includes a summary count by status and the next available ADR number

---

## 4. Sync ADR Emojis

Iterate through all ADRs and update their Confluence page emoji to match their status.

### Using the script (saves tokens)

```bash
# Preview what would change
npx tsx scripts/adr-sync-emojis.ts --dry-run

# Actually sync emojis
npx tsx scripts/adr-sync-emojis.ts
```

Run from: `@path scripts/adr-sync-emojis.ts` (relative to this skill's directory)

The script:
1. Fetches all ADR pages with their HTML bodies
2. Extracts the status from each ADR's card table
3. Maps the status to the correct emoji code point
4. Sets both `emoji-title-published` and `emoji-title-draft` page properties
5. Skips pages with non-standard or unrecognizable statuses

**Always run `--dry-run` first** to verify the mapping looks correct.

---

## 5. Review ADR

Fetch an ADR and start a sub-agent review for architectural quality.

### Workflow

1. **Fetch the ADR content**:
   ```bash
   npx tsx scripts/confluence-get.ts <pageId>
   ```

2. **Delegate to a review sub-agent** using `task()` with the following prompt structure:

```
task(
  category="ultrabrain",
  load_skills=[],
  description="Review ADR-NNN: <title>",
  prompt="""
You are a senior principal architect conducting a formal review of an Architecture Decision Record (ADR).

## Your Role
You are an expert reviewer who must evaluate this ADR for technical soundness, completeness, clarity, and alignment with best practices. You have deep experience in distributed systems, security, and software architecture.

## ADR Content
<paste the full ADR body text here, converted from HTML to readable text>

## Review Criteria

Evaluate the ADR on each of these dimensions:

### 1. Problem Statement & Motivation
- Is the problem clearly defined?
- Is the motivation compelling and well-articulated?
- Are the goals and non-goals appropriate and complete?

### 2. Proposed Solution
- Is the proposal technically sound?
- Are there ambiguities or underspecified areas?
- Are edge cases addressed?
- Is the level of detail appropriate for an architecture decision?

### 3. Alternatives Analysis
- Were reasonable alternatives considered?
- Are pros/cons balanced and fair?
- Is the rationale for the chosen approach convincing?

### 4. Completeness
- Are all affected systems/teams identified?
- Are trade-offs explicitly acknowledged?
- Are there missing sections that should be included?
- Is the sign-off table appropriate for the scope of the decision?

### 5. Clarity & Communication
- Could a new team member understand this decision?
- Is RFC 2119 language (MUST, SHOULD, MAY) used correctly?
- Are terms defined or linked?

### 6. Risk Assessment
- Are there security implications not addressed?
- Are there scalability concerns?
- Are there operational/maintenance concerns?
- What could go wrong with this decision in 2-3 years?

## Output Format

Provide your review as:

1. **Overall Assessment**: One of: ✅ Approve, ⚠️ Approve with Comments, 🔄 Request Changes, ❌ Reject
2. **Summary**: 2-3 sentence overall impression
3. **Strengths**: What's done well (bullet points)
4. **Issues**: Problems found, categorized as:
   - 🔴 **Critical**: Must be addressed before acceptance
   - 🟡 **Important**: Should be addressed
   - 🔵 **Minor**: Nice to have improvements
5. **Questions**: Open questions for the authors
6. **Suggestions**: Specific improvement recommendations
"""
)
```

3. **Return the review** to the user.
