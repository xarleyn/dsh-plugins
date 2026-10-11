import { describe, expect, it } from "vitest";
import { QaAccountsError } from "../../src/accounts/store.js";
import type { QaExpertMemoryAdmin } from "../../src/integration/expert-memory.js";
import type { QaExpertMemoryScope } from "../../src/types.js";
import { harness, refusal } from "./admin-service.helpers.js";
import { fakeExpertMemory, memoryRefusal } from "./expert-memory-fake.js";

/**
 * What the console adds on top of the memory seam: who may reach it, what the
 * audit trail keeps, and which word a refusal arrives in. The seam's own policy
 * is held by `dsh-domain-experts/tests/memory-admin.test.ts`.
 */

const RECORD = {
  namespace: "domain/payments",
  key: "cutoff",
  text: "The settlement cutoff is 14:00.",
  tags: ["batch"],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_060_000,
};

const OTHER = {
  ...RECORD,
  key: "refund-window",
  text: "Refunds run for ten days.",
  tags: [],
};

const SCOPES: readonly QaExpertMemoryScope[] = [
  {
    domainId: "payments",
    domainName: "Платежи",
    namespace: "domain/payments",
    access: "read-write",
    records: 0,
  },
  {
    domainId: "platform",
    domainName: "Платформа",
    namespace: "shared/product",
    access: "read-only",
    records: 0,
  },
];

function of(
  options: {
    readonly refuse?: Partial<Record<keyof QaExpertMemoryAdmin, () => never>>;
  } = {},
) {
  const memory = fakeExpertMemory({
    scopes: SCOPES,
    records: [RECORD, OTHER],
    ...options,
  });
  return { memory, ...harness({ memory }) };
}

describe("admin expert memory gates", () => {
  it("refuses every memory call to an ordinary user", async () => {
    const { service, alice } = of();
    for (const call of [
      () => service.memoryScopes(alice.token),
      () => service.memoryRecords(alice.token, "domain/payments", "", 25, 0),
      () =>
        service.correctMemory(alice.token, "domain/payments", "cutoff", {
          text: "Rewritten",
          tags: [],
        }),
      () => service.forgetMemory(alice.token, "domain/payments", ["cutoff"]),
      () => service.wipeMemory(alice.token, "domain/payments", null),
    ]) {
      const error = await refusal(call);
      expect(error).toBeInstanceOf(QaAccountsError);
      expect(error.reason).toBe("forbidden");
    }
  }, 30_000);

  it("lets a reviewer read the memory of every expert, and write none of it", async () => {
    const { service, reviewer, memory } = of();
    const scopes = await service.memoryScopes(reviewer.token);
    expect(scopes.map((scope) => scope.namespace)).toEqual([
      "domain/payments",
      "shared/product",
    ]);
    const page = await service.memoryRecords(
      reviewer.token,
      "domain/payments",
      "",
      25,
      0,
    );
    expect(page.total).toBe(2);

    for (const call of [
      () =>
        service.correctMemory(reviewer.token, "domain/payments", "cutoff", {
          text: "Rewritten by a reviewer",
          tags: [],
        }),
      () => service.forgetMemory(reviewer.token, "domain/payments", ["cutoff"]),
      () => service.wipeMemory(reviewer.token, "domain/payments", null),
    ]) {
      expect(await refusal(call).then((error) => error.reason)).toBe(
        "forbidden",
      );
    }
    // The refusal happens before the seam is reached: a reviewer cannot lean on
    // the memory plugin having checked anything.
    expect(
      memory.calls.filter((call) =>
        ["correct", "remove", "removeMany", "wipe"].includes(call.method),
      ),
    ).toEqual([]);
  }, 30_000);

  it("says the memory is unavailable when the stand composes no experts", async () => {
    const { service, admin } = harness();
    expect(
      await refusal(() => service.memoryScopes(admin.token)).then(
        (error) => error.reason,
      ),
    ).toBe("memory-unavailable");
  }, 30_000);

  it("refuses a deletion that names no record", async () => {
    const { service, admin } = of();
    expect(
      await refusal(() =>
        service.forgetMemory(admin.token, "domain/payments", [" ", ""]),
      ).then((error) => error.reason),
    ).toBe("invalid-memory");
  }, 30_000);
});

