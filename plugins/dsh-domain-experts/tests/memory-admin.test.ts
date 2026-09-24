import { describe, expect, it } from "vitest";
import { createMemoryAdmin, MAX_BULK_KEYS } from "../src/host/memory/admin.js";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { isDomainExpertsError } from "../src/host/errors.js";
import type { DomainDefinition } from "../src/types.js";
import {
  domainOf,
  fixedClock,
  memoryRecordTableOf,
  recordingLogger,
  type RecordedLog,
} from "./helpers/fakes.js";

/**
 * The operator's view of expert memory: what an expert recorded, and the
 * correction or deletion of a line that turned out to be wrong.
 *
 * The policy is what these tests hold still — an expert's tool call cannot
 * cross namespaces, and maintenance cannot write a namespace no enabled expert
 * claims as its own.
 */

const PAYMENTS = domainOf("payments", {
  memory: { namespace: "domain/payments", sharedReadOnly: ["shared/product"] },
});
const INVENTORY = domainOf("inventory");
const RETIRED = domainOf("retired", { enabled: false });

function storeOf(
  definitions: readonly DomainDefinition[] = [PAYMENTS, INVENTORY, RETIRED],
) {
  const sink: RecordedLog = { events: [] };
  const provider = createBuiltinMemoryProvider(
    memoryRecordTableOf(),
    fixedClock(1_758_000_000_000, 1_000),
  );
  const admin = createMemoryAdmin({
    definitions: async () => definitions,
    provider: () => provider,
    logger: recordingLogger(sink),
  });
  const note = (namespace: string, key: string, text: string) =>
    provider.remember(namespace, key, text).then(() => undefined);
  return { admin, provider, sink, note };
}

describe("memory admin: scopes", () => {
  it("lists every namespace an enabled expert declares, with its owner", async () => {
    const { admin, provider } = storeOf();
    await provider.remember("domain/payments", "cutoff", "14:00 batch");
    const scopes = await admin.scopes();
    expect(
      scopes.map(
        (scope) => `${scope.domainId}:${scope.namespace}:${scope.access}`,
      ),
    ).toEqual([
      "inventory:domain/inventory:read-write",
      "payments:domain/payments:read-write",
      "payments:shared/product:read-only",
    ]);
    expect(
      scopes.find((scope) => scope.namespace === "domain/payments")?.records,
    ).toBe(1);
  });

  it("says nothing about a disabled expert, so maintenance cannot reach its memory", async () => {
    const { admin } = storeOf([RETIRED]);
    expect(await admin.scopes()).toEqual([]);
  });
});

describe("memory admin: search", () => {
  it("pages one namespace newest-first and reports the whole match count", async () => {
    const { admin, provider } = storeOf();
    await provider.remember(
      "domain/payments",
      "a-superseded",
      "The settlement cutoff was 14:00.",
    );
    await provider.remember(
      "domain/payments",
      "b-current",
      "The settlement cutoff moved to 15:00.",
    );
    await provider.remember(
      "domain/payments",
      "c-refund",
      "Refund window is ten days.",
    );

    const first = await admin.search("domain/payments", "", 2, 0);
    expect(first.total).toBe(3);
    // Newest write first: the fixed clock advances per call, so `c-refund` is
    // the most recent record even though it is the least interesting one.
    expect(first.records.map((item) => item.key)).toEqual([
      "c-refund",
      "b-current",
    ]);
    const second = await admin.search("domain/payments", "", 2, 2);
    expect(second.records.map((item) => item.key)).toEqual(["a-superseded"]);

    const matched = await admin.search(
      "domain/payments",
      "settlement 15:00",
      10,
      0,
    );
    expect(matched.total).toBe(1);
    expect(matched.records[0]?.key).toBe("b-current");
  });

  it("reads a shared namespace it cannot write", async () => {
    const { admin, provider } = storeOf();
    await provider.remember(
      "shared/product",
      "naming",
      "Product naming rules.",
    );
    const page = await admin.search("shared/product", "naming", 10, 0);
    expect(page.records).toHaveLength(1);
  });

  it("refuses a namespace no enabled expert declares", async () => {
    const { admin } = storeOf();
    await expect(
      admin.search("domain/retired", "", 10, 0),
    ).rejects.toThrowError(/not declared by any enabled expert/u);
  });
});

