import { confluenceLegacyGet, exitWithError, output, getSiteUrl } from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface PersonalSpace {
  id: number;
  key: string;
  name: string;
  type: string;
  status: string;
  _links?: { webui?: string };
}

interface CurrentUserResponse {
  accountId: string;
  displayName: string;
  email?: string;
  personalSpace?: PersonalSpace;
}

// ============================================================================
// Main
// ============================================================================

async function getPersonalSpace() {
  const response = await confluenceLegacyGet<CurrentUserResponse>("user/current", {
    expand: "personalSpace",
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to get current user");
  }

  const user = response.data!;

  if (!user.personalSpace) {
    exitWithError(
      `User "${user.displayName}" (${user.accountId}) does not have a personal space. ` +
        "The user may need to create one first via Confluence UI."
    );
  }

  const space = user.personalSpace;
  const siteUrl = getSiteUrl();

  output({
    accountId: user.accountId,
    displayName: user.displayName,
    space: {
      id: space.id,
      key: space.key,
      name: space.name,
      type: space.type,
      status: space.status,
      url: space._links?.webui ? `${siteUrl}/wiki${space._links.webui}` : undefined,
    },
  });
}

getPersonalSpace();
