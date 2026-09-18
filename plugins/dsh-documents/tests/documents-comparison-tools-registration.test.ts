import { describe, expect, test } from "vitest";

import {
  createDocumentTools,
  DOCUMENT_COMPARISON_TOOL_NAMES,
  DOCUMENT_TOOL_NAMES,
} from "../src/documents/tools/index.js";

import {
  errorOf,
  CONTRACT_AFTER,
  CONTRACT_BEFORE,
  run,
  runtime,
  workspace,
  write,
} from "./documents-comparison-tools.helpers.js";

describe("registration and configuration (§31)", () => {
  test("comparison tools appear beside the others", () => {
    const names = createDocumentTools({ runtime: runtime() }).map(
      (definition) => definition.name,
    );
    expect(names).toEqual([
      ...DOCUMENT_TOOL_NAMES,
      ...DOCUMENT_COMPARISON_TOOL_NAMES,
    ]);
  });

  test("comparison.enabled=false removes the tools instead of weakening them", async () => {
    const instance = runtime({ comparison: { enabled: false } });
    const names = createDocumentTools({ runtime: instance }).map(
      (definition) => definition.name,
    );
    expect(names).toEqual([...DOCUMENT_TOOL_NAMES]);
    expect(
      await errorOf(() =>
        instance.compare({ left: {}, right: {} }, { workspaceRoot: workspace }),
      ),
    ).toBe("BACKEND_UNAVAILABLE");
  });

  test("a deployment can tighten the comparison budgets", async () => {
    const instance = runtime({
      comparison: { maxNodes: 3, maxInputBytes: 4096 },
    });
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    expect(
      await errorOf(() =>
        run(instance, "document_compare", {
          left: { path: "before.md" },
          right: { path: "after.md" },
        }),
      ),
    ).toBe("COMPARE_TOO_MANY_NODES");
  });

  test("the preview is bounded by inlineChanges", async () => {
    const instance = runtime({ comparison: { inlineChanges: 1 } });
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const result = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    expect((result.preview as unknown[]).length).toBe(1);
    expect(result.previewTruncated).toBe(true);
  });
});
