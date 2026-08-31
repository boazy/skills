import assert from "node:assert/strict";
import test from "node:test";

import {
  descriptionToAdf,
  findAccountToken,
  normalizeJiraIssueLinks,
  resolveIssueLinkRelationship,
  selectAcliProfile,
} from "./atlassian.ts";

type AdfDocument = {
  content: Array<{ type: string; content?: unknown[] }>;
};

test("converts a flat ordered Markdown list into one ordered ADF list", () => {
  const document = descriptionToAdf("1. First workstream\n2. Second workstream") as AdfDocument;

  assert.equal(document.content.length, 1);
  assert.equal(document.content[0]?.type, "orderedList");
  assert.equal(document.content[0]?.content?.length, 2);
});

test("converts Markdown task lists into native ADF action items", () => {
  const document = descriptionToAdf("- [ ] Open **work**\n- [x] Completed work") as AdfDocument;
  const taskList = document.content[0] as {
    type: string;
    attrs?: { localId?: string };
    content?: Array<{
      type: string;
      attrs?: { localId?: string; state?: string };
      content?: Array<{ type: string; text: string; marks?: Array<{ type: string }> }>;
    }>;
  };

  assert.equal(taskList.type, "taskList");
  assert.match(taskList.attrs?.localId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.deepEqual(
    taskList.content?.map(({ type, attrs, content }) => ({
      type,
      state: attrs?.state,
      text: content?.[0]?.text,
      marks: content?.[0]?.marks,
    })),
    [
      { type: "taskItem", state: "TODO", text: "Open ", marks: undefined },
      { type: "taskItem", state: "DONE", text: "Completed work", marks: undefined },
    ],
  );
  for (const item of taskList.content ?? []) {
    assert.match(item.attrs?.localId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
});

test("rejects nested Markdown lists before they can produce malformed ADF", () => {
  const originalExit = process.exit;
  const originalConsoleError = console.error;
  process.exit = ((code?: number): never => {
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  console.error = (() => undefined) as typeof console.error;

  try {
    assert.throws(
      () => descriptionToAdf("1. Workstream\n   - Supporting detail"),
      /process\.exit\(1\)/,
    );
  } finally {
    process.exit = originalExit;
    console.error = originalConsoleError;
  }
});

const linkTypes = [
  { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "10001", name: "Relates", inward: "relates to", outward: "relates to" },
  { id: "10002", name: "Duplicate", inward: "is duplicated by", outward: "duplicates" },
];

test("resolves an inward issue-link phrase onto the edited issue", () => {
  const resolved = resolveIssueLinkRelationship(linkTypes, "is blocked by");
  assert.equal(resolved.type.name, "Blocks");
  assert.equal(resolved.fromIsInward, true);
});

test("resolves an outward issue-link phrase onto the edited issue", () => {
  const resolved = resolveIssueLinkRelationship(linkTypes, "blocks");
  assert.equal(resolved.type.name, "Blocks");
  assert.equal(resolved.fromIsInward, false);
});

test("treats a symmetric phrase as inward", () => {
  const resolved = resolveIssueLinkRelationship(linkTypes, "Relates To");
  assert.equal(resolved.type.name, "Relates");
  assert.equal(resolved.fromIsInward, true);
});

test("rejects a link type name so the caller must pick a direction", () => {
  assert.throws(
    () => resolveIssueLinkRelationship(linkTypes, "Blocks"),
    /link type name/,
  );
});

test("rejects an unknown relationship and lists available phrases", () => {
  assert.throws(
    () => resolveIssueLinkRelationship(linkTypes, "caused by"),
    /Unknown relationship/,
  );
});

test("rejects an ambiguous relationship phrase", () => {
  const ambiguous = [
    ...linkTypes,
    { id: "10003", name: "Also Blocks", inward: "is blocked by", outward: "also blocks" },
  ];
  assert.throws(
    () => resolveIssueLinkRelationship(ambiguous, "is blocked by"),
    /Ambiguous relationship/,
  );
});

test("labels an inwardIssue with the inward relationship", () => {
  const links = normalizeJiraIssueLinks("PROJ-1", [
    {
      id: "20000",
      type: {
        id: "10000",
        name: "Blocks",
        inward: "is blocked by",
        outward: "blocks",
      },
      inwardIssue: {
        key: "PROJ-2",
        fields: {
          summary: "Dependency",
          status: { name: "In Progress" },
        },
      },
    },
  ]);

  assert.deepEqual(links, [
    {
      id: "20000",
      type: "Blocks",
      relationship: "is blocked by",
      otherKey: "PROJ-2",
      otherSummary: "Dependency",
      otherStatus: "In Progress",
    },
  ]);
});

test("labels an outwardIssue with the outward relationship", () => {
  const links = normalizeJiraIssueLinks("PROJ-1", [
    {
      id: "20001",
      type: {
        id: "10000",
        name: "Blocks",
        inward: "is blocked by",
        outward: "blocks",
      },
      outwardIssue: {
        key: "PROJ-3",
        fields: {
          summary: "Blocked work",
          status: { name: "To Do" },
        },
      },
    },
  ]);

  assert.deepEqual(links, [
    {
      id: "20001",
      type: "Blocks",
      relationship: "blocks",
      otherKey: "PROJ-3",
      otherSummary: "Blocked work",
      otherStatus: "To Do",
    },
  ]);
});

test("selects the ACLI profile named by cloud and account IDs", () => {
  const selected = selectAcliProfile({
    version: 1,
    current_profile: "cloud-2:account-2",
    profiles: [
      {
        site: "first.atlassian.net",
        cloud_id: "cloud-1",
        account_id: "account-1",
        display_name: "First User",
        email: "first@example.com",
        auth_type: "oauth_global",
      },
      {
        site: "second.atlassian.net",
        cloud_id: "cloud-2",
        account_id: "account-2",
        display_name: "Second User",
        email: "second@example.com",
        auth_type: "oauth_global",
      },
    ],
  });
  assert.equal(selected.email, "second@example.com");
  assert.equal(selected.site, "second.atlassian.net");
});


test("resolves a product profile independently of the global default", () => {
  const selected = selectAcliProfile(
    {
      version: 1,
      current_profile: "cloud-1:account-1",
      profiles: [
        {
          site: "first.atlassian.net",
          cloud_id: "cloud-1",
          account_id: "account-1",
          display_name: "First User",
          email: "first@example.com",
          auth_type: "oauth",
        },
        {
          site: "second.atlassian.net",
          cloud_id: "cloud-2",
          account_id: "account-2",
          display_name: "Second User",
          email: "second@example.com",
          auth_type: "oauth",
        },
      ],
    },
    "cloud-2:account-2",
  );

  assert.equal(selected.email, "second@example.com");
});

test("finds a token by site and email", () => {
  const token = findAccountToken(
    {
      "first.atlassian.net": {
        "first@example.com": "first-token",
      },
      "second.atlassian.net": {
        "second@example.com": "second-token",
      },
    },
    "second.atlassian.net",
    "second@example.com",
  );

  assert.equal(token, "second-token");
});

test("does not fall back to another account's token", () => {
  const token = findAccountToken(
    {
      "example.atlassian.net": {
        "first@example.com": "first-token",
      },
    },
    "example.atlassian.net",
    "second@example.com",
  );

  assert.equal(token, undefined);
});
