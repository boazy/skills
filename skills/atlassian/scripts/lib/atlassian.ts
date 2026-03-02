import { config } from "dotenv";
import { resolve } from "path";
import os from "os";

// Load atlassian.env file from ~/.local/secrets/atlassian.env
config({ path: resolve(os.homedir(), ".local/secrets/atlassian.env") });

// ============================================================================
// Configuration
// ============================================================================

export interface AtlassianConfig {
  site: string;
  email: string;
  apiToken: string;
}

export function getConfig(): AtlassianConfig {
  const site = process.env.ATLASSIAN_SITE;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!site) {
    exitWithError(
      "ATLASSIAN_SITE not set. Add to .env: ATLASSIAN_SITE=yourcompany.atlassian.net"
    );
  }

  if (!email) {
    exitWithError(
      "ATLASSIAN_EMAIL not set. Add to .env: ATLASSIAN_EMAIL=you@example.com"
    );
  }

  if (!apiToken) {
    exitWithError(
      "ATLASSIAN_API_TOKEN not set. Generate at: https://id.atlassian.com/manage-profile/security/api-tokens"
    );
  }

  return { site, email, apiToken };
}

// ============================================================================
// HTTP Client
// ============================================================================

function getAuthHeader(cfg: AtlassianConfig): string {
  const credentials = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString(
    "base64"
  );
  return `Basic ${credentials}`;
}

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
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: getAuthHeader(cfg),
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

    if (response.status === 204) {
      return { ok: true };
    }

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
// Jira API
// ============================================================================

export async function jiraGet<T>(
  endpoint: string,
  params?: Record<string, string | string[]>
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  let url = `https://${cfg.site}/rest/api/3/${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(key, v));
      } else {
        searchParams.append(key, value);
      }
    }
    url += `?${searchParams}`;
  }
  return request<T>(url, cfg);
}

export async function jiraPost<T>(
  endpoint: string,
  body: unknown
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/rest/api/3/${endpoint}`;
  return request<T>(url, cfg, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function jiraPut<T>(
  endpoint: string,
  body: unknown
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/rest/api/3/${endpoint}`;
  return request<T>(url, cfg, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Confluence API (v2)
// ============================================================================

export async function confluenceGet<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  let url = `https://${cfg.site}/wiki/api/v2/${endpoint}`;
  if (params) {
    url += `?${new URLSearchParams(params)}`;
  }
  return request<T>(url, cfg);
}

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

export async function confluenceDelete<T>(
  endpoint: string
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/wiki/api/v2/${endpoint}`;
  return request<T>(url, cfg, {
    method: "DELETE",
  });
}

// Confluence legacy API (v1) - needed for CQL search
export async function confluenceLegacyGet<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  let url = `https://${cfg.site}/wiki/rest/api/${endpoint}`;
  if (params) {
    url += `?${new URLSearchParams(params)}`;
  }
  return request<T>(url, cfg);
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

export function getSiteUrl(): string {
  return `https://${getConfig().site}`;
}

type AdfMark =
  | { type: "code" }
  | { type: "link"; attrs: { href: string } }
  | { type: "strong" }
  | { type: "em" }
  | { type: "strike" }
  | { type: "underline" };

type AdfTextNode = { type: "text"; text: string; marks?: AdfMark[] };
type AdfNode = Record<string, unknown>;

function textNode(text: string): AdfTextNode {
  return { type: "text", text };
}

function paragraphNode(text: string): AdfNode {
  return {
    type: "paragraph",
    content: text.length > 0 ? parseInlineMarkdown(text) : [],
  };
}

function parseInlineMarkdown(text: string): AdfTextNode[] {
  if (!text) {
    return [];
  }

  const out: AdfTextNode[] = [];
  const pattern =
    /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|\+\+([^+]+)\+\+|<u>([^<]+)<\/u>/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(textNode(text.slice(last, match.index)));
    }

    if (match[1] !== undefined) {
      out.push({ type: "text", text: match[1], marks: [{ type: "code" }] });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      out.push({
        type: "text",
        text: match[2],
        marks: [{ type: "link", attrs: { href: match[3] } }],
      });
    } else if (match[4] !== undefined) {
      out.push({
        type: "text",
        text: match[4],
        marks: [{ type: "strong" }, { type: "em" }],
      });
    } else if (match[5] !== undefined) {
      out.push({ type: "text", text: match[5], marks: [{ type: "strong" }] });
    } else if (match[6] !== undefined) {
      out.push({ type: "text", text: match[6], marks: [{ type: "strong" }] });
    } else if (match[7] !== undefined) {
      out.push({ type: "text", text: match[7], marks: [{ type: "em" }] });
    } else if (match[8] !== undefined) {
      out.push({ type: "text", text: match[8], marks: [{ type: "em" }] });
    } else if (match[9] !== undefined) {
      out.push({ type: "text", text: match[9], marks: [{ type: "strike" }] });
    } else if (match[10] !== undefined) {
      out.push({ type: "text", text: match[10], marks: [{ type: "underline" }] });
    } else if (match[11] !== undefined) {
      out.push({ type: "text", text: match[11], marks: [{ type: "underline" }] });
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    out.push(textNode(text.slice(last)));
  }

  return out;
}

function flushParagraph(paragraphLines: string[], content: AdfNode[]): void {
  if (paragraphLines.length === 0) {
    return;
  }

  const text = paragraphLines.join("\n").trim();
  if (text.length > 0) {
    content.push(paragraphNode(text));
  }
  paragraphLines.length = 0;
}

function flushBulletList(bulletItems: string[], content: AdfNode[]): void {
  if (bulletItems.length === 0) {
    return;
  }

  content.push({
    type: "bulletList",
    content: bulletItems.map((item) => ({
      type: "listItem",
      content: [paragraphNode(item)],
    })),
  });
  bulletItems.length = 0;
}

function flushOrderedList(orderedItems: string[], content: AdfNode[]): void {
  if (orderedItems.length === 0) {
    return;
  }

  content.push({
    type: "orderedList",
    content: orderedItems.map((item) => ({
      type: "listItem",
      content: [paragraphNode(item)],
    })),
  });
  orderedItems.length = 0;
}

export function markdownToAdf(markdown: string): AdfNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: AdfNode[] = [];

  const paragraphLines: string[] = [];
  const bulletItems: string[] = [];
  const orderedItems: string[] = [];

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  for (const line of lines) {
    const codeFenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (codeFenceMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);

      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = codeFenceMatch[1] ?? "";
        codeLines = [];
      } else {
        content.push({
          type: "codeBlock",
          attrs: codeLanguage ? { language: codeLanguage } : undefined,
          content: [textNode(codeLines.join("\n"))],
        });
        inCodeBlock = false;
        codeLanguage = "";
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2].trim()),
      });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph(paragraphLines, content);
      flushOrderedList(orderedItems, content);
      bulletItems.push(bulletMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      orderedItems.push(orderedMatch[1].trim());
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      continue;
    }

    flushBulletList(bulletItems, content);
    flushOrderedList(orderedItems, content);
    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    content.push({
      type: "codeBlock",
      attrs: codeLanguage ? { language: codeLanguage } : undefined,
      content: [textNode(codeLines.join("\n"))],
    });
  }

  flushParagraph(paragraphLines, content);
  flushBulletList(bulletItems, content);
  flushOrderedList(orderedItems, content);

  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [paragraphNode("")],
  };
}
