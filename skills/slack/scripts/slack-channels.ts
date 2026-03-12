import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface Channel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_private: boolean;
  is_archived: boolean;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
}

interface ListResponse {
  ok: boolean;
  channels: Channel[];
  response_metadata?: { next_cursor?: string };
}

interface InfoResponse {
  ok: boolean;
  channel: Channel & {
    created: number;
    creator: string;
    is_member: boolean;
    is_general: boolean;
  };
}

// ============================================================================
// Main
// ============================================================================

const subcommand = process.argv[2];

if (!subcommand || !["list", "info"].includes(subcommand)) {
  console.log(`Usage: npx tsx slack-channels.ts <subcommand> [args]

Subcommands:
  list [types] [cursor]    List conversations
  info <channelId>         Get channel details

Arguments:
  types     Comma-separated: public_channel,private_channel,im,mpim (default: public_channel,private_channel)
  cursor    Pagination cursor from previous response
  channelId The channel/conversation ID (e.g., C01ABC123)

Examples:
  npx tsx slack-channels.ts list
  npx tsx slack-channels.ts list "public_channel,private_channel,im,mpim"
  npx tsx slack-channels.ts list "im,mpim" "cursor123..."
  npx tsx slack-channels.ts info C01ABC123`);
  process.exit(1);
}

async function listChannels() {
  const types = process.argv[3] || "public_channel,private_channel";
  const cursor = process.argv[4] || undefined;

  const params: Record<string, unknown> = {
    types,
    limit: 200,
    exclude_archived: true,
  };
  if (cursor) {
    params.cursor = cursor;
  }

  const response = await slackPost<ListResponse>("conversations.list", params);

  if (!response.ok) {
    exitWithError(response.error || "Failed to list channels");
  }

  const data = response.data!;
  const channels = data.channels.map((ch) => ({
    id: ch.id,
    name: ch.name,
    type: ch.is_im
      ? "dm"
      : ch.is_mpim
        ? "group_dm"
        : ch.is_private
          ? "private_channel"
          : "public_channel",
    topic: ch.topic?.value || "",
    purpose: ch.purpose?.value || "",
    num_members: ch.num_members ?? null,
    is_archived: ch.is_archived,
  }));

  output({
    count: channels.length,
    next_cursor: data.response_metadata?.next_cursor || null,
    channels,
  });
}

async function getChannelInfo() {
  const channelId = process.argv[3];
  if (!channelId) {
    exitWithError("Channel ID required. Usage: npx tsx slack-channels.ts info <channelId>");
  }

  const response = await slackPost<InfoResponse>("conversations.info", {
    channel: channelId,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to get channel info");
  }

  const ch = response.data!.channel;
  output({
    id: ch.id,
    name: ch.name,
    type: ch.is_im
      ? "dm"
      : ch.is_mpim
        ? "group_dm"
        : ch.is_private
          ? "private_channel"
          : "public_channel",
    topic: ch.topic?.value || "",
    purpose: ch.purpose?.value || "",
    num_members: ch.num_members ?? null,
    is_archived: ch.is_archived,
    created: ch.created,
    creator: ch.creator,
    is_member: ch.is_member,
    is_general: ch.is_general,
  });
}

if (subcommand === "list") {
  listChannels();
} else if (subcommand === "info") {
  getChannelInfo();
}
