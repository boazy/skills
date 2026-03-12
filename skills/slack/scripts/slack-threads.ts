import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface Message {
  type: string;
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  reactions?: Array<{ name: string; count: number; users: string[] }>;
}

interface RepliesResponse {
  ok: boolean;
  messages: Message[];
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
}

// ============================================================================
// Main
// ============================================================================

const channelId = process.argv[2];
const threadTs = process.argv[3];
const limit = process.argv[4] || "100";
const cursor = process.argv[5] || undefined;

if (!channelId || !threadTs) {
  console.log(`Usage: npx tsx slack-threads.ts <channelId> <threadTs> [limit] [cursor]

Arguments:
  channelId  Channel/DM ID where the thread lives
  threadTs   Timestamp of the parent message (e.g., 1234567890.123456)
  limit      Max replies to return (default: 100, max: 1000)
  cursor     Pagination cursor from previous response

Examples:
  npx tsx slack-threads.ts C01ABC123 1700000000.000001
  npx tsx slack-threads.ts C01ABC123 1700000000.000001 200
  npx tsx slack-threads.ts C01ABC123 1700000000.000001 100 "cursor123..."`);
  process.exit(1);
}

async function getThreadReplies() {
  const params: Record<string, unknown> = {
    channel: channelId,
    ts: threadTs,
    limit: parseInt(limit, 10),
  };
  if (cursor) {
    params.cursor = cursor;
  }

  const response = await slackPost<RepliesResponse>(
    "conversations.replies",
    params
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to get thread replies");
  }

  const data = response.data!;
  const messages = data.messages.map((msg) => ({
    user: msg.user || msg.bot_id || "unknown",
    text: msg.text,
    ts: msg.ts,
    is_parent: msg.ts === msg.thread_ts,
    reactions:
      msg.reactions?.map((r) => ({ name: r.name, count: r.count })) || [],
  }));

  output({
    channel: channelId,
    thread_ts: threadTs,
    count: messages.length,
    has_more: data.has_more,
    next_cursor: data.response_metadata?.next_cursor || null,
    messages,
  });
}

getThreadReplies();
