import { jiraUploadAttachment, exitWithError, output } from "./lib/atlassian.ts";

interface UploadedAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  content?: string;
  thumbnail?: string;
}

const issueKey = process.argv[2];
const filePath = process.argv[3];
const fileName = process.argv[4];

if (!issueKey || !filePath) {
  console.log(`Usage: npx tsx jira-attachment.ts <issueKey> <filePath> [fileName]

Arguments:
  issueKey    The Jira issue key (e.g., PROJ-123)
  filePath    Local file path to upload
  fileName    Optional attachment filename override

Examples:
  npx tsx jira-attachment.ts PROJ-123 ./diagram.png
  npx tsx jira-attachment.ts PROJ-123 ./image.png architecture.png`);
  process.exit(1);
}

async function main() {
  const response = await jiraUploadAttachment<UploadedAttachment[]>(
    issueKey,
    filePath,
    fileName
  );

  if (!response.ok || !response.data) {
    exitWithError(response.error || "Failed to upload attachment");
  }

  const attachments = response.data.map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    contentUrl: a.content,
    thumbnailUrl: a.thumbnail,
  }));

  output({
    issueKey,
    uploaded: attachments.length,
    attachments,
  });
}

main();
