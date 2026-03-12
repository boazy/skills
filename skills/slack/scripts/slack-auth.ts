import http from "http";
import { exec } from "child_process";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import {
  CREDENTIALS_FILE,
  ENV_FILE,
  OAUTH_PORT,
  OAUTH_REDIRECT_URI,
  USER_SCOPES,
  readCredentials,
  writeCredentials,
  writeEnvToken,
  type SkillCredentials,
} from "./lib/slack.ts";

const LOCAL_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type InstallMode = "local" | "remote";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Error: ${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

function getInstallModeFromArgs(): InstallMode | null {
  const hasLocal = hasFlag("--local");
  const hasRemote = hasFlag("--remote");

  if (hasLocal && hasRemote) {
    console.error("Error: Use only one of --local or --remote.");
    process.exit(1);
  }

  if (hasLocal) {
    return "local";
  }
  if (hasRemote) {
    return "remote";
  }
  return null;
}

async function askInstallMode(): Promise<InstallMode> {
  const modeFromArgs = getInstallModeFromArgs();
  if (modeFromArgs) {
    return modeFromArgs;
  }

  if (!input.isTTY || !output.isTTY) {
    console.log("No interactive terminal detected. Defaulting to local mode.");
    console.log("Use --remote to force remote mode.");
    return "local";
  }

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(
        "Is this authentication local or remote? [local/remote] (default: local): "
      ))
        .trim()
        .toLowerCase();

      if (!answer || answer === "local" || answer === "l") {
        return "local";
      }
      if (answer === "remote" || answer === "r") {
        return "remote";
      }
      console.log("Please answer 'local' or 'remote'.");
    }
  } finally {
    rl.close();
  }
}

function parseRedirectedUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    if (raw.startsWith("/")) {
      return new URL(raw, `http://localhost:${OAUTH_PORT}`);
    }
    throw new Error("Invalid URL. Paste the full redirected URL from your browser.");
  }
}

async function persistAuthResult(creds: SkillCredentials, token: any): Promise<void> {
  await writeEnvToken(token.authed_user.access_token);
  creds.team = token.team;
  creds.user = { id: token.authed_user.id };
  creds.authed_at = new Date().toISOString();
  await writeCredentials(creds);

  console.log("\nAuthentication successful!");
  console.log(`  Workspace: ${token.team?.name || "Unknown"} (${token.team?.id})`);
  console.log(`  User:      ${token.authed_user.id}`);
  console.log(`  Token:     ${ENV_FILE}`);
  console.log(`  Metadata:  ${CREDENTIALS_FILE}`);
}

async function runRemoteFlow(creds: SkillCredentials, oauthUrl: string): Promise<void> {
  console.log("Remote mode selected.");
  console.log("Open this URL in the browser on the target machine:\n");
  console.log(oauthUrl);
  console.log("");
  console.log("After you finish in the browser, reply with ONE of these:");
  console.log("  1) Paste the redirected URL from the browser address bar");
  console.log("  2) WAITING_APPROVAL");
  console.log("  3) OAUTH_ERROR:<message>");

  const providedStatus = getArgValue("--status");
  const providedRedirectedUrl = getArgValue("--redirected-url");

  let answer = "";
  if (providedStatus) {
    answer = providedStatus.trim();
  } else if (providedRedirectedUrl) {
    answer = providedRedirectedUrl.trim();
  } else {
    if (!input.isTTY || !output.isTTY) {
      throw new Error(
        "Remote mode requires either interactive input or --status / --redirected-url."
      );
    }

    const rl = readline.createInterface({ input, output });
    try {
      answer = (await rl.question("\nPaste redirect URL or status: ")).trim();
    } finally {
      rl.close();
    }
  }

  if (!answer) {
    throw new Error("No input provided.");
  }

  if (answer.toUpperCase() === "WAITING_APPROVAL") {
    console.log("Slack app is pending admin approval.");
    console.log("Request approval, then run /slack-auth again.");
    return;
  }

  if (answer.toUpperCase().startsWith("OAUTH_ERROR:")) {
    const message = answer.slice("OAUTH_ERROR:".length).trim() || "Unknown OAuth error";
    throw new Error(message);
  }

  const redirectedUrl = parseRedirectedUrl(answer);
  const error = redirectedUrl.searchParams.get("error");
  if (error) {
    throw new Error(`Authentication denied: ${error}`);
  }

  const code = redirectedUrl.searchParams.get("code");
  if (!code) {
    throw new Error("No authorization code found in redirected URL.");
  }

  console.log("Exchanging authorization code for token...");
  const token = await exchangeCode(creds, code);
  if (!token.ok) {
    throw new Error(token.error || "Token exchange failed");
  }

  await persistAuthResult(creds, token);
}

