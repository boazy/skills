import { config } from "dotenv";
import { readFile } from "fs/promises";
import { readFileSync } from "fs";
import { basename, resolve } from "path";
import os from "os";

// Load skill.env (user token + any overrides)
config({ path: resolve(os.homedir(), ".local/secrets/slack/skill.env") });

// ============================================================================
// Shared Constants
// ============================================================================

export const CREDENTIALS_DIR = resolve(os.homedir(), ".local/secrets/slack");
export const CREDENTIALS_FILE = resolve(CREDENTIALS_DIR, "skill-credentials.json");
export const ENV_FILE = resolve(CREDENTIALS_DIR, "skill.env");
export const OAUTH_PORT = 51234;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_PORT}/slack/oauth/callback`;

export const USER_SCOPES = [
  "channels:read", "groups:read", "im:read", "mpim:read",
  "channels:history", "groups:history", "im:history", "mpim:history",
  "chat:write",
  "im:write", "mpim:write",
  "reactions:write",
  "users:read", "users:read.email",
  "search:read",
];

// ============================================================================
// Credentials
// ============================================================================

export interface SkillCredentials {
  app_id: string;
  client_id: string;
  client_secret: string;
  signing_secret: string;
  team?: { id: string; name: string };
  user?: { id: string };
  authed_at?: string;
}

export function readCredentials(): SkillCredentials | null {
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as SkillCredentials;
  } catch {
    return null;
  }
}

export async function writeCredentials(creds: SkillCredentials): Promise<void> {
  const { mkdir, writeFile } = await import("fs/promises");
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + "\n");
}

export async function writeEnvToken(token: string): Promise<void> {
  const { mkdir, writeFile } = await import("fs/promises");
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(ENV_FILE, `SLACK_USER_TOKEN=${token}\n`);
}

// ============================================================================
// Configuration
// ============================================================================

export interface SlackConfig {
  token: string;
}

export function getConfig(): SlackConfig {
  const token = process.env.SLACK_USER_TOKEN;
  if (token) {
    return { token };
  }

  exitWithError(
    "No Slack user token found.\n" +
    "  Run /slack-setup to create the app and authenticate.\n" +
    "  Or manually set SLACK_USER_TOKEN in ~/.local/secrets/slack/skill.env"
  );
}

// ============================================================================
// HTTP Client
// ============================================================================

const SLACK_API_BASE = "https://slack.com/api";

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Call a Slack Web API method via POST with JSON body.
 * Most Slack methods accept POST — use this as the default.
 */
export async function slackPost<T>(
  method: string,
  body: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const { token } = getConfig();

  try {
    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!data.ok) {
      return { ok: false, error: `Slack API error: ${data.error}` };
    }

    return { ok: true, data: data as T };
  } catch (error) {
    return {
      ok: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Call a Slack Web API method via GET with query parameters.
 * Used for search endpoints and other GET-only methods.
 */
export async function slackGet<T>(
  method: string,
  params?: Record<string, string>
): Promise<ApiResponse<T>> {
  const { token } = getConfig();

  try {
    let url = `${SLACK_API_BASE}/${method}`;
    if (params) {
      url += `?${new URLSearchParams(params)}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();

    if (!data.ok) {
      return { ok: false, error: `Slack API error: ${data.error}` };
    }

    return { ok: true, data: data as T };
  } catch (error) {
    return {
      ok: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Upload a file via multipart/form-data POST.
 * Used for emoji upload (admin.emoji.add).
 */
export async function slackUpload<T>(
  method: string,
  fields: Record<string, string>,
  filePath: string,
  fileFieldName: string = "image"
): Promise<ApiResponse<T>> {
  const { token } = getConfig();

  try {
    const bytes = await readFile(filePath);
    const form = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }

    const name = basename(filePath);
    form.append(fileFieldName, new Blob([bytes]), name);

    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await response.json();

    if (!data.ok) {
      return { ok: false, error: `Slack API error: ${data.error}` };
    }

    return { ok: true, data: data as T };
  } catch (error) {
    return {
      ok: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function parseJsonArg<T>(arg: string, name: string): T {
  try {
    return JSON.parse(arg) as T;
  } catch {
    exitWithError(`Invalid JSON for ${name}: ${arg}`);
  }
}
