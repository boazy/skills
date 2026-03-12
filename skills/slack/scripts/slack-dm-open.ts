import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface OpenResponse {
  ok: boolean;
  channel: {
    id: string;
    is_im?: boolean;
    is_mpim?: boolean;
  };
  already_open?: boolean;
}

// ============================================================================
// Main
// ============================================================================

const userIds = process.argv[2];

if (!userIds) {
  console.log(`Usage: npx tsx slack-dm-open.ts <userIds>

Arguments:
  userIds  Comma-separated user IDs (1 user = DM, 2-8 users = group DM)

Returns:
  The conversation ID to use with slack-send.ts and slack-history.ts.

Examples:
  npx tsx slack-dm-open.ts U01ABC123
  npx tsx slack-dm-open.ts U01ABC123,U02DEF456
  npx tsx slack-dm-open.ts U01ABC123,U02DEF456,U03GHI789`);
  process.exit(1);
}

async function openDm() {
  const response = await slackPost<OpenResponse>("conversations.open", {
    users: userIds,
    return_im: true,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to open DM");
  }

  const data = response.data!;
  output({
    channel_id: data.channel.id,
    type: data.channel.is_mpim ? "group_dm" : "dm",
    already_open: data.already_open || false,
  });
}

openDm();
