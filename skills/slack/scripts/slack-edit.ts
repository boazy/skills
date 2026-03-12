import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface UpdateResponse {
  ok: boolean;
  channel: string;
  ts: string;
  text: string;
}

// ============================================================================
// Main
// ============================================================================

const channelId = process.argv[2];
const messageTs = process.argv[3];
const text = process.argv[4];

if (!channelId || !messageTs || !text) {
  console.log(`Usage: npx tsx slack-edit.ts <channelId> <messageTs> <text>

Arguments:
  channelId   Channel/DM ID where the message was posted
  messageTs   Timestamp of the message to edit
  text        New message text (supports Slack mrkdwn formatting)

Note: You can only edit messages that you have posted.

Examples:
  npx tsx slack-edit.ts C01ABC123 1700000000.000001 "Updated message text"
  npx tsx slack-edit.ts C01ABC123 1700000000.000001 "*Corrected*: the right info"`);
  process.exit(1);
}

async function editMessage() {
  const response = await slackPost<UpdateResponse>("chat.update", {
    channel: channelId,
    ts: messageTs,
    text,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to edit message");
  }

  const data = response.data!;
  output({
    channel: data.channel,
    ts: data.ts,
    text: data.text,
  });
}

editMessage();
