import {
  confluenceDelete,
  confluenceGet,
  confluencePost,
  confluencePut,
  exitWithError,
  output,
  parseJsonArg,
} from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

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

interface PropertyInput {
  key: string;
  value: unknown;
}

interface SetInput {
  key?: string;
  value?: unknown;
  properties?: PropertyInput[];
}

// ============================================================================
// Main
// ============================================================================

const pageId = process.argv[2];
const action = process.argv[3];
const arg = process.argv[4];

if (!pageId || !action) {
  console.log(`Usage: npx tsx confluence-properties.ts <pageId> <action> [arg]

Actions:
  get [key]           List all properties or fetch a single property by key
  set '<JSON>'        Upsert a property (or multiple) from JSON
  delete <key>        Delete a property by key
  get-emoji           Fetch emoji-title-published and emoji-title-draft
  set-emoji <value>   Set emoji for both emoji-title-published and emoji-title-draft
  remove-emoji        Delete emoji-title-published and emoji-title-draft

Examples:
  # Get all properties
  npx tsx confluence-properties.ts 123456 get

  # Get a single property
  npx tsx confluence-properties.ts 123456 get my-property

  # Set a single property
  npx tsx confluence-properties.ts 123456 set '{"key": "my-property", "value": {"foo": "bar"}}'

  # Set multiple properties
  npx tsx confluence-properties.ts 123456 set '{"properties": [{"key": "one", "value": 1}, {"key": "two", "value": "two"}]}'

  # Delete a property
  npx tsx confluence-properties.ts 123456 delete my-property

  # Get page emoji
  npx tsx confluence-properties.ts 123456 get-emoji

  # Set page emoji
  npx tsx confluence-properties.ts 123456 set-emoji "🚀"

  # Remove page emoji
  npx tsx confluence-properties.ts 123456 remove-emoji`);
  process.exit(1);
}

