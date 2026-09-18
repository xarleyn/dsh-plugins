import { describe, expect, test } from "vitest";

import {
  errorOf,
  CONTRACT_AFTER,
  CONTRACT_BEFORE,
  run,
  runtime,
  write,
} from "./documents-comparison-tools.helpers.js";

describe("document_diff_read", () => {
  test("pages through a change set with a cursor", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;

    const first = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 2,
    });
    expect(first.returned).toBe(2);
    expect(first.total).toBe(4);
    expect(first.remaining).toBe(2);
    expect(typeof first.nextCursor).toBe("string");

    const second = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.returned).toBe(2);
    expect(second.remaining).toBe(0);
    expect(second.nextCursor).toBeUndefined();
    const ids = [
      ...(first.changes as { id: string }[]),
      ...(second.changes as { id: string }[]),
    ].map((change) => change.id);
    expect(new Set(ids).size).toBe(4);
  });

  test("filters by signal family name and by kind", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;

    const money = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { signals: ["deadline"] },
    });
    expect(money.returned).toBe(1);
    expect((money.changes as { signals: string[] }[])[0]?.signals).toContain(
      "DURATION_CHANGED",
    );

    // A short family name and a full code select the same changes; a name that
    // is neither is refused instead of silently matching nothing.
    const obligation = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { signals: ["OBLIGATION_TERM_CHANGED"] },
    });
    expect(obligation.returned).toBe(0);

    const inserts = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { kinds: ["insert"] },
    });
    expect(inserts.returned).toBe(2);
    expect(
      (inserts.changes as { kind: string }[]).every(
        (change) => change.kind === "insert",
      ),
    ).toBe(true);
  });

  test("filters by section and refuses a cursor from another filter", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;
    const section = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { section: "ответственность" },
    });
    expect(section.returned).toBe(1);

    // A cursor names a place in one filtered stream; reusing it under another
    // filter is a caller mistake, and the fingerprint makes it visible.
    const paged = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 1,
    });
    expect(paged.returned).toBe(1);
    expect(typeof paged.nextCursor).toBe("string");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId,
          cursor: paged.nextCursor,
          filters: { section: "6" },
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId,
          cursor: "not-a-cursor",
        }),
      ),
    ).toBe("INVALID_INPUT");
  });

  test("an unknown comparison id is reported, not guessed", async () => {
    const instance = runtime();
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId: "cmp_01K51GQ7V18R3PQ9J11A87AVFB",
        }),
      ),
    ).toBe("COMPARE_ARTIFACT_NOT_FOUND");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", { comparisonId: "not-an-id" }),
      ),
    ).toBe("COMPARE_ARTIFACT_NOT_FOUND");
  });
});
