import { callDeepWiki } from "./mcp-client.js";

const args = process.argv.slice(2);
const question = args.pop();
const repos = args;

if (repos.length === 0 || !question) {
  console.error(
    'Usage: bunx tsx scripts/deepwiki-ask.ts <owner/repo> [owner/repo ...] "<question>"',
  );
  process.exit(1);
}

const repoName = repos.length === 1 ? repos[0] : repos;

try {
  const result = await callDeepWiki("ask_question", {
    repoName,
    question,
  });
  console.log(result);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
