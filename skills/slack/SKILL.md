---
name: slack
description: Read channels, DMs, and threads; post and edit messages; search messages and users; add reactions; upload custom emojis — all via the Slack Web API.
---

# Slack Skill

Interact with Slack workspaces via the Slack Web API. All operations run as the authenticated user (not a bot) — messages you send appear under your name.

## Authentication

App credentials are stored in `~/.local/secrets/slack/skill-credentials.json`.
The user token is stored in `~/.local/secrets/slack/skill.env`.
The setup process creates a Slack app and authenticates via OAuth — all automated.

### First-Time Setup

**Step 1** — Get a configuration token:
1. Visit https://api.slack.com/apps
2. Click **Generate Token**
3. Select the workspace you want to deploy the app on
4. Copy the **Access Token** (starts with `xoxe.xoxp-`)

**Step 2** — Create the Slack app:
```bash
npx tsx scripts/slack-app-create.ts <configToken>
```
This creates the app on the selected workspace and saves credentials locally.

**Step 3** — Authenticate:
```bash
npx tsx scripts/slack-auth.ts
```
This opens your browser for Slack OAuth. Authorize the app and the token is saved automatically.

### Re-authenticate

```bash
npx tsx scripts/slack-auth.ts --force
```

### Manual Token Setup (alternative)

If you already have a user token, you can skip the above and set it directly:
```env
# ~/.local/secrets/slack/skill.env
SLACK_USER_TOKEN=xoxp-your-token-here
```

---

## /slack-setup

When the user invokes `/slack-setup`, follow this workflow:

1. Check if `~/.local/secrets/slack/skill-credentials.json` exists with an `app_id`:
   - **Credentials exist** → Inform the user the app is already set up (show the `app_id`). If they want to recreate, they must delete the credentials file first.
   - **No credentials** → Continue with setup below.

2. Guide the user to obtain a **configuration token**:
   - Direct them to https://api.slack.com/apps
   - Have them click **Generate Token**
   - Ask them to select the workspace they want to deploy on
   - Have them paste the **Access Token** (starts with `xoxe.xoxp-`)

3. Once the user provides the token, create the app:
   ```bash
   npx tsx scripts/slack-app-create.ts <configToken>
   ```

4. After successful creation, proceed to authentication by running `/slack-auth`.
   - **Note**: Some workspaces require admin approval for new apps. If the OAuth page shows the app is pending approval, inform the user and ask them to request approval from their workspace admin. They can run `/slack-auth` again once approved.

## /slack-auth

When the user invokes `/slack-auth`, follow this workflow:

1. Check if `~/.local/secrets/slack/skill-credentials.json` exists with app credentials (`app_id`, `client_id`, `client_secret`):
   - **No credentials or missing fields** → Tell the user to run `/slack-setup` first.
   - **Credentials exist** → Continue below.

2. Check if `~/.local/secrets/slack/skill.env` contains `SLACK_USER_TOKEN`:
   - **Token exists** → Inform user they are already authenticated; offer to re-auth with `--force`.
   - **No token** → Continue below.

3. Ask the user which mode they need:
   - **Local** (same machine running the skill and browser)
   - **Remote** (skill runs on one machine, browser is on another)

4. Run auth according to mode:
   - **Local mode**:
     - Run `npx tsx scripts/slack-auth.ts --local`.
     - Keep it in the background while user authenticates in browser.
     - The callback server auto-closes after 5 minutes of inactivity.
     - If user sees "awaiting approval", tell them to request admin approval and run `/slack-auth` again after approval.
   - **Remote mode**:
     - Run `npx tsx scripts/slack-auth.ts --remote`.
     - Do not run a callback server and do not auto-open a browser.
     - Ask the user to open the OAuth URL manually.
     - Then ask them to either paste the redirected URL, report `WAITING_APPROVAL`, or provide `OAUTH_ERROR:<message>`.
     - Optional non-interactive inputs: `--redirected-url <url>` or `--status WAITING_APPROVAL`.

5. Verify token persistence:
   - Confirm `~/.local/secrets/slack/skill.env` contains `SLACK_USER_TOKEN`.
   - If present, report authentication success.
   - If missing and status is `WAITING_APPROVAL`, report pending approval (not a hard failure).
   - If missing for other reasons, report failure and instruct user to retry `/slack-auth`.

## Available Scripts

All scripts are run from this skill's directory:

```bash
npx tsx scripts/<script>.ts [args]
```

