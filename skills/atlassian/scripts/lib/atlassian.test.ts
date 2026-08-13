import assert from "node:assert/strict";
import test from "node:test";

import { descriptionToAdf } from "./atlassian.ts";

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
