import { jiraDelete, exitWithError, output } from "./lib/atlassian.ts";

const attachmentId = process.argv[2];

if (!attachmentId) {
  console.log(`Usage: npx tsx jira-delete-attachment.ts <attachmentId>

Arguments:
  attachmentId    The Jira attachment ID to delete (e.g., 251415)

Examples:
  npx tsx jira-delete-attachment.ts 251415`);
  process.exit(1);
}

async function main() {
  const response = await jiraDelete(
    `attachment/${encodeURIComponent(attachmentId)}`
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to delete attachment");
  }

  output({ deleted: true, attachmentId });
}

main();
