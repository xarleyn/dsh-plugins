import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it, vi } from "vitest";
import { QaAccessService } from "../src/access/service.js";
import { QaAdminService } from "../src/admin/service.js";
import { staticSessionLogReader } from "../src/admin/session-log.js";
import { resolveConfig } from "../src/resolve-config.js";
import { harness, refusal } from "./admin-service.helpers.js";

describe("admin conversation reads", () => {
  it("lists every conversation with its owner, subrole and counts", async () => {
    const { service, admin } = harness();
    const page = await service.conversations(
      admin.token,
      {},
      undefined,
      undefined,
    );
    expect(page.total).toBe(2);
    const alice = page.items.find(
      (row) => row.conversationId === "session-alice",
    );
    expect(alice?.displayName).toBe("alice");
    expect(alice?.subroleId).toBe("analyst");
    expect(alice?.title).toBe("Release report");
    expect(alice?.messageCount).toBe(2);
    expect(alice?.reviewStatus).toBe("unreviewed");
  });

  it("filters by owner, subrole and search text", async () => {
    const { service, admin, bob } = harness();
    const byOwner = await service.conversations(
      admin.token,
      { userId: bob.user.id },
      undefined,
      undefined,
    );
    expect(byOwner.items.map((row) => row.conversationId)).toEqual([
      "session-bob",
    ]);
    const bySubrole = await service.conversations(
      admin.token,
      { subroleId: "analyst" },
      undefined,
      undefined,
    );
    expect(bySubrole.total).toBe(1);
    const byTitle = await service.conversations(
      admin.token,
      { search: "migration" },
      undefined,
      undefined,
    );
    expect(byTitle.items.map((row) => row.conversationId)).toEqual([
      "session-bob",
    ]);
    const byOwnerName = await service.conversations(
      admin.token,
      { search: "alice@" },
      undefined,
      undefined,
    );
    expect(byOwnerName.total).toBe(1);
  });

  it("filters by date range and by rating", async () => {
    const { service, admin, alice } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    const withNegative = await service.conversations(
      admin.token,
      { rating: "negative" },
      undefined,
      undefined,
    );
    expect(withNegative.items.map((row) => row.conversationId)).toEqual([
      "session-alice",
    ]);
    expect(
      (
        await service.conversations(
          admin.token,
          { rating: "positive" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await service.conversations(
          admin.token,
          { from: "2023-01-01T00:00:00.000Z" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(2);
    expect(
      (
        await service.conversations(
          admin.token,
          { to: "2023-01-01T00:00:00.000Z" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(0);
  });

  it("serves one conversation with ordered messages, tools and runtime facts", async () => {
    const { service, admin } = harness();
    const detail = await service.conversation(admin.token, "session-alice");
    expect(detail.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    const assistant = detail.messages[1];
    expect(assistant?.text).toBe("Here is the report");
    expect(assistant?.model).toBe("glm-4.7");
    expect(assistant?.toolCalls?.map((call) => call.name)).toEqual([
      "skill",
      "git_readonly",
    ]);
    expect(detail.runtime.subroleId).toBe("analyst");
    expect(detail.runtime.loadedSkills).toEqual(["release-notes"]);
    expect(detail.runtime.transcriptUnavailable).toBeUndefined();
    // The failed call is a queue signal on its own.
    expect(detail.queueItems.map((item) => item.reason)).toContain(
      "tool_failure",
    );
  });

  it("lets an owner read their own conversation and refuses a stranger", async () => {
    const { service, alice, bob } = harness();
    const own = await service.conversation(alice.token, "session-alice");
    expect(own.conversationId).toBe("session-alice");
    expect(
      await refusal(() => service.conversation(bob.token, "session-alice")),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() => service.conversation(alice.token, "session-unknown")),
    ).toMatchObject({ reason: "session-owned-elsewhere" });
  });

  it("reports an unreadable transcript instead of failing the page", async () => {
    const { accounts, quality, roles, admin } = harness();
    const ctx = {
      tools: { schemas: () => [] },
      get: () => undefined,
    } as unknown as Context;
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      close() {},
    } as unknown as PluginLogger;
    const access = new QaAccessService(ctx, {
      accounts: () => accounts,
      config: () => resolveConfig({}),
      logger,
      repository: roles,
    });
    const service = new QaAdminService({
      accounts: () => accounts,
      quality: () => quality,
      roles: () => roles,
      access: () => access,
      sessionLog: {
        live: () => false,
        async list() {
          return {
            headers: [{ id: "session-alice", createdAt: 1 }],
            complete: true,
          };
        },
        async read() {
          return { ok: false as const, reason: "unreadable" as const };
        },
      },
      logger,
    });
    const detail = await service.conversation(admin.token, "session-alice");
    expect(detail.messages).toEqual([]);
    expect(detail.runtime.transcriptUnavailable).toBe("unreadable");
  });

  it("asks the sweep before listing, so a chat deleted in the Harness leaves the console", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-18T09:00:00Z"));
      const { accounts, quality, roles, admin, alice, bob } = harness();
      const ctx = {
        tools: { schemas: () => [] },
        get: () => undefined,
      } as unknown as Context;
      const logger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as unknown as PluginLogger;
      // Storage holds alice's chat and not bob's: bob's session was deleted
      // outside the deployment, and nothing in the console would notice.
      const listing = staticSessionLogReader({
        sessions: [{ id: "session-alice", createdAt: 1_700_000_000_000 }],
      });
      const access = new QaAccessService(ctx, {
        accounts: () => accounts,
        config: () =>
          resolveConfig({
            accounts: {
              retention: { ownershipGraceHours: 1, sweepIntervalMinutes: 1 },
            },
          }),
        logger,
        repository: roles,
        sessionLog: listing,
      });
      const service = new QaAdminService({
        accounts: () => accounts,
        quality: () => quality,
        roles: () => roles,
        access: () => access,
        sessionLog: listing,
        logger,
      });
      vi.setSystemTime(new Date("2026-09-18T11:00:00Z"));

      const page = await service.conversations(
        admin.token,
        {},
        undefined,
        undefined,
      );

      expect(page.items.map((row) => row.conversationId)).toEqual([
        "session-alice",
      ]);
      // The read cost one sweep, and the sweep took bob's record with it.
      expect(accounts.ownedSessionIds(alice.token)).toEqual(["session-alice"]);
      expect(accounts.ownedSessionIds(bob.token)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
