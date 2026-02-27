import { config } from "dotenv";
import { resolve } from "path";
import os from "os";

config({ path: resolve(os.homedir(), ".local/secrets/atlassian.env") });

// ============================================================================
// Configuration
// ============================================================================

interface AtlassianConfig {
  site: string;
  email: string;
  apiToken: string;
}

function getConfig(): AtlassianConfig {
  const site = process.env.ATLASSIAN_SITE;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!site || !email || !apiToken) {
    console.error(
      "Error: Missing Atlassian credentials in ~/.local/secrets/atlassian.env"
    );
    process.exit(1);
  }

  return { site, email, apiToken };
}

// ============================================================================
// HTTP Client
// ============================================================================

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

async function request<T>(
  url: string,
  cfg: AtlassianConfig,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const credentials = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString(
      "base64"
    );
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.errorMessages?.join(", ") ||
          errorJson.message ||
          errorJson.errorMessage ||
          errorText;
      } catch {
        errorMessage = errorText;
      }
      return {
        ok: false,
        error: `API error (${response.status}): ${errorMessage}`,
        status: response.status,
      };
    }

    if (response.status === 204) return { ok: true };

    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Confluence API
// ============================================================================

/** Confluence REST API v2 — GET */
export async function confluenceGet<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  let url = `https://${cfg.site}/wiki/api/v2/${endpoint}`;
  if (params) url += `?${new URLSearchParams(params)}`;
  return request<T>(url, cfg);
}

/** Confluence REST API v2 — POST */
export async function confluencePost<T>(
  endpoint: string,
  body: unknown
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/wiki/api/v2/${endpoint}`;
  return request<T>(url, cfg, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Confluence REST API v2 — PUT */
export async function confluencePut<T>(
  endpoint: string,
  body: unknown
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/wiki/api/v2/${endpoint}`;
  return request<T>(url, cfg, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Legacy Confluence REST API (v1) — needed for CQL search */
export async function confluenceLegacyGet<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  let url = `https://${cfg.site}/wiki/rest/api/${endpoint}`;
  if (params) url += `?${new URLSearchParams(params)}`;
  return request<T>(url, cfg);
}

// ============================================================================
// Utilities
// ============================================================================

export function getSiteUrl(): string {
  return `https://${getConfig().site}`;
}

export function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
