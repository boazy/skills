import { slackUpload, exitWithError, output } from "./lib/slack.ts";

// ============================================================================
// Types
// ============================================================================

interface EmojiResponse {
  ok: boolean;
}

// ============================================================================
// Main
// ============================================================================

const emojiName = process.argv[2];
const filePath = process.argv[3];

if (!emojiName || !filePath) {
  console.log(`Usage: npx tsx slack-emoji-upload.ts <name> <imagePath>

IMPORTANT: Requires Enterprise Grid with admin.emoji:write scope.
           Not available on free or standard paid workspaces.

Arguments:
  name        Emoji name without colons (e.g., my_emoji)
  imagePath   Path to image file (PNG, GIF, or JPEG; max 128KB; square recommended)

Naming rules:
  - Lowercase letters, numbers, hyphens, underscores only
  - Must not conflict with existing emoji names

Examples:
  npx tsx slack-emoji-upload.ts party_parrot ./party_parrot.gif
  npx tsx slack-emoji-upload.ts company_logo ./logo.png`);
  process.exit(1);
}

async function uploadEmoji() {
  // Validate emoji name
  if (!/^[a-z0-9_-]+$/.test(emojiName)) {
    exitWithError(
      "Invalid emoji name. Use only lowercase letters, numbers, hyphens, and underscores."
    );
  }

  const response = await slackUpload<EmojiResponse>(
    "admin.emoji.add",
    { name: emojiName },
    filePath
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to upload emoji");
  }

  output({
    name: emojiName,
    uploaded: true,
    usage: `:${emojiName}:`,
  });
}

uploadEmoji();
