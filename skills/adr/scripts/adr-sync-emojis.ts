/**
 * ADR Emoji Sync Script
 *
 * Iterates through all ADRs in Confluence, reads each ADR's status from the
 * card table, and sets the corresponding page emoji property.
 *
 * Usage:
 *   npx tsx scripts/adr-sync-emojis.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Show what would change without making any updates
 *
 * Emoji mapping:
 *   Accepted              → ✅ (U+2705)
 *   Proposal / Proposed   → ⏳ (U+23F3)
 *   Pending Approval      → ⏳ (U+23F3)
 *   Draft / Planning      → 🗒️ (U+1F5D2)
 *   Withdrawn / Rejected  → 🚫 (U+1F6AB)
 *   Postponed             → ✋ (U+270B)
 *
 * Non-standard or unrecognized statuses are skipped.
 */

import {
  confluenceLegacyGet,
  confluenceGet,
  confluencePost,
  confluencePut,
  exitWithError,
} from "./lib/confluence.ts";

// ============================================================================
// Constants
// ============================================================================

/** Page ID of the "ADRs" parent page in the CE (Engineering) space */
const ADR_PARENT_PAGE_ID = "31859277900";

/**
 * Status → Confluence emoji code point (hex string).
 * Confluence stores emoji as Unicode code points in hex, e.g. "2705" for ✅.
 */
const STATUS_EMOJI_MAP: Record<string, string> = {
  accepted: "2705",           // ✅
  approved: "2705",           // ✅ (variant of accepted)
  proposal: "23f3",           // ⏳
  proposed: "23f3",           // ⏳ (variant of proposal)
  "pending approval": "23f3", // ⏳
  draft: "1f5d2",             // 🗒️
  planning: "1f5d2",          // 🗒️
  withdrawn: "1f6ab",         // 🚫
  rejected: "1f6ab",          // 🚫
  postponed: "270b",          // ✋
};

// ============================================================================
// Types
// ============================================================================

interface ConfluencePage {
  id: string;
  title: string;
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

interface ContentProperty {
  id: string;
  key: string;
  value?: unknown;
  version?: { number: number };
}

interface PropertyListResponse {
  results: ContentProperty[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract the status text from the ADR card table in the HTML body */
function extractStatus(body: string): string | null {
  // Primary: match the styled Status cell — label uses <span> with color styling
  const primary = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>\s*<p[^>]*>([^<]+)<\/p>/i
  );
  if (primary) return primary[1].trim();

  // Detect empty status: self-closing <p /> in the status value cell
  const empty = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>\s*<p\s*\/>/i
  );
  if (empty) return null;

  // Fallback: match the Status row but ONLY the immediately next <td>
  const fallback = body.match(
    /Status<\/span><\/strong><\/p><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i
  );
  if (fallback) {
    const text = fallback[1].replace(/<[^>]*>/g, "").trim();
    if (text) return text;
  }

  return null;
}

/** Get the Confluence emoji hex code point for a given status */
function getEmojiCodePoint(status: string): string | null {
  return STATUS_EMOJI_MAP[status.toLowerCase().trim()] || null;
}

/** Convert hex code point to display emoji */
function codePointToEmoji(hex: string): string {
  return String.fromCodePoint(parseInt(hex, 16));
}

/** Check if a page is an actual ADR (not a reserved range or meeting notes) */
function isAdrPage(title: string): boolean {
  return (
    /ADR-\d+/.test(title) &&
    !/Reserved/i.test(title) &&
    !/Design Review/i.test(title)
  );
}

/**
 * Upsert a single page property. Returns true on success, false on failure.
 * If the property already has the correct value, skips the update.
 */
async function upsertProperty(
  pageId: string,
  key: string,
  value: string
): Promise<boolean> {
  // Fetch existing property
  const listResp = await confluenceGet<PropertyListResponse>(
    `pages/${pageId}/properties`,
    { key }
  );
  if (!listResp.ok) return false;

  const existing = listResp.data?.results?.[0];

  if (!existing) {
    // Property doesn't exist — create it
    const createResp = await confluencePost(`pages/${pageId}/properties`, {
      key,
      value,
    });
    return createResp.ok;
  }

  // Property exists — check if value already matches
  if (String(existing.value) === value) return true;

  // Fetch full property for version number
  const detailResp = await confluenceGet<ContentProperty>(
    `pages/${pageId}/properties/${existing.id}`
  );
  if (!detailResp.ok) return false;

  const currentVersion = detailResp.data?.version?.number;
  if (!currentVersion) return false;

  // Update with incremented version
  const updateResp = await confluencePut(
    `pages/${pageId}/properties/${existing.id}`,
    { key, value, version: { number: currentVersion + 1 } }
  );

  return updateResp.ok;
}

// ============================================================================
// Main
// ============================================================================

const dryRun = process.argv.includes("--dry-run");

async function syncEmojis() {
  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be made\n"
      : "🔄 Syncing ADR emojis...\n"
  );

  // Fetch all ADR pages with body content
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
        expand: "body.storage",
      }
    );

    if (!response.ok) {
      exitWithError(response.error || "Failed to search Confluence");
    }

    allPages.push(...response.data!.results);

    if (!response.data!._links?.next) break;
    start += limit;
  }

  // Filter to actual ADR pages
  const adrPages = allPages.filter((p) => isAdrPage(p.title));

  console.log(`Found ${adrPages.length} ADR pages\n`);

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  let errors = 0;

  for (const page of adrPages) {
    const body = page.body?.storage?.value || "";
    const status = extractStatus(body);

    if (!status) {
      console.log(
        `  ⚠️  ${page.title}: Could not extract status — skipping`
      );
      skipped++;
      continue;
    }

    const emojiCode = getEmojiCodePoint(status);

    if (!emojiCode) {
      console.log(
        `  ⚠️  ${page.title}: Non-standard status "${status}" — skipping`
      );
      skipped++;
      continue;
    }

    const emoji = codePointToEmoji(emojiCode);

    if (dryRun) {
      console.log(`  ${emoji}  ${page.title}  →  ${status}`);
      updated++;
      continue;
    }

    // Set emoji for both published and draft properties
    const ok1 = await upsertProperty(
      page.id,
      "emoji-title-published",
      emojiCode
    );
    const ok2 = await upsertProperty(page.id, "emoji-title-draft", emojiCode);

    if (ok1 && ok2) {
      console.log(`  ${emoji}  ${page.title}  →  ${status}`);
      updated++;
    } else if (ok1 || ok2) {
      console.log(
        `  ⚠️  ${page.title}: Partial update (published=${ok1}, draft=${ok2})`
      );
      errors++;
    } else {
      console.log(`  ❌  ${page.title}: Failed to update emoji`);
      errors++;
    }
  }

  console.log(
    `\n${"—".repeat(50)}\n` +
      `Done!  Updated: ${updated}  |  Skipped: ${skipped}  |  ` +
      `Unchanged: ${unchanged}  |  Errors: ${errors}`
  );
}

syncEmojis();
