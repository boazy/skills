import { slackGet, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface SearchMatch {
  iid: string;
  channel: { id: string; name: string };
  username: string;
  text: string;
  ts: string;
  permalink: string;
  thread_ts?: string;
}

interface SearchResponse {
  ok: boolean;
  messages: {
    total: number;
    matches: SearchMatch[];
    paging: {
      count: number;
      total: number;
      page: number;
      pages: number;
    };
  };
}

// ============================================================================
// Main
// ============================================================================

const query = process.argv[2];
const count = process.argv[3] || "20";
const page = process.argv[4] || "1";
const sort = process.argv[5] || "timestamp";
const sortDir = process.argv[6] || "desc";

if (!query) {
  console.log(`Usage: npx tsx slack-search.ts <query> [count] [page] [sort] [sortDir]


Arguments:
  query     Search query (supports Slack search modifiers)
  count     Results per page (default: 20, max: 100)
  page      Page number (default: 1)
  sort      Sort by: timestamp or score (default: timestamp)
  sortDir   Sort direction: asc or desc (default: desc)

Search modifiers:
  from:@username      Messages from a specific user
  in:#channel         Messages in a specific channel
  has:link            Messages containing links
  has:reaction        Messages with reactions
  before:2024-01-01   Messages before a date
  after:2024-01-01    Messages after a date
  during:january      Messages during a month

Examples:
  npx tsx slack-search.ts "deployment issue"
  npx tsx slack-search.ts "from:@john in:#engineering" 50
  npx tsx slack-search.ts "has:reaction after:2024-06-01" 20 1 score
  npx tsx slack-search.ts "error 500 in:#alerts" 10 1 timestamp desc`);
  process.exit(1);
}

async function searchMessages() {
  const params: Record<string, string> = {
    query,
    count,
    page,
    sort,
    sort_dir: sortDir,
  };

  const response = await slackGet<SearchResponse>(
    "search.messages",
    params
  );

  if (!response.ok) {
    exitWithError(response.error || "Search failed");
  }

  const data = response.data!;
  const matches = data.messages.matches.map((m) => ({
    channel: { id: m.channel.id, name: m.channel.name },
    user: m.username,
    text: m.text,
    ts: m.ts,
    thread_ts: m.thread_ts || null,
    permalink: m.permalink,
  }));

  output({
    query,
    total: data.messages.total,
    page: data.messages.paging.page,
    pages: data.messages.paging.pages,
    count: matches.length,
    matches,
  });
}

searchMessages();
