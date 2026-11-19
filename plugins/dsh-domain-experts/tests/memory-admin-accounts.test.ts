import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryAdmin } from "../src/host/memory/admin.js";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { createSqliteMemoryProvider } from "../src/host/memory/sqlite.js";
import {
  domainOf,
  fixedClock,
  memoryRecordTableOf,
  recordingLogger,
} from "./helpers/fakes.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function storeOf(backend: "builtin" | "sqlite") {
  const now = fixedClock(1_758_000_000_000, 1_000);
  const provider =
    backend === "builtin"
      ? createBuiltinMemoryProvider(memoryRecordTableOf(), now)
      : (() => {
          const directory = mkdtempSync(
            path.join(tmpdir(), "dsh-memory-admin-accounts-"),
          );
          const sqlite = createSqliteMemoryProvider({
            filePath: path.join(directory, "memory.db"),
            now,
          });
          cleanups.push(() => {
            sqlite.close();
            rmSync(directory, { recursive: true, force: true });
          });
          return sqlite;
        })();
  const definitions = [
    domainOf("payments", {
      memory: {
        namespace: "custom/payments",
        sharedReadOnly: ["shared/rules"],
      },
    }),
    domainOf("answer-reviewer"),
    domainOf("retired", { enabled: false }),
  ];
  const admin = createMemoryAdmin({
    definitions: async () => definitions,
    provider: () => provider,
    logger: recordingLogger({ events: [] }),
  });
  return { admin, provider };
}

describe.each(["builtin", "sqlite"] as const)(
  "memory maintenance of account namespaces (%s)",
  (backend) => {
    it("counts stored account memory for domain and review experts", async () => {
      const { admin, provider } = storeOf(backend);
      await provider.remember(
        "custom/payments/u/account-a",
        "batch",
        "Batch cutoff is 14:00.",
      );
      await provider.remember(
        "custom/payments/u/account-b",
        "refund",
        "Refund window is ten days.",
      );
      await provider.remember(
        "domain/answer-reviewer/u/account-a",
        "sources",
        "Review every claim against its source.",
      );
      const scopes = await admin.scopes();
      expect(
        scopes.map(({ domainId, namespace, records }) => ({
          domainId,
          namespace,
          records,
        })),
      ).toEqual([
        { domainId: "payments", namespace: "custom/payments", records: 0 },
        {
          domainId: "payments",
          namespace: "custom/payments/u/account-a",
          records: 1,
        },
        {
          domainId: "payments",
          namespace: "custom/payments/u/account-b",
          records: 1,
        },
        {
          domainId: "answer-reviewer",
          namespace: "domain/answer-reviewer",
          records: 0,
        },
        {
          domainId: "answer-reviewer",
          namespace: "domain/answer-reviewer/u/account-a",
          records: 1,
        },
        { domainId: "payments", namespace: "shared/rules", records: 0 },
      ]);
      expect(
        scopes
          .filter((scope) => scope.records > 0)
          .every((scope) => scope.access === "read-write"),
      ).toBe(true);
      // Discovery is live, including records created after the first list.
      await provider.remember(
        "custom/payments/u/account-c",
        "tax",
        "Tax is calculated before settlement.",
      );
      expect(
        (await admin.scopes()).find(
          (scope) => scope.namespace === "custom/payments/u/account-c",
        )?.records,
      ).toBe(1);
    });

    it("searches, corrects and deletes account records without touching a sibling", async () => {
      const { admin, provider } = storeOf(backend);
      const namespace = "custom/payments/u/account-a";
      const sibling = "custom/payments/u/account-b";
      const stored = await provider.remember(
        namespace,
        "batch",
        "Batch cutoff is 14:00.",
      );
      await provider.remember(sibling, "batch", "Batch cutoff is 16:00.");
      expect((await admin.search(namespace, "cutoff", 10, 0)).total).toBe(1);
      const corrected = await admin.correct({
        namespace,
        key: "batch",
        text: "Batch cutoff is 15:00.",
      });
      expect(corrected.createdAt).toBe(stored.createdAt);
      expect(await admin.remove(namespace, "batch")).toBe(true);
      await provider.remember(namespace, "first", "First recorded finding.");
      await provider.remember(namespace, "second", "Second recorded finding.");
      expect(await admin.removeMany(namespace, ["first"])).toBe(1);
      expect(await admin.wipe(namespace)).toBe(1);
      expect((await provider.inspect(sibling))[0]?.text).toBe(
        "Batch cutoff is 16:00.",
      );
    });

    it("does not claim unrelated, disabled, shared or malformed account namespaces", async () => {
      const { admin, provider } = storeOf(backend);
      const unowned = [
        "custom/payments-archive/u/account-a",
        "custom/payments/u/account-a/nested",
        "custom/payments/u",
        "domain/retired/u/account-a",
        "domain/unknown/u/account-a",
        "shared/rules/u/account-a",
      ];
      for (const namespace of unowned) {
        await provider.remember(
          namespace,
          "note",
          "An unrelated stored finding.",
        );
      }
      const namespaces = (await admin.scopes()).map((scope) => scope.namespace);
      expect(
        namespaces.filter((namespace) => unowned.includes(namespace)),
      ).toEqual([]);
      for (const namespace of unowned) {
        await expect(admin.search(namespace, "", 10, 0)).rejects.toThrow(
          /not declared/u,
        );
        await expect(admin.wipe(namespace)).rejects.toThrow(/cannot write/u);
      }
    });
  },
);