async function runLocalFlow(creds: SkillCredentials, oauthUrl: string): Promise<void> {
  return new Promise<void>((done, fail) => {
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;

    const settle = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (error) {
        fail(error);
      } else {
        done();
      }
    };

    const server = http.createServer(async (req, res) => {
      armTimeout();

      const url = new URL(req.url!, `http://localhost:${OAUTH_PORT}`);
      if (url.pathname !== "/slack/oauth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(error));
        console.error(`\nAuthentication denied: ${error}`);
        server.close(() => settle(new Error(error)));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorHtml("No authorization code received"));
        server.close(() => settle(new Error("No authorization code received")));
        return;
      }

      try {
        console.log("Exchanging authorization code for token...");
        const token = await exchangeCode(creds, code);

        if (!token.ok) {
          throw new Error(token.error || "Token exchange failed");
        }

        await persistAuthResult(creds, token);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SUCCESS_HTML);
        server.close(() => settle());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(msg));
        console.error(`\nToken exchange failed: ${msg}`);
        server.close(() => settle(err));
      }
    });

    const armTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        console.error(
          `No OAuth callback received for 5 minutes. Shutting down server on port ${OAUTH_PORT}.`
        );
        console.error(
          "If Slack shows this app is awaiting admin approval, request approval and run /slack-auth again after approval."
        );
        server.close(() => settle(new Error("OAuth callback timeout")));
      }, LOCAL_AUTH_TIMEOUT_MS);
    };

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Error: Port ${OAUTH_PORT} is already in use. Close the other process and retry.`
        );
      } else {
        console.error(`Server error: ${err.message}`);
      }
      settle(err);
    });

    server.listen(OAUTH_PORT, () => {
      armTimeout();
      console.log(`OAuth callback server listening on localhost:${OAUTH_PORT}`);
      console.log("\nOpen this URL in your browser to authenticate:\n");
      console.log(oauthUrl);
      console.log("\nWaiting for authentication callback...");
      console.log(
        "If Slack shows this app is awaiting admin approval, request approval and run /slack-auth again after approval."
      );
      console.log(
        `Server auto-timeout: 5 minutes of inactivity. On success, SLACK_USER_TOKEN is written to ${ENV_FILE}`
      );

      exec(`open "${oauthUrl}"`, () => {});
    });
  });
}

// ============================================================================
// HTML templates
// ============================================================================

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Slack Auth</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f4">
<div style="text-align:center;background:#fff;padding:40px 60px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="color:#2eb67d;font-size:48px">&#10003;</div>
  <h2>Authentication Successful</h2>
  <p style="color:#666">You can close this tab and return to your terminal.</p>
</div></body></html>`;

function errorHtml(msg: string) {
  return `<!DOCTYPE html>
<html><head><title>Slack Auth Error</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f4">
<div style="text-align:center;background:#fff;padding:40px 60px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="color:#e01e5a;font-size:48px">&#10007;</div>
  <h2>Authentication Failed</h2>
  <p style="color:#666">${msg}</p>
</div></body></html>`;
}

// ============================================================================
// OAuth token exchange
// ============================================================================

async function exchangeCode(creds: SkillCredentials, code: string) {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });
  return response.json();
}

// ============================================================================
// Main
// ============================================================================

async function startAuthFlow() {
  const creds = readCredentials();
  if (!creds?.client_id || !creds?.client_secret) {
    console.error(`Error: No app credentials found at ${CREDENTIALS_FILE}`);
    console.error("Run slack-app-create.ts first to create the Slack app.");
    process.exit(1);
  }

  if (process.env.SLACK_USER_TOKEN) {
    console.log("Already authenticated.");
    console.log(`  Workspace: ${creds.team?.name || "Unknown"} (${creds.team?.id || "?"})`);
    console.log(`  User:      ${creds.user?.id || "Unknown"}`);
    console.log(`  Since:     ${creds.authed_at || "Unknown"}`);
    console.log(`\nTo re-authenticate, pass --force`);
    if (!process.argv.includes("--force")) {
      process.exit(0);
    }
    console.log("\nRe-authenticating...\n");
  }

  const oauthUrl =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${encodeURIComponent(creds.client_id)}` +
    `&user_scope=${encodeURIComponent(USER_SCOPES.join(","))}` +
    `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}`;

  const mode = await askInstallMode();
  if (mode === "remote") {
    await runRemoteFlow(creds, oauthUrl);
    return;
  }

  await runLocalFlow(creds, oauthUrl);
}

startAuthFlow().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
