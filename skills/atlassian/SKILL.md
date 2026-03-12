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
npx tsx scripts/jira-search.ts "<JQL query>" [maxResults] [nextPageToken]
```
Examples:
- `npx tsx scripts/jira-search.ts "assignee = currentUser() AND status != Done"`
- `npx tsx scripts/jira-search.ts "project = PROJ AND type = Bug" 50`
- `npx tsx scripts/jira-search.ts "project = PROJ" 50 "token..."` (pagination)

See `docs/jql-guide.md` for JQL syntax reference.

#### Get Issue Details
```bash
npx tsx scripts/jira-get.ts <issueKey>
```
Example: `npx tsx scripts/jira-get.ts PROJ-123`

#### Create Issue
```bash
npx tsx scripts/jira-create.ts '<JSON>'
```
Single issue:
```bash
npx tsx scripts/jira-create.ts '{"project": "PROJ", "type": "Story", "summary": "New feature", "description": "Details here"}'
```

Bulk create (array):
```bash
npx tsx scripts/jira-create.ts '[{"project": "PROJ", "type": "Bug", "summary": "Bug 1"}, {"project": "PROJ", "type": "Bug", "summary": "Bug 2"}]'
```

#### Update Issue
```bash
npx tsx scripts/jira-update.ts <issueKey> '<JSON updates>'
```
Example: `npx tsx scripts/jira-update.ts PROJ-123 '{"status": "In Progress", "assignee": "user@example.com"}'`

#### Comments
```bash
# Get comments
npx tsx scripts/jira-comment.ts <issueKey> get

# Add comment
npx tsx scripts/jira-comment.ts <issueKey> add "<comment text>"
```

#### Upload Attachment
```bash
npx tsx scripts/jira-attachment.ts <issueKey> <filePath> [fileName]
```
Examples:
- `npx tsx scripts/jira-attachment.ts PROJ-123 ./diagram.png`
- `npx tsx scripts/jira-attachment.ts PROJ-123 ./image.png architecture.png`

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
npx tsx scripts/confluence-personal-space.ts
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
- **Create page**: `npx tsx scripts/confluence-create.ts '{"space": "~5b10a2844c20165700ede21g", "title": "My Notes", "body": "<p>Content</p>"}'`
- **Search pages**: `npx tsx scripts/confluence-search.ts "space = ~5b10a2844c20165700ede21g AND type = page"`
- **Get page by title**: `npx tsx scripts/confluence-get.ts "My Notes" ~5b10a2844c20165700ede21g`

Note: Personal space keys on Confluence Cloud use the format `~accountId` (not `~username`). The discovery script handles this automatically.

#### Search Pages
```bash
npx tsx scripts/confluence-search.ts "<CQL query>" [maxResults]
```
Examples:
- `npx tsx scripts/confluence-search.ts "title ~ 'Roadmap'"`
- `npx tsx scripts/confluence-search.ts "space = DEV AND type = page" 25`

See `docs/cql-guide.md` for CQL syntax reference.

#### Get Page Content
```bash
npx tsx scripts/confluence-get.ts <pageId>
# or by title
npx tsx scripts/confluence-get.ts "<page title>" <spaceKey>
```

#### Create Page
```bash
npx tsx scripts/confluence-create.ts '<JSON>'
```
Example:
```bash
npx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "New Page", "body": "<p>Content here</p>"}'
```

Optional parent page:
```bash
npx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "Child Page", "body": "<p>Content</p>", "parentId": "123456"}'
```

#### Update Page
```bash
npx tsx scripts/confluence-update.ts <pageId> '<JSON updates>'
```
Example: `npx tsx scripts/confluence-update.ts 123456 '{"title": "Updated Title", "body": "<p>New content</p>"}'`

#### Page Properties (v2)

```bash
# List properties
npx tsx scripts/confluence-properties.ts <pageId> get

# Get a single property
npx tsx scripts/confluence-properties.ts <pageId> get <propertyKey>

# Set a property
npx tsx scripts/confluence-properties.ts <pageId> set '<JSON>'

# Delete a property
npx tsx scripts/confluence-properties.ts <pageId> delete <propertyKey>

# Get page emoji
npx tsx scripts/confluence-properties.ts <pageId> get-emoji

# Set page emoji (updates both emoji-title-published and emoji-title-draft)
npx tsx scripts/confluence-properties.ts <pageId> set-emoji "🚀"

# Remove page emoji
npx tsx scripts/confluence-properties.ts <pageId> remove-emoji
```

Example property payloads:
- `'{"key": "my-property", "value": {"foo": "bar"}}'`
- `'{"properties": [{"key": "one", "value": 1}, {"key": "two", "value": "two"}]}'`

Note: Page CRUD uses the Confluence REST API v2. CQL search still uses the legacy endpoint because the v2 API does not expose CQL search.

## Query Language References

For generating correct queries:
- **Jira**: Read `docs/jql-guide.md` for JQL syntax, fields, operators, and functions
- **Confluence**: Read `docs/cql-guide.md` for CQL syntax and fields

## Common Workflows

### Find and update my open issues
1. Search: `npx tsx scripts/jira-search.ts "assignee = currentUser() AND status != Done"`
2. Update: `npx tsx scripts/jira-update.ts PROJ-123 '{"status": "Done"}'`

### Create issues from a list
1. Bulk create: `npx tsx scripts/jira-create.ts '[{...}, {...}, {...}]'`

### Find and read documentation
1. Search: `npx tsx scripts/confluence-search.ts "title ~ 'API Documentation'"`
2. Get content: `npx tsx scripts/confluence-get.ts 123456`

### Create a new documentation page
1. Create: `npx tsx scripts/confluence-create.ts '{"space": "DEV", "title": "API Guide", "body": "<h1>API Guide</h1><p>...</p>"}'`

### Work with your personal space
1. Discover: `npx tsx scripts/confluence-personal-space.ts` → note the `space.key` value
2. Search: `npx tsx scripts/confluence-search.ts "space = <space.key> AND type = page"`
3. Create: `npx tsx scripts/confluence-create.ts '{"space": "<space.key>", "title": "My Page", "body": "<p>Content</p>"}'`
4. Read: `npx tsx scripts/confluence-get.ts "<page title>" <space.key>`
