import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface PostMessageResponse {
  ok: boolean;
  channel: string;
  ts: string;
  message: {
    text: string;
    ts: string;
    thread_ts?: string;
  };
}

// ============================================================================
// Main
// ============================================================================

const channelId = process.argv[2];
const text = process.argv[3];
const threadTs = process.argv[4] || undefined;

if (!channelId || !text) {
  console.log(`Usage: npx tsx slack-send.ts <channelId> <text> [threadTs]

Arguments:
  channelId  Channel, DM, or group DM ID to post to
  text       Message text (supports Slack mrkdwn formatting)
  threadTs   Optional: parent message timestamp to reply in thread

Formatting (Slack mrkdwn):
  *bold*  _italic_  ~strikethrough~  \`code\`
  \`\`\`code block\`\`\`
  > blockquote
  <https://example.com|Link text>
  <@U01ABC123> (mention user)  <#C01ABC123> (mention channel)
  :emoji_name:

Examples:
  npx tsx slack-send.ts C01ABC123 "Hello, world!"
  npx tsx slack-send.ts C01ABC123 "*Important*: check this _now_"
  npx tsx slack-send.ts C01ABC123 "Thread reply" 1700000000.000001
  npx tsx slack-send.ts D01ABC123 "Direct message to someone"`);
  process.exit(1);
}

async function sendMessage() {
  const params: Record<string, unknown> = {
    channel: channelId,
    text,
  };
  if (threadTs) {
    params.thread_ts = threadTs;
  }

  const response = await slackPost<PostMessageResponse>(
    "chat.postMessage",
    params
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to send message");
  }

  const data = response.data!;
  output({
    channel: data.channel,
    ts: data.ts,
    thread_ts: data.message.thread_ts || null,
    text: data.message.text,
  });
}

sendMessage();
