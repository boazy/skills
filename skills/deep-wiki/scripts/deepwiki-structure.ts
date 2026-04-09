import { callDeepWiki } from "./mcp-client.js";

const repoName = process.argv[2];
if (!repoName) {
  console.error("Usage: bunx tsx scripts/deepwiki-structure.ts <owner/repo>");
  process.exit(1);
}

try {
  const result = await callDeepWiki("read_wiki_structure", { repoName });
  console.log(result);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