---

### List Channels

```bash
npx tsx scripts/slack-channels.ts list [types] [cursor]
npx tsx scripts/slack-channels.ts info <channelId>
```

**list** — List conversations in the workspace.
- `types`: Comma-separated filter (default: `public_channel,private_channel`). Options: `public_channel`, `private_channel`, `im`, `mpim`.
- `cursor`: Pagination cursor from previous response.

**info** — Get details about a specific channel.

Examples:
- `npx tsx scripts/slack-channels.ts list` — list public and private channels
- `npx tsx scripts/slack-channels.ts list "im,mpim"` — list DMs and group DMs
- `npx tsx scripts/slack-channels.ts info C01ABC123` — get channel details

---

### Read Message History

```bash
npx tsx scripts/slack-history.ts <channelId> [limit] [cursor] [oldest] [latest]
```

Read messages from any conversation (channel, DM, or group DM).

- `channelId`: Channel or DM ID
- `limit`: Max messages (default: 50, max: 1000)
- `cursor`: Pagination cursor
- `oldest`/`latest`: Unix timestamps to bound the time range

Examples:
- `npx tsx scripts/slack-history.ts C01ABC123` — latest 50 messages
- `npx tsx scripts/slack-history.ts D01ABC123 100` — latest 100 DM messages
- `npx tsx scripts/slack-history.ts C01ABC123 50 "" "1700000000"` — messages since timestamp

---

### Read Thread Replies

```bash
npx tsx scripts/slack-threads.ts <channelId> <threadTs> [limit] [cursor]
```

Read all replies in a thread.

- `channelId`: Channel where the thread lives
- `threadTs`: Timestamp of the parent message (from history output)
- `limit`: Max replies (default: 100)

Examples:
- `npx tsx scripts/slack-threads.ts C01ABC123 1700000000.000001`
- `npx tsx scripts/slack-threads.ts C01ABC123 1700000000.000001 200`

---

### Send Messages

```bash
npx tsx scripts/slack-send.ts <channelId> <text> [threadTs]
```

Post a message to a channel, DM, or thread.

- `channelId`: Target channel or DM ID. Use `slack-dm-open.ts` to get DM channel IDs.
- `text`: Message text with Slack mrkdwn formatting (see `docs/message-formatting.md`)
- `threadTs`: Optional parent message timestamp to reply in a thread

Examples:
- `npx tsx scripts/slack-send.ts C01ABC123 "Hello, team!"` — post to channel
- `npx tsx scripts/slack-send.ts C01ABC123 "Agreed" 1700000000.000001` — reply in thread
- `npx tsx scripts/slack-send.ts D01ABC123 "Hey, got a minute?"` — send DM

---

### Open DMs

```bash
npx tsx scripts/slack-dm-open.ts <userIds>
```

Open a DM or group DM conversation. Returns the channel ID to use with `slack-send.ts`.

- `userIds`: Comma-separated user IDs. 1 user = DM, 2–8 users = group DM.

Examples:
- `npx tsx scripts/slack-dm-open.ts U01ABC123` — open DM with one user
- `npx tsx scripts/slack-dm-open.ts U01ABC123,U02DEF456` — open group DM

### Send a New DM Workflow

To send a DM to a user:
1. Find the user: `npx tsx scripts/slack-users.ts search "John"`
2. Open the DM: `npx tsx scripts/slack-dm-open.ts U01ABC123`
3. Send the message: `npx tsx scripts/slack-send.ts D01ABC123 "Hey John!"`

---

### Edit Messages

```bash
npx tsx scripts/slack-edit.ts <channelId> <messageTs> <text>
```

Edit a previously posted message. **Note: you can only edit messages that you have posted.**

- `channelId`: Channel/DM where the message was posted
- `messageTs`: Timestamp of the message to edit (from send output)
- `text`: New message text

Examples:
- `npx tsx scripts/slack-edit.ts C01ABC123 1700000000.000001 "Updated: correct info here"`

---

### Add Reactions

```bash
npx tsx scripts/slack-react.ts <channelId> <messageTs> <emoji>
```

Add an emoji reaction to a message.

- `channelId`: Channel/DM where the message is
- `messageTs`: Timestamp of the message
- `emoji`: Emoji name without colons (e.g., `thumbsup`, `white_check_mark`)

