/**
 * ADR Status Report Generator
 *
 * Fetches all ADRs from Confluence and generates a status report.
 *
 * Usage:
 *   npx tsx scripts/adr-report.ts [format]
 *
 * Arguments:
 *   format   Output format: "markdown" (default) or "json"
 *
 * Examples:
 *   npx tsx scripts/adr-report.ts
 *   npx tsx scripts/adr-report.ts markdown
 *   npx tsx scripts/adr-report.ts json
 */

import { confluenceLegacyGet, getSiteUrl, exitWithError } from "./lib/confluence.ts";

// ============================================================================
// Constants
// ============================================================================

/** Page ID of the "ADRs" parent page in the CE (Engineering) space */
const ADR_PARENT_PAGE_ID = "31859277900";

// ============================================================================
// Types
// ============================================================================

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  space: { key: string; name: string };
  version: { number: number; when: string };
  body?: { storage?: { value?: string } };
  _links: { webui: string };
}

interface SearchResponse {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
  totalSize?: number;
  _links?: { next?: string };
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract the status text from the ADR card table in the HTML body */
function extractStatus(body: string): string {
  // Primary: match the styled Status cell — the label uses <span> with color styling
  const primary = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>\s*<p[^>]*>([^<]+)<\/p>/i
  );
  if (primary) return primary[1].trim();

  // Secondary: match Status row with a self-closing <p /> (empty status)
  const empty = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>\s*<p\s*\/>/i
  );
  if (empty) return "Unknown";

  // Fallback: broader match — but ONLY match the immediately next <td>, not beyond
  const fallback = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i
  );
  if (fallback) {
    const text = fallback[1].replace(/<[^>]*>/g, "").trim();
    if (text) return text;
  }

  return "Unknown";
}
/** Extract the ADR number from a page title */
function extractAdrNumber(title: string): number {
  const match = title.match(/ADR-(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

/** Strip emoji prefix and ADR-NNN prefix from title to get the short name */
function extractShortTitle(title: string): string {
  // Remove leading emojis / symbols, then "ADR-NNN:" or "ADR-NNN " prefix
  return title
    .replace(/^[^\w[]*/, "") // strip leading non-word chars (emojis)
    .replace(/^\[?ADR-\d+\]?\s*[:/-]\s*/, "") // strip ADR-NNN: prefix
    .replace(/^\[?ADR-\d+\]?\s+/, "") // strip ADR-NNN prefix (no colon)
    .trim();
}

/** Check if a page is an actual ADR (not a reserved range or meeting notes) */
function isAdrPage(title: string): boolean {
  return (
    /ADR-\d+/.test(title) &&
    !/Reserved/i.test(title) &&
    !/Design Review/i.test(title)
  );
}

/** Map status string to display emoji */
function getStatusEmoji(status: string): string {
  const s = status.toLowerCase().trim();
  if (s === "accepted" || s === "approved") return "✅";
  if (s === "proposal" || s === "proposed" || s === "pending approval") return "⏳";
  if (s === "draft") return "🗒️";
  if (s === "withdrawn" || s === "rejected") return "🚫";
  if (s === "postponed") return "✋";
  return "❓";
}

// ============================================================================
// Main
// ============================================================================

const format = process.argv[2] || "markdown";

async function fetchAllAdrPages(): Promise<ConfluencePage[]> {
  const allPages: ConfluencePage[] = [];
  let start = 0;
  const limit = 50;

  while (true) {
    const response = await confluenceLegacyGet<SearchResponse>(
      "content/search",
      {
        cql: `space = CE AND type = page AND ancestor = ${ADR_PARENT_PAGE_ID}`,
        limit: String(limit),
        start: String(start),
        expand: "body.storage,space,version",
      }
    );

    if (!response.ok) {
      exitWithError(response.error || "Failed to search Confluence");
    }

    allPages.push(...response.data!.results);

    if (!response.data!._links?.next) break;
    start += limit;
  }

  return allPages;
}

async function generateReport() {
  const allPages = await fetchAllAdrPages();
  const siteUrl = getSiteUrl();

  // Filter and transform
  const adrs = allPages
    .filter((p) => isAdrPage(p.title))
    .map((p) => ({
      number: extractAdrNumber(p.title),
      id: `ADR-${String(extractAdrNumber(p.title)).padStart(3, "0")}`,
      fullTitle: p.title,
      shortTitle: extractShortTitle(p.title),
      status: extractStatus(p.body?.storage?.value || ""),
      url: `${siteUrl}/wiki${p._links.webui}`,
      pageId: p.id,
      lastModified: p.version.when,
    }))
    .sort((a, b) => a.number - b.number);

  // JSON output
  if (format === "json") {
    console.log(JSON.stringify(adrs, null, 2));
    return;
  }

  // Markdown output
  const today = new Date().toISOString().split("T")[0];
  console.log("# ADR Status Report\n");
  console.log(`> Generated: ${today}\n`);
  console.log("| # | Title | Status | Last Modified |");
  console.log("|---|-------|--------|---------------|");

  for (const adr of adrs) {
    const emoji = getStatusEmoji(adr.status);
    const link = `[${adr.id}](${adr.url})`;
    const date = adr.lastModified?.split("T")[0] || "N/A";
    console.log(
      `| ${link} | ${adr.shortTitle} | ${emoji} ${adr.status} | ${date} |`
    );
  }

  // Summary
  const statusCounts = adrs.reduce(
    (acc, adr) => {
      const s = adr.status || "Unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log("\n## Summary\n");
  console.log(`**Total ADRs:** ${adrs.length}\n`);
  for (const [status, count] of Object.entries(statusCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`- ${getStatusEmoji(status)} **${status}**: ${count}`);
  }

  // Highest number (useful for "next ADR" info)
  const maxNumber = Math.max(...adrs.map((a) => a.number));
  console.log(`\n**Next available ADR number:** ADR-${maxNumber + 1}`);
}

generateReport();
