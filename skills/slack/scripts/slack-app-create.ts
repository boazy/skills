import {
  CREDENTIALS_FILE,
  OAUTH_REDIRECT_URI,
  USER_SCOPES,
  writeCredentials,
  readCredentials,
  exitWithError,
} from "./lib/slack.ts";

// ============================================================================
// Manifest
// ============================================================================

const APP_MANIFEST = {
  _metadata: { major_version: 2, minor_version: 1 },
  display_information: {
    name: "Agent Slack Skill",
    description:
      "AI agent integration — read, post, search, and react in Slack",
    background_color: "#4A154B",
  },
  oauth_config: {
    redirect_urls: [OAUTH_REDIRECT_URI],
    scopes: { user: USER_SCOPES },
  },
  settings: {
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
};

// ============================================================================
// Main
// ============================================================================

const configToken = process.argv[2];

if (!configToken) {
  console.log(`Usage: npx tsx slack-app-create.ts <configToken>

Creates a new Slack app for this skill using the Slack Manifest API.
The app is configured with all required OAuth scopes and a localhost
redirect URI for the authentication flow.

Arguments:
  configToken  App Configuration Access Token from Slack admin

To get a configuration token:
  1. Visit https://api.slack.com/apps
  2. Click "Generate Token"
  3. Select the workspace you want to deploy the app on
  4. Copy the Access Token (starts with xoxe-)

After creation, run slack-auth.ts to authenticate.`);
  process.exit(1);
}

async function createApp() {
  // Check if app already exists
  const existing = readCredentials();
  if (existing?.app_id) {
    console.log(`An app already exists (app_id: ${existing.app_id}).`);
    console.log(`Credentials file: ${CREDENTIALS_FILE}`);
    console.log(
      "\nTo create a new app, delete the credentials file first and re-run."
    );
    process.exit(1);
  }

  console.log("Creating Slack app via Manifest API...\n");

  const response = await fetch("https://slack.com/api/apps.manifest.create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ manifest: JSON.stringify(APP_MANIFEST) }),
  });

  const data = await response.json();

  if (!data.ok) {
    if (data.error === "invalid_auth") {
      exitWithError(
        "Invalid or expired configuration token.\n" +
          "  Generate a fresh token at: https://api.slack.com/apps"
      );
    }
    console.error(`Slack API error: ${data.error}`);
    if (data.errors) {
      console.error("Details:", JSON.stringify(data.errors, null, 2));
    }
    process.exit(1);
  }

  await writeCredentials({
    app_id: data.app_id,
    client_id: data.credentials.client_id,
    client_secret: data.credentials.client_secret,
    signing_secret: data.credentials.signing_secret,
  });

  console.log("App created successfully!");
  console.log(`  App ID:     ${data.app_id}`);
  console.log(`  Client ID:  ${data.credentials.client_id}`);
  console.log(`  Saved to:   ${CREDENTIALS_FILE}`);
  console.log("\nNext step — authenticate with OAuth:");
  console.log("  npx tsx scripts/slack-auth.ts");
}

createApp();
