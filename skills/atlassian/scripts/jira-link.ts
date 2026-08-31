import {
  jiraDelete,
  jiraGet,
  jiraPost,
  exitWithError,
  normalizeJiraIssueLinks,
  output,
  resolveIssueLinkRelationship,
  type JiraIssueLink,
  type JiraIssueLinkType,
} from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface IssueLinkTypesResponse {
  issueLinkTypes: JiraIssueLinkType[];
}

type IssueLink = JiraIssueLink;

interface IssueLinksResponse {
  fields?: {
    issuelinks?: IssueLink[];
  };
}

const USAGE = `Usage: bunx tsx jira-link.ts <action> [args]

Actions:
  types
      List issue-link types on this Jira site (name, inward, outward).

  list <issueKey>
      List issue links on an issue, using the relationship phrase as it
      reads on that issue.

  add <issueKey> "<relationship>" <otherIssueKey>
      Create a link on issueKey. relationship is the inward or outward
      phrase as it should read on issueKey (not the type name).
      Example: bunx tsx jira-link.ts add PROJ-200 "is blocked by" PROJ-100

  remove <linkId>
      Delete an issue link by id from list output.

Examples:
  bunx tsx jira-link.ts types
  bunx tsx jira-link.ts list PROJ-200
  bunx tsx jira-link.ts add PROJ-200 "blocks" PROJ-100
  bunx tsx jira-link.ts add PROJ-200 "relates to" PROJ-100
  bunx tsx jira-link.ts remove 10001`;

// ============================================================================
// Main
// ============================================================================

const action = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

if (!action || action === "--help" || action === "-h") {
  console.log(USAGE);
  process.exit(action ? 0 : 1);
}


async function fetchLinkTypes(): Promise<JiraIssueLinkType[]> {
  const response = await jiraGet<IssueLinkTypesResponse>("issueLinkType");
  if (!response.ok) {
    exitWithError(response.error || "Failed to list issue link types");
  }
  return response.data?.issueLinkTypes ?? [];
}

async function fetchIssueLinks(issueKey: string): Promise<IssueLink[]> {
  const response = await jiraGet<IssueLinksResponse>(
    `issue/${encodeURIComponent(issueKey)}`,
    { fields: "issuelinks" },
  );
  if (!response.ok) {
    exitWithError(response.error || `Failed to get issue ${issueKey}`);
  }
  return response.data?.fields?.issuelinks ?? [];
}

async function listTypes() {
  const types = await fetchLinkTypes();
  output({
    count: types.length,
    types: types.map((type) => ({
      id: type.id,
      name: type.name,
      inward: type.inward,
      outward: type.outward,
    })),
  });
}

async function listLinks(issueKey: string) {
  const links = normalizeJiraIssueLinks(
    issueKey,
    await fetchIssueLinks(issueKey),
  );

  output({
    issueKey,
    count: links.length,
    links,
  });
}

async function addLink(
  issueKey: string,
  relationship: string,
  otherIssueKey: string,
) {
  const types = await fetchLinkTypes();
  let resolved: { type: JiraIssueLinkType; fromIsInward: boolean };
  try {
    resolved = resolveIssueLinkRelationship(types, relationship);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }

  const existing = normalizeJiraIssueLinks(
    issueKey,
    await fetchIssueLinks(issueKey),
  ).find(
      (link) =>
        link.type === resolved.type.name &&
        link.otherKey.toUpperCase() === otherIssueKey.toUpperCase() &&
        link.relationship.toLowerCase() ===
          (resolved.fromIsInward
            ? resolved.type.inward
            : resolved.type.outward
          ).toLowerCase(),
    );

  if (existing) {
    output({
      issueKey,
      otherIssueKey,
      relationship: existing.relationship,
      type: existing.type,
      linkId: existing.id,
      alreadyLinked: true,
    });
    return;
  }

  const body = resolved.fromIsInward
    ? {
        type: { name: resolved.type.name },
        inwardIssue: { key: issueKey },
        outwardIssue: { key: otherIssueKey },
      }
    : {
        type: { name: resolved.type.name },
        outwardIssue: { key: issueKey },
        inwardIssue: { key: otherIssueKey },
      };

  const response = await jiraPost("issueLink", body);
  if (!response.ok) {
    exitWithError(response.error || "Failed to create issue link");
  }

  output({
    issueKey,
    otherIssueKey,
    relationship: resolved.fromIsInward
      ? resolved.type.inward
      : resolved.type.outward,
    type: resolved.type.name,
    created: true,
  });
}

async function removeLink(linkId: string) {
  const response = await jiraDelete(
    `issueLink/${encodeURIComponent(linkId)}`,
  );
  if (!response.ok) {
    exitWithError(response.error || `Failed to delete issue link ${linkId}`);
  }
  output({ deleted: true, linkId });
}

async function main() {
  switch (action.toLowerCase()) {
    case "types":
      await listTypes();
      break;
    case "list":
      if (!arg1) {
        exitWithError("list requires <issueKey>");
      }
      await listLinks(arg1);
      break;
    case "add":
      if (!arg1 || !arg2 || !arg3) {
        exitWithError(
          'add requires <issueKey> "<relationship>" <otherIssueKey>',
        );
      }
      await addLink(arg1, arg2, arg3);
      break;
    case "remove":
    case "delete":
      if (!arg1) {
        exitWithError("remove requires <linkId>");
      }
      await removeLink(arg1);
      break;
    default:
      exitWithError(`Unknown action: ${action}. Use types, list, add, or remove`);
  }
}

main();
