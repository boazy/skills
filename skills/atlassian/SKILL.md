---
name: atlassian
description: Interact with Jira and Confluence via REST API - search, create, update issues and pages
---

# Atlassian Skill

Access Jira and Confluence directly via REST APIs. This skill provides full CRUD operations for issues and pages without requiring the MCP server.

## Authentication

Requires environment variables in `~/.local/secrets/atlassian.env`:
- `ATLASSIAN_SITE` - Your Atlassian site (e.g., `yourcompany.atlassian.net`)
- `ATLASSIAN_EMAIL` - Your Atlassian account email
- `ATLASSIAN_API_TOKEN` - API token from https://id.atlassian.com/manage-profile/security/api-tokens

## Available Scripts

### Jira

#### Search Issues
```bash
bunx tsx scripts/jira-search.ts "<JQL query>" [maxResults] [nextPageToken]
```
Examples:
- `bunx tsx scripts/jira-search.ts "assignee = currentUser() AND status != Done"`
- `bunx tsx scripts/jira-search.ts "project = PROJ AND type = Bug" 50`
- `bunx tsx scripts/jira-search.ts "project = PROJ" 50 "token..."` (pagination)

See `docs/jql-guide.md` for JQL syntax reference.

#### Get Issue Details
```bash
bunx tsx scripts/jira-get.ts <issueKey>
```
Example: `bunx tsx scripts/jira-get.ts PROJ-123`

#### Create Issue
```bash
bunx tsx scripts/jira-create.ts '<JSON>'
```
Single issue:
```bash
bunx tsx scripts/jira-create.ts '{"project": "PROJ", "type": "Story", "summary": "New feature", "description": "Details here"}'
```

Bulk create (array):
```bash
bunx tsx scripts/jira-create.ts '[{"project": "PROJ", "type": "Bug", "summary": "Bug 1"}, {"project": "PROJ", "type": "Bug", "summary": "Bug 2"}]'
```

#### Update Issue
```bash
bunx tsx scripts/jira-update.ts <issueKey> '<JSON updates>'
```
Example: `bunx tsx scripts/jira-update.ts PROJ-123 '{"status": "In Progress", "assignee": "user@example.com"}'`

Description payloads accept `descriptionFormat`:

- `"markdown"` is the default. `description` must be a string and the scripts
  convert it to ADF.
- `"adf"` sends a version-1 ADF document as `description` without conversion.
  Use it for complex structures such as nested lists, panels, and inline cards.

Both `jira-create.ts` and `jira-update.ts` support the field. For a non-trivial
ADF payload, write the JSON to a file:

```json
{
  "descriptionFormat": "adf",
  "description": {
    "type": "doc",
    "version": 1,
    "content": []
  }
}
```

```bash
bunx tsx scripts/jira-update.ts PROJ-123 @/tmp/issue-update.json
```

Jira replaces the whole description document on update; it does not patch
individual ADF nodes. Read the issue first, transform the affected nodes
locally, then send the complete `description` document in the update payload.
Never replace the document with a partial ADF fragment.

#### Jira Description Lists

Use Markdown only for flat lists. For a numbered list with nested bullets, use
`descriptionFormat: "adf"` with `jira-create.ts` or `jira-update.ts`. The
Markdown converter can emit a series of one-item `orderedList` nodes followed
by sibling `bulletList` nodes. Jira renders every ordered-list node as `1.` and
does not indent the sibling bullets.

For an existing issue, use `jira-get.ts` to read the current document,
transform the required nodes locally, and send the complete ADF document through
`jira-update.ts`. Jira does not support a partial-node description update.

```json
{
  "type": "orderedList",
  "attrs": { "order": 1 },
  "content": [
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Derive signing keys." }]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [{ "type": "text", "text": "Derive from the master key." }]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "listItem",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Add key discovery." }]
        }
      ]
    }
  ]
}
```

The invariants are:

- One logical numbered sequence is one `orderedList` node with every top-level
  item in its `content` array. Do not create one `orderedList` per item.
- A subordinate `bulletList` is a child of its parent `listItem`, after that
  item's paragraph. Do not place it beside the `orderedList` as a top-level
  sibling.
- Read the issue back after updating it. Confirm the sequence is one ordered
  list with the expected item count and that each subordinate bullet list is
  nested under its parent item.

#### Comments
```bash
# Get comments
bunx tsx scripts/jira-comment.ts <issueKey> get

# Add comment - inline markdown
bunx tsx scripts/jira-comment.ts <issueKey> add "<markdown text>"

# Add comment - read markdown from a file
bunx tsx scripts/jira-comment.ts <issueKey> add -f <path>

# Add comment - read markdown from stdin (pipe-friendly)
cat notes.md | bunx tsx scripts/jira-comment.ts <issueKey> add --stdin
```

