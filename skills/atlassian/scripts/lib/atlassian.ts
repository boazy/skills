import { config } from "dotenv";
import { readFile } from "fs/promises";
import { basename, resolve } from "path";
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

export async function jiraUploadAttachment<T>(
  issueKey: string,
  filePath: string,
  fileName?: string
): Promise<ApiResponse<T>> {
  const cfg = getConfig();
  const url = `https://${cfg.site}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`;

  try {
    const bytes = await readFile(filePath);
    const form = new FormData();
    const name = fileName && fileName.length > 0 ? fileName : basename(filePath);
    form.append("file", new Blob([bytes]), name);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(cfg),
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: form,
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
    /`([^`]+)`|!\[([^\]]*)\]\(([^\s)]+)\)|\[([^\]]+)\]\(([^\s)]+)\)|\[\^([^\]]+)\]|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|\+\+([^+]+)\+\+|<u>([^<]+)<\/u>/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(textNode(text.slice(last, match.index)));
    }

    if (match[1] !== undefined) {
      out.push({ type: "text", text: match[1], marks: [{ type: "code" }] });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const label = match[2].length > 0 ? match[2] : match[3];
      out.push({
        type: "text",
        text: label,
        marks: [{ type: "link", attrs: { href: match[3] } }],
      });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      out.push({
        type: "text",
        text: match[4],
        marks: [{ type: "link", attrs: { href: match[5] } }],
      });
    } else if (match[6] !== undefined) {
      out.push({
        type: "text",
        text: `[${match[6]}]`,
        marks: [{ type: "link", attrs: { href: `#footnote-${match[6]}` } }],
      });
    } else if (match[7] !== undefined) {
      out.push({
        type: "text",
        text: match[7],
        marks: [{ type: "strong" }, { type: "em" }],
      });
    } else if (match[8] !== undefined) {
      out.push({ type: "text", text: match[8], marks: [{ type: "strong" }] });
    } else if (match[9] !== undefined) {
      out.push({ type: "text", text: match[9], marks: [{ type: "strong" }] });
    } else if (match[10] !== undefined) {
      out.push({ type: "text", text: match[10], marks: [{ type: "em" }] });
    } else if (match[11] !== undefined) {
      out.push({ type: "text", text: match[11], marks: [{ type: "em" }] });
    } else if (match[12] !== undefined) {
      out.push({ type: "text", text: match[12], marks: [{ type: "strike" }] });
    } else if (match[13] !== undefined) {
      out.push({ type: "text", text: match[13], marks: [{ type: "underline" }] });
    } else if (match[14] !== undefined) {
      out.push({ type: "text", text: match[14], marks: [{ type: "underline" }] });
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

function flushTaskList(taskItems: Array<{ done: boolean; text: string }>, content: AdfNode[]): void {
  if (taskItems.length === 0) {
    return;
  }

  content.push({
    type: "bulletList",
    content: taskItems.map((item) => ({
      type: "listItem",
      content: [paragraphNode(`${item.done ? "[x]" : "[ ]"} ${item.text}`)],
    })),
  });

  taskItems.length = 0;
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function isPotentialTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.length > 0;
}

function tableCellNode(cell: string, header: boolean): AdfNode {
  return {
    type: header ? "tableHeader" : "tableCell",
    content: [paragraphNode(cell)],
  };
}

function parseAlertType(alert: string): string {
  const upper = alert.toUpperCase();
  if (upper === "NOTE") {
    return "info";
  }
  if (upper === "TIP") {
    return "success";
  }
  if (upper === "IMPORTANT" || upper === "WARNING") {
    return "warning";
  }
  if (upper === "CAUTION") {
    return "error";
  }
  return "info";
}

function isAtlassianImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const siteHost = getConfig().site.toLowerCase();

    return (
      host === siteHost ||
      host.endsWith(`.${siteHost}`) ||
      host.endsWith(".atlassian.net") ||
      host.endsWith(".atlassian.com")
    );
  } catch {
    return false;
  }
}

