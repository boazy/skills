const DEEPWIKI_URL = "https://mcp.deepwiki.com/mcp";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

interface ToolResultContent {
  type: string;
  text?: string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: {
    content?: ToolResultContent[];
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

function parseSSE(body: string): JsonRpcResponse[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as JsonRpcResponse);
}

async function rpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const res = await fetch(DEEPWIKI_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();

  if (contentType.includes("text/event-stream")) {
    const messages = parseSSE(body);
    return messages.find((m) => m.id === req.id) ?? messages[0] ?? null;
  }

  return body ? (JSON.parse(body) as JsonRpcResponse) : null;
}

async function initialize(): Promise<void> {
  await rpc({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "deepwiki-cli", version: "1.0.0" },
    },
    id: 1,
  });

  // Send initialized notification (no id = notification)
  await fetch(DEEPWIKI_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
}

export async function callDeepWiki(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  await initialize();

  const response = await rpc({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id: 2,
  });

  if (!response) {
    throw new Error("No response from DeepWiki");
  }

  if (response.error) {
    throw new Error(
      `DeepWiki error ${response.error.code}: ${response.error.message}`,
    );
  }

  const content = response.result?.content;
  if (!content) {
    throw new Error("No content in response");
  }

  if (response.result?.isError) {
    const errorText = content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    throw new Error(errorText || "Tool call failed");
  }

  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