Comment bodies support full markdown via the same converter used for issue
descriptions: headings, bold/italic/strike/underline/inline-code, bullet/
ordered/task lists, fenced code blocks (with language), tables, blockquotes,
GitHub-style alerts (`> [!NOTE]` etc.), `<details>` expand blocks, footnotes,
and links.

For long or multi-line comment bodies, prefer `-f <path>` or `--stdin` over
inline arguments to avoid shell argument-length limits and quoting issues.

#### Resolve Field Names / IDs

```bash
bunx tsx scripts/jira-fields.ts [filter]
```
Examples:
- `bunx tsx scripts/jira-fields.ts` (list every field)
- `bunx tsx scripts/jira-fields.ts "story points"` (find a field by name)
- `bunx tsx scripts/jira-fields.ts customfield_10023` (resolve an ID back to its name)

Returns JSON: `{ count, fields: [{ id, name, custom, type, customType }] }`.

**Custom field ID rule (MANDATORY):** Jira custom field IDs (e.g.
`customfield_10023`) are **instance-specific** — the same ID maps to different
fields on different Jira sites, and an unexplained ID is unverifiable by anyone
reading your output. Therefore:

1. **Never hardcode or copy a `customfield_*` ID without first resolving its
   name** for the current instance via `jira-fields.ts`.
2. When you set custom fields on an issue, **include an ID → name mapping table**
   in your response so the user can confirm each field is correct (e.g.
   `customfield_10023 → "Story Points"`).
3. If you are unsure which ID corresponds to a field name the user mentioned,
   resolve it first (`jira-fields.ts "<name>"`) instead of guessing.

#### Upload Attachment
```bash
bunx tsx scripts/jira-attachment.ts <issueKey> <filePath> [fileName]
```
Examples:
- `bunx tsx scripts/jira-attachment.ts PROJ-123 ./diagram.png`
- `bunx tsx scripts/jira-attachment.ts PROJ-123 ./image.png architecture.png`

Image embedding note:
- For markdown image syntax (`![alt](url)`), the converter uses `mediaSingle` only for Atlassian-hosted URLs.
- External image URLs fall back to a clickable link to avoid Jira `INVALID_INPUT` errors.
- If you want embedded images, upload the file first with `jira-attachment.ts`, then use the returned Atlassian `contentUrl` in your markdown image URL.

### Confluence

#### Personal Space

When the user asks to work with their **personal space** (e.g., "write a page in my personal space", "search my personal space", "read a page from my space"), you MUST first discover their personal space before performing the requested operation.

**Auto-detection rule**: Any mention of "my space", "my personal space", "personal space", or "my Confluence space" means the user's personal Confluence space. Always run the discovery script first to get the space key and ID, then use those values in subsequent operations (create, search, get, etc.).

##### Discover Personal Space
```bash
bunx tsx scripts/confluence-personal-space.ts
```
No arguments needed. Returns the current user's personal space key, ID, name, and URL.

Example output:
```json
{
  "accountId": "5b10a2844c20165700ede21g",
  "displayName": "Jane Smith",
  "space": {
    "id": 98304,
    "key": "~5b10a2844c20165700ede21g",
    "name": "Jane Smith",
    "type": "personal",
    "status": "current",
    "url": "https://yourcompany.atlassian.net/wiki/spaces/~5b10a2844c20165700ede21g"
  }
}
```

Then use the returned `space.key` as the space key for other Confluence operations. For example:
- **Create page**: `bunx tsx scripts/confluence-create.ts '{"space": "~5b10a2844c20165700ede21g", "title": "My Notes", "body": "<p>Content</p>"}'`
- **Search pages**: `bunx tsx scripts/confluence-search.ts "space = ~5b10a2844c20165700ede21g AND type = page"`
- **Get page by title**: `bunx tsx scripts/confluence-get.ts "My Notes" ~5b10a2844c20165700ede21g`

Note: Personal space keys on Confluence Cloud use the format `~accountId` (not `~username`). The discovery script handles this automatically.

#### Search Pages
```bash
bunx tsx scripts/confluence-search.ts "<CQL query>" [maxResults]
```
Examples:
- `bunx tsx scripts/confluence-search.ts "title ~ 'Roadmap'"`
- `bunx tsx scripts/confluence-search.ts "space = DEV AND type = page" 25`

See `docs/cql-guide.md` for CQL syntax reference.

#### Get Page Content
```bash
bunx tsx scripts/confluence-get.ts <pageId>
# or by title
bunx tsx scripts/confluence-get.ts "<page title>" <spaceKey>
```