Examples:
- `npx tsx scripts/slack-react.ts C01ABC123 1700000000.000001 thumbsup`
- `npx tsx scripts/slack-react.ts C01ABC123 1700000000.000001 eyes`

---

### Search / List Users

```bash
npx tsx scripts/slack-users.ts list [cursor]
npx tsx scripts/slack-users.ts info <userId>
npx tsx scripts/slack-users.ts email <email>
npx tsx scripts/slack-users.ts search <query>
```

- **list** — List all workspace users (paginated)
- **info** — Get user details by Slack user ID
- **email** — Look up user by email address
- **search** — Search users by name, display name, or email

Examples:
- `npx tsx scripts/slack-users.ts search "John"` — find users matching "John"
- `npx tsx scripts/slack-users.ts email john@company.com` — find user by email
- `npx tsx scripts/slack-users.ts info U01ABC123` — get user profile

---

### Search Messages

```bash
npx tsx scripts/slack-search.ts <query> [count] [page] [sort] [sortDir]
```


- `query`: Search query with optional Slack search modifiers
- `count`: Results per page (default: 20, max: 100)
- `page`: Page number (default: 1)
- `sort`: `timestamp` or `score` (default: `timestamp`)
- `sortDir`: `asc` or `desc` (default: `desc`)

Search modifiers:
- `from:@username` — messages from a specific user
- `in:#channel` — messages in a specific channel
- `has:link` / `has:reaction` — messages with links or reactions
- `before:2024-01-01` / `after:2024-01-01` — date filters
- `during:january` — messages during a time period

Examples:
- `npx tsx scripts/slack-search.ts "deployment issue"`
- `npx tsx scripts/slack-search.ts "from:@john in:#engineering" 50`
- `npx tsx scripts/slack-search.ts "has:reaction after:2024-06-01"`

---

### Upload Custom Emoji

```bash
npx tsx scripts/slack-emoji-upload.ts <name> <imagePath>
```

**Enterprise Grid only** — requires `admin.emoji:write` scope and org-level installation. Not available on free or standard paid Slack workspaces.

- `name`: Emoji name (lowercase, numbers, hyphens, underscores only)
- `imagePath`: Path to image file (PNG, GIF, JPEG; max 128KB; square recommended)

Examples:
- `npx tsx scripts/slack-emoji-upload.ts party_parrot ./party_parrot.gif`
- `npx tsx scripts/slack-emoji-upload.ts company_logo ./logo.png`

---

## Message Formatting

Slack uses **mrkdwn** (not standard Markdown). See `docs/message-formatting.md` for the full reference.

Quick reference:
- Bold: `*bold*`
- Italic: `_italic_`
- Strikethrough: `~strikethrough~`
- Code: `` `code` ``
- Code block: ` ```code``` `
- Blockquote: `> quote`
- Link: `<https://example.com|Link text>`
- User mention: `<@U01ABC123>`
- Channel mention: `<#C01ABC123>`
- Emoji: `:emoji_name:`

## Common Workflows

### Read and respond to a thread
1. Get recent messages: `npx tsx scripts/slack-history.ts C01ABC123 20`
2. Read a thread: `npx tsx scripts/slack-threads.ts C01ABC123 1700000000.000001`
3. Reply: `npx tsx scripts/slack-send.ts C01ABC123 "My response" 1700000000.000001`

### Find a user and DM them
1. Search: `npx tsx scripts/slack-users.ts search "Jane"`
2. Open DM: `npx tsx scripts/slack-dm-open.ts U01ABC123`
3. Send: `npx tsx scripts/slack-send.ts D01ABC123 "Hey Jane, quick question..."`

### Search for messages and react
1. Search: `npx tsx scripts/slack-search.ts "important announcement in:#general"`
2. React: `npx tsx scripts/slack-react.ts C01ABC123 1700000000.000001 white_check_mark`

## Important Notes

- **All actions are performed as you** — messages, reactions, and edits appear under your Slack identity, not a bot.
- **Message timestamps (`ts`)** are used as unique message IDs throughout Slack's API. They look like `1700000000.000001`. You receive them from history, thread, send, and search outputs.
- **Channel IDs** start with `C` (channels), `D` (DMs), or `G` (group DMs/private channels). Always use IDs, not names, when calling scripts.
- **You can only edit your own messages** — `chat.update` will fail on messages posted by other users.
- **Emoji upload is Enterprise-only** — `admin.emoji.add` requires Enterprise Grid with org-level app installation. Not available on standard workspaces.
