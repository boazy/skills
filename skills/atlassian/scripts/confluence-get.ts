import { confluenceGet, exitWithError, output, getSiteUrl } from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface PageV2 {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  parentId?: string;
  version?: { number: number; createdAt?: string };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

interface SpaceResponse {
  id: string;
  key: string;
  name: string;
}

interface ContentProperty {
  id: string;
  key: string;
  value?: unknown;
  version?: { number: number };
}

interface PropertyListResponse {
  results: ContentProperty[];
  size?: number;
  _links?: { next?: string };
}

// ============================================================================
// Main
// ============================================================================

const pageIdOrTitle = process.argv[2];
const spaceKeyArg = process.argv[3];

if (!pageIdOrTitle) {
  console.log(`Usage: npx tsx confluence-get.ts <pageId|title> [spaceKey]

Arguments:
  pageId      Numeric page ID (e.g., 123456)
  title       Page title (requires spaceKey)
  spaceKey    Space key (required when using title)

Examples:
  # By page ID
  npx tsx confluence-get.ts 123456

  # By title and space
  npx tsx confluence-get.ts "API Documentation" DEV`);
  process.exit(1);
}

async function getSpaceByKey(spaceKey: string): Promise<SpaceResponse> {
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

  return space;
}

async function tryGetSpaceById(spaceId: string): Promise<SpaceResponse | undefined> {
  const response = await confluenceGet<SpaceResponse>(`spaces/${spaceId}`);
  if (!response.ok) {
    return undefined;
  }

  return response.data;
}

async function getPageProperties(pageId: string) {
  const listResponse = await confluenceGet<PropertyListResponse>(
    `pages/${pageId}/properties`
  );

  if (!listResponse.ok) {
    exitWithError(listResponse.error || `Failed to fetch properties for page ${pageId}`);
  }

  const list = listResponse.data?.results ?? [];
  const properties: ContentProperty[] = [];

  for (const property of list) {
    const detailResponse = await confluenceGet<ContentProperty>(
      `pages/${pageId}/properties/${property.id}`
    );

    if (!detailResponse.ok) {
      exitWithError(
        detailResponse.error ||
          `Failed to fetch property ${property.key} for page ${pageId}`
      );
    }

    if (detailResponse.data) {
      properties.push(detailResponse.data);
    }
  }

  return {
    total: listResponse.data?.size ?? properties.length,
    hasMore: !!listResponse.data?._links?.next,
    properties,
  };
}

async function getPageById(pageId: string) {
  const response = await confluenceGet<PageV2>(`pages/${pageId}`, {
    "body-format": "storage",
  });

  if (!response.ok) {
    exitWithError(response.error || `Failed to get page ${pageId}`);
  }

  const page = response.data!;
  const siteUrl = getSiteUrl();
  const space = page.spaceId ? await tryGetSpaceById(page.spaceId) : undefined;
  const properties = await getPageProperties(page.id);

  output({
    id: page.id,
    title: page.title,
    status: page.status,
    space: space
      ? { id: space.id, key: space.key, name: space.name }
      : { id: page.spaceId },
    parentId: page.parentId,
    version: page.version?.number,
    lastModified: page.version?.createdAt,
    url: page._links?.webui ? `${siteUrl}/wiki${page._links.webui}` : undefined,
    body: page.body?.storage?.value,
    properties,
  });
}

async function getPageByTitle(title: string, spaceKey: string) {
  const space = await getSpaceByKey(spaceKey);
  const response = await confluenceGet<{ results: PageV2[] }>("pages", {
    title,
    "space-id": space.id,
    limit: "1",
    "body-format": "storage",
  });

  if (!response.ok) {
    exitWithError(response.error || "Search failed");
  }

  const page = response.data?.results?.[0];
  if (!page) {
    exitWithError(`Page "${title}" not found in space ${spaceKey}`);
  }

  await getPageById(page.id);
}

async function main() {
  // Check if first arg is a number (page ID) or string (title)
  if (/^\d+$/.test(pageIdOrTitle)) {
    await getPageById(pageIdOrTitle);
  } else {
    if (!spaceKeyArg) {
      exitWithError("Space key is required when searching by title");
    }
    await getPageByTitle(pageIdOrTitle, spaceKeyArg);
  }
}

main();