#### Create Page
```bash
bunx tsx scripts/confluence-create.ts '<JSON>'
```
Example:
```bash
bunx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "New Page", "body": "<p>Content here</p>"}'
```

Optional parent page:
```bash
bunx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "Child Page", "body": "<p>Content</p>", "parentId": "123456"}'
```

#### Update Page
```bash
bunx tsx scripts/confluence-update.ts <pageId> '<JSON updates>'
```
Example: `bunx tsx scripts/confluence-update.ts 123456 '{"title": "Updated Title", "body": "<p>New content</p>"}'`

#### Page Properties (v2)

```bash
# List properties
bunx tsx scripts/confluence-properties.ts <pageId> get

# Get a single property
bunx tsx scripts/confluence-properties.ts <pageId> get <propertyKey>

# Set a property
bunx tsx scripts/confluence-properties.ts <pageId> set '<JSON>'

# Delete a property
bunx tsx scripts/confluence-properties.ts <pageId> delete <propertyKey>

# Get page emoji
bunx tsx scripts/confluence-properties.ts <pageId> get-emoji

# Set page emoji (updates both emoji-title-published and emoji-title-draft)
bunx tsx scripts/confluence-properties.ts <pageId> set-emoji "🚀"

# Remove page emoji
bunx tsx scripts/confluence-properties.ts <pageId> remove-emoji
```

Example property payloads:
- `'{"key": "my-property", "value": {"foo": "bar"}}'`
- `'{"properties": [{"key": "one", "value": 1}, {"key": "two", "value": "two"}]}'`

Note: Page CRUD uses the Confluence REST API v2. CQL search still uses the legacy endpoint because the v2 API does not expose CQL search.

## Query Language References

For generating correct queries:
- **Jira**: Read `docs/jql-guide.md` for JQL syntax, fields, operators, and functions
- **Confluence**: Read `docs/cql-guide.md` for CQL syntax and fields

## Large Content — File-Based Input

All scripts that accept a `'<JSON>'` argument also support `@<filepath>` syntax: write the JSON to a file first, then pass `@path/to/file.json` instead of the inline JSON string. This avoids shell argument-length limits that cause failures with large page bodies or issue descriptions.

**You MUST use file-based input when creating or updating Confluence pages or Jira issues with non-trivial body/description content.** Inline JSON is fine only for short payloads (simple metadata updates, status changes, etc.).

### Workflow

1. Write the JSON payload to a temporary file (e.g., `/tmp/confluence-payload.json`)
2. Pass `@/tmp/confluence-payload.json` as the argument instead of the raw JSON string
3. Clean up the temp file afterward

### Examples

Create a Confluence page with a large body:
```bash
# 1. Write payload to file
cat > /tmp/page.json << 'ENDJSON'
{"space": "DEV", "title": "Architecture Overview", "body": "<h1>Architecture</h1><p>Long content here...</p>"}
ENDJSON

# 2. Pass with @filepath
bunx tsx scripts/confluence-create.ts @/tmp/page.json
```

Update a Confluence page:
```bash
bunx tsx scripts/confluence-update.ts 123456 @/tmp/update-payload.json
```

Create a Jira issue with a long description:
```bash
bunx tsx scripts/jira-create.ts @/tmp/issue.json
```

Update a Jira issue:
```bash
bunx tsx scripts/jira-update.ts PROJ-123 @/tmp/update.json
```

**Important**: When generating content programmatically (as an AI agent), always use the Write tool to create the JSON file, then invoke the script with `@filepath`. Never attempt to pass large HTML or markdown content as an inline shell argument.

## Common Workflows

### Find and update my open issues
1. Search: `bunx tsx scripts/jira-search.ts "assignee = currentUser() AND status != Done"`
2. Update: `bunx tsx scripts/jira-update.ts PROJ-123 '{"status": "Done"}'`

### Create issues from a list
1. Bulk create: `bunx tsx scripts/jira-create.ts '[{...}, {...}, {...}]'`

### Find and read documentation
1. Search: `bunx tsx scripts/confluence-search.ts "title ~ 'API Documentation'"`
2. Get content: `bunx tsx scripts/confluence-get.ts 123456`

### Create a new documentation page
1. Create: `bunx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "API Guide", "body": "<h1>API Guide</h1><p>...</p>"}'`

### Work with your personal space
1. Discover: `bunx tsx scripts/confluence-personal-space.ts` → note the `space.key` value
2. Search: `bunx tsx scripts/confluence-search.ts "space = <space.key> AND type = page"`
3. Create: `bunx tsx scripts/confluence-create.ts '{"space": "<space.key>", "title": "My Page", "body": "<p>Content</p>"}'`
4. Read: `bunx tsx scripts/confluence-get.ts "<page title>" <space.key>`