export function markdownToAdf(markdown: string): AdfNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: AdfNode[] = [];

  const paragraphLines: string[] = [];
  const bulletItems: string[] = [];
  const orderedItems: string[] = [];
  const taskItems: Array<{ done: boolean; text: string }> = [];
  const footnotes = new Map<string, string>();

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const footnoteMatch = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (footnoteMatch) {
      const key = footnoteMatch[1];
      const parts = [footnoteMatch[2]];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}.+/.test(lines[j])) {
        parts.push(lines[j].trim());
        j += 1;
      }
      footnotes.set(key, parts.join(" ").trim());
      i = j;
      continue;
    }

    const codeFenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (codeFenceMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);

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
      i += 1;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (/^<details>\s*$/i.test(line.trim())) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);

      const block: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^<\/details>\s*$/i.test(lines[j].trim())) {
        block.push(lines[j]);
        j += 1;
      }

      let title = "Details";
      if (block.length > 0) {
        const summary = block[0].match(/^<summary>(.*)<\/summary>$/i);
        if (summary) {
          title = summary[1].trim() || title;
          block.shift();
        }
      }

      const nested = markdownToAdf(block.join("\n")) as { content?: AdfNode[] };
      content.push({
        type: "expand",
        attrs: { title },
        content: nested.content ?? [],
      });

      i = j < lines.length ? j + 1 : j;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);

      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length && /^>\s?/.test(lines[j])) {
        quoteLines.push(lines[j].replace(/^>\s?/, ""));
        j += 1;
      }

      const alertMatch = quoteLines[0]?.match(/^\[!([A-Za-z]+)\]\s*(.*)$/);
      if (alertMatch) {
        const panelType = parseAlertType(alertMatch[1]);
        const bodyLines = [...quoteLines];
        bodyLines[0] = alertMatch[2] ?? "";
        const nested = markdownToAdf(bodyLines.join("\n")) as { content?: AdfNode[] };
        content.push({ type: "panel", attrs: { panelType }, content: nested.content ?? [] });
      } else {
        const nested = markdownToAdf(quoteLines.join("\n")) as { content?: AdfNode[] };
        content.push({ type: "blockquote", content: nested.content ?? [] });
      }

      i = j;
      continue;
    }

    if (isPotentialTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);

      const headers = parseTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isPotentialTableRow(lines[j]) && !isTableSeparator(lines[j])) {
        rows.push(parseTableRow(lines[j]));
        j += 1;
      }

      content.push({
        type: "table",
        attrs: { isNumberColumnEnabled: false, layout: "default" },
        content: [
          {
            type: "tableRow",
            content: headers.map((h) => tableCellNode(h, true)),
          },
          ...rows.map((r) => ({
            type: "tableRow",
            content: r.map((c) => tableCellNode(c, false)),
          })),
        ],
      });

      i = j;
      continue;
    }

    const imageMatch = line.match(/^\s*!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)\s*$/);
    if (imageMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);

      const imageUrl = imageMatch[2];
      if (isAtlassianImageUrl(imageUrl)) {
        content.push({
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: {
                type: "external",
                url: imageUrl,
                alt: imageMatch[1] || undefined,
                title: imageMatch[3] || undefined,
              },
            },
          ],
        });
      } else {
        const label = imageMatch[1] || imageMatch[3] || imageUrl;
        content.push({
          type: "paragraph",
          content: [
            textNode("Image: "),
            {
              type: "text",
              text: label,
              marks: [{ type: "link", attrs: { href: imageUrl } }],
            },
          ],
        });
      }

      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2].trim()),
      });
      i += 1;
      continue;
    }

    const taskMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      taskItems.push({ done: taskMatch[1].toLowerCase() === "x", text: taskMatch[2].trim() });
      i += 1;
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph(paragraphLines, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);
      bulletItems.push(bulletMatch[1].trim());
      i += 1;
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushTaskList(taskItems, content);
      orderedItems.push(orderedMatch[1].trim());
      i += 1;
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph(paragraphLines, content);
      flushBulletList(bulletItems, content);
      flushOrderedList(orderedItems, content);
      flushTaskList(taskItems, content);
      i += 1;
      continue;
    }

    flushBulletList(bulletItems, content);
    flushOrderedList(orderedItems, content);
    flushTaskList(taskItems, content);
    paragraphLines.push(line);
    i += 1;
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
  flushTaskList(taskItems, content);

  if (footnotes.size > 0) {
    content.push({
      type: "heading",
      attrs: { level: 6 },
      content: [textNode("Footnotes")],
    });
    content.push({
      type: "orderedList",
      content: Array.from(footnotes.entries()).map(([key, value]) => ({
        type: "listItem",
        attrs: { localId: `footnote-${key}` },
        content: [paragraphNode(`[${key}] ${value}`)],
      })),
    });
  }

  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [paragraphNode("")],
  };
}
