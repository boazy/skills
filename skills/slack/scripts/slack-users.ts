import { slackPost, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile: {
    display_name?: string;
    email?: string;
    title?: string;
    status_text?: string;
    status_emoji?: string;
    image_72?: string;
  };
  is_admin?: boolean;
  is_owner?: boolean;
  is_bot?: boolean;
  deleted?: boolean;
  tz?: string;
}

interface UsersListResponse {
  ok: boolean;
  members: SlackUser[];
  response_metadata?: { next_cursor?: string };
}

interface UserInfoResponse {
  ok: boolean;
  user: SlackUser;
}

interface LookupResponse {
  ok: boolean;
  user: SlackUser;
}

// ============================================================================
// Main
// ============================================================================

const subcommand = process.argv[2];

if (!subcommand || !["list", "info", "email", "search"].includes(subcommand)) {
  console.log(`Usage: npx tsx slack-users.ts <subcommand> [args]

Subcommands:
  list [cursor]            List all workspace users
  info <userId>            Get user details by ID
  email <email>            Find user by email address
  search <query>           Search users by name/display name

Arguments:
  cursor   Pagination cursor from previous response
  userId   Slack user ID (e.g., U01ABC123)
  email    Email address (e.g., user@company.com)
  query    Search term to match against name/display_name/email

Examples:
  npx tsx slack-users.ts list
  npx tsx slack-users.ts list "cursor123..."
  npx tsx slack-users.ts info U01ABC123
  npx tsx slack-users.ts email user@company.com
  npx tsx slack-users.ts search "John"`);
  process.exit(1);
}

function formatUser(u: SlackUser) {
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name || "",
    display_name: u.profile.display_name || "",
    email: u.profile.email || "",
    title: u.profile.title || "",
    is_bot: u.is_bot || false,
    is_admin: u.is_admin || false,
    deleted: u.deleted || false,
    tz: u.tz || "",
  };
}

async function listUsers() {
  const cursor = process.argv[3] || undefined;

  const params: Record<string, unknown> = { limit: 200 };
  if (cursor) {
    params.cursor = cursor;
  }

  const response = await slackPost<UsersListResponse>("users.list", params);

  if (!response.ok) {
    exitWithError(response.error || "Failed to list users");
  }

  const data = response.data!;
  const users = data.members
    .filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT")
    .map(formatUser);

  output({
    count: users.length,
    next_cursor: data.response_metadata?.next_cursor || null,
    users,
  });
}

async function getUserInfo() {
  const userId = process.argv[3];
  if (!userId) {
    exitWithError("User ID required. Usage: npx tsx slack-users.ts info <userId>");
  }

  const response = await slackPost<UserInfoResponse>("users.info", {
    user: userId,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to get user info");
  }

  output(formatUser(response.data!.user));
}

async function lookupByEmail() {
  const email = process.argv[3];
  if (!email) {
    exitWithError("Email required. Usage: npx tsx slack-users.ts email <email>");
  }

  const response = await slackPost<LookupResponse>("users.lookupByEmail", {
    email,
  });

  if (!response.ok) {
    exitWithError(response.error || "Failed to lookup user by email");
  }

  output(formatUser(response.data!.user));
}

async function searchUsers() {
  const query = process.argv[3];
  if (!query) {
    exitWithError("Search query required. Usage: npx tsx slack-users.ts search <query>");
  }

  // Slack doesn't have a users.search API — fetch all and filter locally
  const allUsers: SlackUser[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, unknown> = { limit: 200 };
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await slackPost<UsersListResponse>("users.list", params);

    if (!response.ok) {
      exitWithError(response.error || "Failed to list users for search");
    }

    const data = response.data!;
    allUsers.push(...data.members);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const q = query.toLowerCase();
  const matches = allUsers
    .filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT")
    .filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.real_name || "").toLowerCase().includes(q) ||
        (u.profile.display_name || "").toLowerCase().includes(q) ||
        (u.profile.email || "").toLowerCase().includes(q)
    )
    .map(formatUser);

  output({
    query,
    count: matches.length,
    users: matches,
  });
}

if (subcommand === "list") {
  listUsers();
} else if (subcommand === "info") {
  getUserInfo();
} else if (subcommand === "email") {
  lookupByEmail();
} else if (subcommand === "search") {
  searchUsers();
}