function parseMaybeJson(input: string | undefined): unknown {
  if (!input) {
    return undefined;
  }

  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

async function fetchPropertyDetails(pageIdValue: string, key: string) {
  const response = await confluenceGet<PropertyListResponse>(
    `pages/${pageIdValue}/properties`,
    { key }
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to fetch properties");
  }

  const property = response.data?.results?.[0];
  if (!property) {
    return undefined;
  }

  const detailResponse = await confluenceGet<ContentProperty>(
    `pages/${pageIdValue}/properties/${property.id}`
  );

  if (!detailResponse.ok) {
    exitWithError(detailResponse.error || "Failed to fetch property details");
  }

  return detailResponse.data;
}

async function getPropertyByKey(pageIdValue: string, key: string) {
  const property = await fetchPropertyDetails(pageIdValue, key);
  if (!property) {
    exitWithError(`Property "${key}" not found on page ${pageIdValue}`);
  }

  output(property);
}

async function listProperties(pageIdValue: string) {
  const response = await confluenceGet<PropertyListResponse>(
    `pages/${pageIdValue}/properties`
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to fetch properties");
  }

  output({
    total: response.data?.size,
    hasMore: !!response.data?._links?.next,
    properties: response.data?.results || [],
  });
}

async function fetchPropertyForUpdate(pageIdValue: string, key: string) {
  return fetchPropertyDetails(pageIdValue, key);
}

async function upsertProperty(
  pageIdValue: string,
  key: string,
  value: unknown
) {
  const existing = await fetchPropertyForUpdate(pageIdValue, key);

  if (!existing) {
    const createResponse = await confluencePost<ContentProperty>(
      `pages/${pageIdValue}/properties`,
      { key, value }
    );

    if (!createResponse.ok) {
      exitWithError(createResponse.error || `Failed to create property ${key}`);
    }

    return createResponse.data;
  }

  const currentVersion = existing.version?.number;
  if (!currentVersion) {
    exitWithError(`Property ${key} is missing version metadata`);
  }

  const updateResponse = await confluencePut<ContentProperty>(
    `pages/${pageIdValue}/properties/${existing.id}`,
    {
      key,
      value,
      version: { number: currentVersion + 1 },
    }
  );

  if (!updateResponse.ok) {
    exitWithError(updateResponse.error || `Failed to update property ${key}`);
  }

  return updateResponse.data;
}

async function setProperties(pageIdValue: string, input: SetInput) {
  const properties: PropertyInput[] = [];

  if (input.key) {
    properties.push({ key: input.key, value: input.value });
  }

  if (input.properties) {
    properties.push(...input.properties);
  }

  if (!properties.length) {
    exitWithError("Provide a key/value or properties array");
  }

  for (const property of properties) {
    if (!property.key) {
      exitWithError("Property key is required");
    }
    if (property.value === undefined) {
      exitWithError(`Property value is required for ${property.key}`);
    }
  }

  const results = [] as ContentProperty[];
  for (const property of properties) {
    results.push(await upsertProperty(pageIdValue, property.key, property.value));
  }

  output({
    pageId: pageIdValue,
    updated: results.length,
    properties: results.map((result) => ({
      id: result.id,
      key: result.key,
      version: result.version?.number,
    })),
  });
}

async function setEmoji(pageIdValue: string, emojiValue: unknown) {
  if (emojiValue === undefined) {
    exitWithError("Emoji value is required");
  }

  const published = await upsertProperty(
    pageIdValue,
    "emoji-title-published",
    emojiValue
  );
  const draft = await upsertProperty(
    pageIdValue,
    "emoji-title-draft",
    emojiValue
  );

  output({
    pageId: pageIdValue,
    emoji: emojiValue,
    properties: [
      { id: published?.id, key: published?.key, version: published?.version?.number },
      { id: draft?.id, key: draft?.key, version: draft?.version?.number },
    ],
  });
}

async function getEmoji(pageIdValue: string) {
  const published = await fetchPropertyDetails(
    pageIdValue,
    "emoji-title-published"
  );
  const draft = await fetchPropertyDetails(pageIdValue, "emoji-title-draft");
  const emojiValue = published?.value ?? draft?.value;

  output({
    pageId: pageIdValue,
    emoji: emojiValue,
    properties: [
      published
        ? {
            id: published.id,
            key: published.key,
            version: published.version?.number,
            value: published.value,
          }
        : undefined,
      draft
        ? {
            id: draft.id,
            key: draft.key,
            version: draft.version?.number,
            value: draft.value,
          }
        : undefined,
    ].filter(Boolean),
  });
}

async function deleteProperty(pageIdValue: string, key: string) {
  const existing = await fetchPropertyDetails(pageIdValue, key);
  if (!existing) {
    return false;
  }

  const response = await confluenceDelete(
    `pages/${pageIdValue}/properties/${existing.id}`
  );

  if (!response.ok) {
    exitWithError(response.error || `Failed to delete property ${key}`);
  }

  return true;
}

async function removeEmoji(pageIdValue: string) {
  const deleted: string[] = [];
  const missing: string[] = [];

  const keys = ["emoji-title-published", "emoji-title-draft"];
  for (const key of keys) {
    const removed = await deleteProperty(pageIdValue, key);
    if (removed) {
      deleted.push(key);
    } else {
      missing.push(key);
    }
  }

  output({
    pageId: pageIdValue,
    deleted,
    missing,
  });
}

async function main() {
  if (action === "get") {
    if (arg) {
      await getPropertyByKey(pageId, arg);
      return;
    }

    await listProperties(pageId);
    return;
  }

  if (action === "set") {
    if (!arg) {
      exitWithError("JSON input is required for set");
    }

    const input = parseJsonArg<SetInput>(arg, "property config");
    await setProperties(pageId, input);
    return;
  }

  if (action === "set-emoji") {
    const emojiValue = parseMaybeJson(arg);
    await setEmoji(pageId, emojiValue);
    return;
  }

  if (action === "get-emoji") {
    await getEmoji(pageId);
    return;
  }

  if (action === "delete") {
    if (!arg) {
      exitWithError("Property key is required for delete");
    }

    const deleted = await deleteProperty(pageId, arg);
    if (!deleted) {
      exitWithError(`Property "${arg}" not found on page ${pageId}`);
    }

    output({ pageId, deleted: [arg] });
    return;
  }

  if (action === "remove-emoji") {
    await removeEmoji(pageId);
    return;
  }

  exitWithError(`Unknown action: ${action}`);
}

main();
