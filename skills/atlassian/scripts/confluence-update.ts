import { confluenceGet, confluencePut, exitWithError, output, parseJsonArg, getSiteUrl } from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface UpdateInput {
  title?: string;
  body?: string;
}

interface PageResponse {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  parentId?: string;
  version?: { number: number };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

// ============================================================================
// Main
// ============================================================================

const pageId = process.argv[2];
const jsonArg = process.argv[3];

if (!pageId || !jsonArg) {
  console.log(`Usage: npx tsx confluence-update.ts <pageId> '<JSON>'

Arguments:
  pageId    The Confluence page ID (numeric)
  JSON      Updates as JSON object

Updatable fields:
  title     New page title
  body      New page content (HTML/storage format)

Examples:
  # Update title
  npx tsx confluence-update.ts 123456 '{"title": "New Title"}'

  # Update content
  npx tsx confluence-update.ts 123456 '{"body": "<p>Updated content</p>"}'

  # Update both
  npx tsx confluence-update.ts 123456 '{"title": "New Title", "body": "<p>New content</p>"}'`);
  process.exit(1);
}

async function updatePage(pageId: string, updates: UpdateInput) {
  const hasTitleUpdate = updates.title != null;
  const hasBodyUpdate = updates.body != null;

  if (!hasTitleUpdate && !hasBodyUpdate) {
    exitWithError("At least one of title or body must be provided");
  }

  if (hasTitleUpdate && typeof updates.title === "string") {
    if (updates.title.trim().length === 0) {
      exitWithError("Title cannot be empty");
    }
  }

  // Get current page version
  const currentResponse = await confluenceGet<PageResponse>(`pages/${pageId}`, {
    "body-format": "storage",
  });

  if (!currentResponse.ok) {
    exitWithError(currentResponse.error || `Failed to get page ${pageId}`);
  }

  const current = currentResponse.data!;
  const currentVersion = current.version?.number;
  if (!currentVersion) {
    exitWithError(`Page ${pageId} is missing version metadata`);
  }

  const nextVersion = currentVersion + 1;
  const bodyValue = hasBodyUpdate ? updates.body : current.body?.storage?.value;

  if (bodyValue == null) {
    exitWithError("Unable to determine existing page body. Provide a body update.");
  }

  // Build update body
  const body: Record<string, unknown> = {
    id: pageId,
    status: current.status,
    title: hasTitleUpdate ? updates.title : current.title,
    spaceId: current.spaceId,
    parentId: current.parentId,
    body: {
      representation: "storage",
      value: bodyValue,
    },
    version: { number: nextVersion },
  };

  const response = await confluencePut<PageResponse>(`pages/${pageId}`, body);

  if (!response.ok) {
    exitWithError(response.error || "Failed to update page");
  }

  const data = response.data!;
  const siteUrl = getSiteUrl();

  output({
    id: data.id,
    title: data.title,
    version: data.version?.number,
    url: data._links?.webui ? `${siteUrl}/wiki${data._links.webui}` : undefined,
    success: true,
  });
}

async function main() {
  const updates = parseJsonArg<UpdateInput>(jsonArg, "updates");
  await updatePage(pageId, updates);
}

main();
