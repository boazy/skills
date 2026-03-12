import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface ReactionResponse {
  ok: boolean;
}

// ============================================================================
// Main
// ============================================================================

const channelId = process.argv[2];
const messageTs = process.argv[3];
const emoji = process.argv[4];

if (!channelId || !messageTs || !emoji) {
  console.log(`Usage: npx tsx slack-react.ts <channelId> <messageTs> <emoji>

Arguments:
  channelId   Channel/DM ID where the message is
  messageTs   Timestamp of the message to react to
  emoji       Emoji name without colons (e.g., thumbsup, heart, custom_emoji)

Examples:
  npx tsx slack-react.ts C01ABC123 1700000000.000001 thumbsup
  npx tsx slack-react.ts C01ABC123 1700000000.000001 white_check_mark
  npx tsx slack-react.ts D01ABC123 1700000000.000001 heart`);
  process.exit(1);
}

async function addReaction() {
  const response = await slackPost<ReactionResponse>("reactions.add", {
    channel: channelId,
    timestamp: messageTs,
    name: emoji,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to add reaction");
  }

  output({
    channel: channelId,
    message_ts: messageTs,
    emoji,
    added: true,
  });
}

addReaction();
