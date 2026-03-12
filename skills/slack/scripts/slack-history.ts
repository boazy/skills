import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface Message {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number; users: string[] }>;
}

interface HistoryResponse {
  ok: boolean;
  messages: Message[];
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
}

// ============================================================================
// Main
// ============================================================================

const channelId = process.argv[2];
const limit = process.argv[3] || "50";
const cursor = process.argv[4] || undefined;
const oldest = process.argv[5] || undefined;
const latest = process.argv[6] || undefined;

if (!channelId) {
  console.log(`Usage: npx tsx slack-history.ts <channelId> [limit] [cursor] [oldest] [latest]

Arguments:
  channelId  Channel/DM/group ID (e.g., C01ABC123, D01ABC123)
  limit      Max messages to return (default: 50, max: 1000)
  cursor     Pagination cursor from previous response
  oldest     Unix timestamp — only messages after this time
  latest     Unix timestamp — only messages before this time

Examples:
  npx tsx slack-history.ts C01ABC123
  npx tsx slack-history.ts C01ABC123 100
  npx tsx slack-history.ts D01ABC123 50 "" "1700000000"
  npx tsx slack-history.ts C01ABC123 50 "cursor123..."`);
  process.exit(1);
}

async function getHistory() {
  const params: Record<string, unknown> = {
    channel: channelId,
    limit: parseInt(limit, 10),
  };
  if (cursor) {
    params.cursor = cursor;
  }
  if (oldest) {
    params.oldest = oldest;
  }
  if (latest) {
    params.latest = latest;
  }

  const response = await slackPost<HistoryResponse>(
    "conversations.history",
    params
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to get history");
  }

  const data = response.data!;
  const messages = data.messages.map((msg) => ({
    user: msg.user || msg.bot_id || "unknown",
    text: msg.text,
    ts: msg.ts,
    thread_ts: msg.thread_ts || null,
    reply_count: msg.reply_count || 0,
    reactions:
      msg.reactions?.map((r) => ({ name: r.name, count: r.count })) || [],
    subtype: msg.subtype || null,
  }));

  output({
    channel: channelId,
    count: messages.length,
    has_more: data.has_more,
    next_cursor: data.response_metadata?.next_cursor || null,
    messages,
  });
}

getHistory();
