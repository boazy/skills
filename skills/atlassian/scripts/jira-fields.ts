import { jiraGet, exitWithError, output } from "./lib/atlassian.ts";

// ============================================================================
// Types
// ============================================================================

interface JiraField {
  id: string;
  key?: string;
  name: string;
  custom: boolean;
  schema?: {
    type?: string;
    custom?: string;
    customId?: number;
    items?: string;
  };
  clauseNames?: string[];
}

interface OutputField {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
  customType: string | null;
}

// ============================================================================
// Main
// ============================================================================

const filter = process.argv[2];

if (filter === "--help" || filter === "-h") {
  console.log(`Usage: npx tsx jira-fields.ts [filter]

Resolve Jira field IDs to human-readable names (and vice versa). Custom field
IDs (e.g. customfield_10023) are instance-specific and meaningless to a reader
without this mapping. ALWAYS resolve names before setting custom fields.

Arguments:
  filter    Optional. Case-insensitive substring matched against field NAME or
            field ID. Omit to list every field.

Examples:
  npx tsx jira-fields.ts                  # list all fields
  npx tsx jira-fields.ts "story points"   # find by name
  npx tsx jira-fields.ts sprint           # find by name
  npx tsx jira-fields.ts customfield_10023 # resolve an ID back to its name

Output is JSON: { count, fields: [{ id, name, custom, type, customType }] }.
Build an ID -> name mapping table from this before using any customfield_* ID.`);
  process.exit(0);
}

async function listFields() {
  const response = await jiraGet<JiraField[]>("field");

  if (!response.ok) {
    exitWithError(response.error || "Failed to list fields");
  }

  const all = response.data ?? [];

  const mapped: OutputField[] = all.map((f) => ({
    id: f.id,
    name: f.name,
    custom: f.custom,
    type: f.schema?.type ?? null,
    customType: f.schema?.custom ?? null,
  }));

  const filtered = filter
    ? mapped.filter((f) => {
        const needle = filter.toLowerCase();
        return (
          f.name.toLowerCase().includes(needle) ||
          f.id.toLowerCase().includes(needle)
        );
      })
    : mapped;

  // Stable, human-friendly ordering: custom fields after system fields,
  // each group sorted by name.
  filtered.sort((a, b) => {
    if (a.custom !== b.custom) {
      return a.custom ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  output({ count: filtered.length, fields: filtered });
}

listFields();
