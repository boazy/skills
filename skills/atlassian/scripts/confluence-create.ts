import { confluenceGet, confluencePost, exitWithError, output, parseJsonArg, getSiteUrl } from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface CreatePageInput {
  space: string;
  title: string;
  body: string;
  parentId?: string;
  status?: "current" | "draft";
}

interface CreatePageResponse {
  id: string;
  title: string;
  status?: string;
  _links?: { webui?: string };
}

interface SpaceResponse {
  id: string;
  key: string;
  name: string;
}

// ============================================================================
// Main
// ============================================================================

const jsonArg = process.argv[2];

if (!jsonArg) {
  console.log(`Usage: npx tsx confluence-create.ts '<JSON>'

Arguments:
  JSON    Page configuration as JSON

Required fields:
  space     Space key (e.g., "DEV")
  title     Page title
  body      Page content (HTML/storage format)

Optional fields:
  parentId  Parent page ID (for nested pages)

Examples:
  # Simple page
  npx tsx confluence-create.ts '{"space": "DEV", "title": "My Page", "body": "<p>Hello world</p>"}'

  # Nested under parent
  npx tsx confluence-create.ts '{"space": "DEV", "title": "Child Page", "body": "<p>Content</p>", "parentId": "123456"}'

  # Rich content
  npx tsx confluence-create.ts '{"space": "DEV", "title": "API Docs", "body": "<h1>API</h1><p>Documentation here</p><ul><li>Item 1</li><li>Item 2</li></ul>"}'`);
  process.exit(1);
}

async function getSpaceId(spaceKey: string): Promise<string> {
  const response = await confluenceGet<{ results: SpaceResponse[] }>("spaces", {
    keys: spaceKey,
    limit: "1",
  });

  if (!response.ok) {
    exitWithError(response.error || `Failed to resolve space key ${spaceKey}`);
  }

  const space = response.data?.results.find(
    (result) => result.key.toLowerCase() === spaceKey.toLowerCase()
  );
  if (!space) {
    exitWithError(`Space "${spaceKey}" not found`);
  }

  return space.id;
}

async function createPage(input: CreatePageInput) {
  // Validate required fields
  if (!input.space || !input.title || input.body == null) {
    exitWithError("Missing required fields: space, title, body");
  }

  // Build request body for legacy API
  const body: Record<string, unknown> = {
    spaceId: await getSpaceId(input.space),
    status: input.status || "current",
    title: input.title,
    body: {
      representation: "storage",
      value: input.body,
    },
  };

  if (input.parentId) {
    body.parentId = input.parentId;
  }

  const response = await confluencePost<CreatePageResponse>("pages", body);

  if (!response.ok) {
    exitWithError(response.error || "Failed to create page");
  }

  const data = response.data!;
  const siteUrl = getSiteUrl();

  output({
    id: data.id,
    title: data.title,
    status: data.status,
    url: data._links?.webui ? `${siteUrl}/wiki${data._links.webui}` : undefined,
    success: true,
  });
}

async function main() {
  const input = parseJsonArg<CreatePageInput>(jsonArg, "page config");
  await createPage(input);
}

main();