describe("admin expert memory writes", () => {
  it("corrects a record and audits both images of it", async () => {
    const { service, admin, quality, memory } = of();
    const corrected = await service.correctMemory(
      admin.token,
      "domain/payments",
      "cutoff",
      { text: "The settlement cutoff is 15:00.", tags: ["batch", "fixed"] },
    );
    expect(corrected.text).toBe("The settlement cutoff is 15:00.");
    expect(corrected.createdAt).toBe(RECORD.createdAt);
    expect(
      memory.recordsOf("domain/payments").map((row) => row.text),
    ).toContain(corrected.text);
    const [entry] = quality
      .auditEvents()
      .filter((event) => event.action === "memory.corrected");
    expect(entry).toMatchObject({
      actorId: admin.user.id,
      targetType: "expert-memory",
      targetId: "domain/payments/cutoff",
    });
    expect(String(entry?.before)).toContain("14:00");
    expect(String(entry?.after)).toContain("15:00");
  }, 30_000);

  it("removes one record and keeps its text in the audit trail", async () => {
    const { service, admin, quality, memory } = of();
    expect(
      await service.forgetMemory(admin.token, "domain/payments", ["cutoff"]),
    ).toBe(1);
    expect(memory.recordsOf("domain/payments").map((row) => row.key)).toEqual([
      "refund-window",
    ]);
    const [entry] = quality
      .auditEvents()
      .filter((event) => event.action === "memory.deleted");
    expect(String(entry?.before)).toContain("14:00");
    expect(entry?.targetId).toBe("domain/payments");
  }, 30_000);

  it("removes a selection in one call and records the keys, not every page", async () => {
    const { service, admin, quality, memory } = of();
    expect(
      await service.forgetMemory(admin.token, "domain/payments", [
        "cutoff",
        "cutoff",
        "refund-window",
        " ",
      ]),
    ).toBe(2);
    expect(memory.calls.some((call) => call.method === "removeMany")).toBe(
      true,
    );
    expect(memory.recordsOf("domain/payments")).toEqual([]);
    const [entry] = quality
      .auditEvents()
      .filter((event) => event.action === "memory.deleted");
    const snapshot = String(entry?.before);
    expect(snapshot).toContain("cutoff");
    expect(snapshot).not.toContain("14:00");
  }, 30_000);

  it("wipes a namespace and refuses when the count it showed has moved", async () => {
    const { service, admin, quality, memory } = of();
    expect(
      await refusal(() =>
        service.wipeMemory(admin.token, "domain/payments", 5),
      ).then((error) => error.reason),
    ).toBe("memory-record-unknown");
    expect(memory.recordsOf("domain/payments")).toHaveLength(2);
    expect(await service.wipeMemory(admin.token, "domain/payments", 2)).toBe(2);
    expect(memory.recordsOf("domain/payments")).toEqual([]);
    expect(
      quality.auditEvents().some((event) => event.action === "memory.wiped"),
    ).toBe(true);
  }, 30_000);
});

describe("admin expert memory refusals", () => {
  it("keeps the plugin's own words off the wire and sends a reason", async () => {
    const calls: Record<string, () => never> = {
      scopes: () => {
        throw memoryRefusal("STORAGE_UNAVAILABLE");
      },
    };
    const { service, admin } = of({ refuse: calls });
    const error = await refusal(() => service.memoryScopes(admin.token));
    expect(error.reason).toBe("memory-unavailable");
    // The message is the console's own; a storage refusal names a database
    // file, and that is not something a browser gets to read.
    expect(error.message).not.toMatch(/domain|\.db/u);
  }, 30_000);

  it("maps a write to a read-only namespace to the shared forbidden reason", async () => {
    const { service, admin } = of();
    expect(
      await refusal(() =>
        service.forgetMemory(admin.token, "shared/product", ["naming"]),
      ).then((error) => error.reason),
    ).toBe("forbidden");
    expect(
      await refusal(() =>
        service.wipeMemory(admin.token, "shared/product", null),
      ).then((error) => error.reason),
    ).toBe("forbidden");
  }, 30_000);

  it("passes an unexpected fault through untouched", async () => {
    const memory = fakeExpertMemory({
      scopes: SCOPES,
      records: [RECORD, OTHER],
      refuse: {
        search: () => {
          throw new Error("the seam crashed");
        },
      },
    });
    const { service, admin } = harness({ memory });
    await expect(
      service.memoryRecords(admin.token, "domain/payments", "", 25, 0),
    ).rejects.toThrowError(/the seam crashed/u);
  }, 30_000);
});