describe("memory admin: correction", () => {
  it("rewrites a record in place and keeps its age", async () => {
    const { admin, provider, sink } = storeOf();
    const stored = await provider.remember(
      "domain/payments",
      "cutoff",
      "The settlement cutoff is 14:00.",
      ["batch"],
    );
    const corrected = await admin.correct({
      namespace: "domain/payments",
      key: "cutoff",
      text: "The settlement cutoff is 15:00 — see the operator note.",
      tags: ["batch", "corrected"],
    });
    expect(corrected.createdAt).toBe(stored.createdAt);
    expect(corrected.updatedAt).toBeGreaterThan(stored.updatedAt);
    expect(
      (await provider.inspect("domain/payments")).map((item) => item.text),
    ).toEqual([corrected.text]);
    expect(sink.events.map((event) => event.event)).toContain(
      "domain-experts/memory-corrected",
    );
  });

  it("keeps the tags a correction did not name out of the record", async () => {
    const { admin, provider } = storeOf();
    await provider.remember("domain/payments", "cutoff", "A stored note.", [
      "stale",
    ]);
    const corrected = await admin.correct({
      namespace: "domain/payments",
      key: "cutoff",
      text: "A corrected note.",
    });
    expect(corrected.tags).toEqual([]);
  });

  it("refuses to write a namespace an expert only reads from", async () => {
    const { admin, provider } = storeOf();
    await provider.remember(
      "shared/product",
      "naming",
      "Product naming rules.",
    );
    await expect(
      admin.correct({
        namespace: "shared/product",
        key: "naming",
        text: "Rewritten by an operator.",
      }),
    ).rejects.toThrowError(/cannot write it/u);
    expect((await provider.inspect("shared/product"))[0]?.text).toBe(
      "Product naming rules.",
    );
  });

  it("refuses a key that is no longer stored, instead of resurrecting it", async () => {
    const { admin, provider } = storeOf();
    await provider.remember("domain/payments", "cutoff", "A stored note.");
    await provider.forget("domain/payments", "cutoff");
    const error = await admin
      .correct({
        namespace: "domain/payments",
        key: "cutoff",
        text: "An edit over a row that vanished.",
      })
      .catch((thrown: unknown) => thrown);
    expect(isDomainExpertsError(error) && error.code).toBe(
      "MEMORY_RECORD_MISSING",
    );
    expect((error as Error).message).toContain("reload the list");
    expect(await provider.inspect("domain/payments")).toEqual([]);
  });

  it("refuses an empty text or key", async () => {
    const { admin, provider } = storeOf();
    await provider.remember("domain/payments", "cutoff", "A stored note.");
    await expect(
      admin.correct({ namespace: "domain/payments", key: " ", text: "x" }),
    ).rejects.toThrowError(/non-empty record key/u);
    await expect(
      admin.correct({
        namespace: "domain/payments",
        key: "cutoff",
        text: "  ",
      }),
    ).rejects.toThrowError(/non-empty text/u);
  });

  it("does not run the model's noise gate over an operator's edit", async () => {
    const { admin, provider } = storeOf();
    await provider.remember(
      "domain/payments",
      "cutoff",
      "An acknowledgement the expert stored before the gate existed.",
    );
    const corrected = await admin.correct({
      namespace: "domain/payments",
      key: "cutoff",
      text: "ок",
    });
    expect(corrected.text).toBe("ок");
  });
});

describe("memory admin: deletion", () => {
  it("removes one record and reports whether it was there", async () => {
    const { admin, provider } = storeOf();
    await provider.remember("domain/payments", "cutoff", "A stored note.");
    expect(await admin.remove("domain/payments", "cutoff")).toBe(true);
    expect(await admin.remove("domain/payments", "cutoff")).toBe(false);
  });

  it("removes the named records once each and counts what actually went", async () => {
    const { admin, provider, note } = storeOf();
    await note("domain/payments", "a", "First stored note.");
    await note("domain/payments", "b", "Second stored note.");
    await note("domain/inventory", "c", "Third stored note.");
    expect(
      await admin.removeMany("domain/payments", ["a", " a ", "b", "gone"]),
    ).toBe(2);
    expect(await provider.inspect("domain/payments")).toEqual([]);
    expect(
      (await provider.inspect("domain/inventory")).map((r) => r.key),
    ).toEqual(["c"]);
  });

  it("refuses a bulk delete that names nothing or too much", async () => {
    const { admin } = storeOf();
    await expect(
      admin.removeMany("domain/payments", [" "]),
    ).rejects.toThrowError(/needs at least one record key/u);
    const keys = Array.from({ length: MAX_BULK_KEYS + 1 }, (_unused, index) =>
      String(index),
    );
    await expect(
      admin.removeMany("domain/payments", keys),
    ).rejects.toThrowError(/the cap is/u);
  });

  it("refuses to delete in a read-only namespace", async () => {
    const { admin } = storeOf();
    await expect(admin.remove("shared/product", "naming")).rejects.toThrowError(
      /cannot write it/u,
    );
    await expect(
      admin.removeMany("shared/product", ["naming"]),
    ).rejects.toThrowError(/cannot write it/u);
    await expect(admin.wipe("shared/product")).rejects.toThrowError(
      /cannot write it/u,
    );
  });

  it("wipes one private namespace and reports how much went", async () => {
    const { admin, provider, sink, note } = storeOf();
    await note("domain/payments", "a", "First stored note.");
    await note("domain/payments", "b", "Second stored note.");
    await note("domain/inventory", "c", "Third stored note.");
    expect(await admin.wipe("domain/payments")).toBe(2);
    expect(
      (await provider.inspect("domain/inventory")).map((r) => r.key),
    ).toEqual(["c"]);
    expect(sink.events.map((event) => event.event)).toContain(
      "domain-experts/memory-wiped",
    );
  });
});

describe("memory admin: storage refusals", () => {
  it("refuses every namespace when no expert is defined", async () => {
    const admin = createMemoryAdmin({
      definitions: async () => [],
      provider: () =>
        createBuiltinMemoryProvider(memoryRecordTableOf(), fixedClock()),
      logger: recordingLogger({ events: [] } as unknown as RecordedLog),
    });
    expect(await admin.scopes()).toEqual([]);
    await expect(admin.wipe("domain/payments")).rejects.toThrowError(
      /not the private namespace of an enabled expert/u,
    );
  });
});
