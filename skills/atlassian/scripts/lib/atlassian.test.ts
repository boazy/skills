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
