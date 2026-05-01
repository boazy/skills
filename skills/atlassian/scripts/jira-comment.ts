import { readFile } from "fs/promises";
import {
  jiraGet,
  jiraPost,
  exitWithError,
  output,
  markdownToAdf,
} from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface Comment {
  id: string;
  author: { displayName: string; emailAddress?: string };
  body: unknown;
  created: string;
  updated: string;
}

interface CommentsResponse {
  comments: Comment[];
  total: number;
  startAt: number;
  maxResults: number;
}

interface AddCommentResponse {
  id: string;
  created: string;
}

// ============================================================================
// Main
// ============================================================================

const issueKey = process.argv[2];
const action = process.argv[3];
const addArgs = process.argv.slice(4);

if (!issueKey || !action) {
  console.log(`Usage: bunx tsx jira-comment.ts <issueKey> <action> [content | -f <file> | --stdin]

Arguments:
  issueKey       The Jira issue key (e.g., PROJ-123)
  action         "get" to list comments, "add" to add a comment

Content sources (for "add", choose exactly one):
  <inline text>  Markdown content as a positional argument
  -f, --file <path>
                 Read markdown content from a file
  --stdin        Read markdown content from stdin

The comment body supports full markdown (headings, lists, code blocks,
tables, blockquotes, alerts, links, footnotes, etc.) - same converter
used by jira-create / jira-update for descriptions.

Examples:
  # Get all comments
  bunx tsx jira-comment.ts PROJ-123 get

  # Add an inline comment
  bunx tsx jira-comment.ts PROJ-123 add "**Bold** and _italic_ comment"

  # Add a comment from a markdown file
  bunx tsx jira-comment.ts PROJ-123 add -f review-notes.md

  # Pipe a comment from stdin
  echo "## Status\\n\\n- [x] Done" | bunx tsx jira-comment.ts PROJ-123 add --stdin`);
  process.exit(1);
}

async function getComments() {
  const response = await jiraGet<CommentsResponse>(
    `issue/${encodeURIComponent(issueKey)}/comment`,
    { orderBy: "-created" }
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to get comments");
  }

  const data = response.data!;

  output({
    issueKey,
    total: data.total,
    comments: data.comments.map((c) => ({
      id: c.id,
      author: c.author.displayName,
      body: c.body,
      created: c.created,
      updated: c.updated,
    })),
  });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    console.error(
      "Reading comment body from stdin... (press Ctrl+D when done)"
    );
  }
  process.stdin.setEncoding("utf-8");
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

async function resolveCommentContent(args: string[]): Promise<string> {
  let useStdin = false;
  let filePath: string | undefined;
  let inline: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--stdin") {
      useStdin = true;
    } else if (arg === "-f" || arg === "--file") {
      const next = args[i + 1];
      if (!next) {
        exitWithError(`${arg} requires a file path`);
      }
      filePath = next;
      i += 1;
    } else if (inline === undefined) {
      inline = arg;
    } else {
      exitWithError(`Unexpected argument: ${arg}`);
    }
  }

  const sources = [useStdin, filePath !== undefined, inline !== undefined]
    .filter(Boolean).length;

  if (sources === 0) {
    exitWithError(
      "Comment content is required. Provide inline text, -f <file>, or --stdin"
    );
  }
  if (sources > 1) {
    exitWithError(
      "Choose only one content source: inline text, -f <file>, or --stdin"
    );
  }

  if (useStdin) {
    return readStdin();
  }
  if (filePath !== undefined) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (err) {
      exitWithError(
        `Failed to read file "${filePath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return inline!;
}

async function addComment() {
  const raw = await resolveCommentContent(addArgs);
  const trimmed = raw.replace(/^\uFEFF/, "").trimEnd();
  if (trimmed.trim().length === 0) {
    exitWithError("Comment content is empty");
  }

  const response = await jiraPost<AddCommentResponse>(
    `issue/${encodeURIComponent(issueKey)}/comment`,
    { body: markdownToAdf(trimmed) }
  );

  if (!response.ok) {
    exitWithError(response.error || "Failed to add comment");
  }

  output({
    issueKey,
    commentId: response.data!.id,
    created: response.data!.created,
    success: true,
  });
}

async function main() {
  switch (action.toLowerCase()) {
    case "get":
    case "list":
      await getComments();
      break;
    case "add":
    case "create":
      await addComment();
      break;
    default:
      exitWithError(`Unknown action: ${action}. Use "get" or "add"`);
  }
}

main();
