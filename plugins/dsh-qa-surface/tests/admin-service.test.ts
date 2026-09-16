import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it } from "vitest";
import { QaAccounts, QaAccountsError } from "../src/accounts/store.js";
import { QaAccessService } from "../src/access/service.js";
import { QaRoleRepository } from "../src/access/role-repository.js";
import { QaAdminService } from "../src/admin/service.js";
import { QaQualityStore } from "../src/admin/quality-store.js";
import { staticSessionLogReader } from "../src/admin/session-log.js";
import type { StoredSessionEvent } from "../src/admin/conversation-log.js";
import { resolveConfig } from "../src/resolve-config.js";

/**
 * One conversation log per fixture chat: a human prompt, an answer carrying a
 * skill load and a failed tool call, and — for the second chat — a second turn.
 */
function logFor(
  title: string,
  prompt: string,
  answer: string,
): StoredSessionEvent[] {
  return [
    { seq: 0, type: "session/title", data: { title }, time: 1_700_000_000_000 },
    {
      seq: 1,
      type: "user/message",
      data: {
        content: [{ type: "text", text: prompt }],
        source: { kind: "user" },
      },
      time: 1_700_000_001_000,
    },
    {
      seq: 2,
      type: "assistant/message",
      data: {
        message: {
          role: "assistant",
          content: [{ type: "text", text: answer }],
          source: { kind: "model", provider: "zai", model: "glm-4.7" },
        },
        usage: { inputTokens: 100, outputTokens: 25 },
      },
      time: 1_700_000_002_000,
    },
    {
      seq: 3,
      type: "tool/call",
      data: {
        callId: "c1",
        name: "skill",
        arguments: '{"name":"release-notes"}',
      },
      time: 1_700_000_002_100,
    },
    {
      seq: 4,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "loaded" }],
            },
          ],
        },
      },
      time: 1_700_000_002_200,
    },
    {
      seq: 5,
      type: "tool/call",
      data: {
        callId: "c2",
        name: "git_readonly",
        arguments: '{"repository":"api"}',
      },
      time: 1_700_000_003_000,
    },
    {
      seq: 6,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c2",
              content: [{ type: "text", text: "not a repository" }],
              isError: true,
            },
          ],
        },
        error: { name: "git", code: "E1" },
      },
      time: 1_700_000_003_500,
    },
  ];
}

/**
 * One deployment's live registries. Empty by default: most admin reads answer
 * from the stores, and the effective-capability counts of a deployment with no
 * catalogue are all zero.
 */
function harness(
  catalog: {
    readonly tools?: readonly string[];
    readonly skills?: readonly string[];
    /** Skills that declare an audience in their own SKILL.md metadata. */
    readonly declared?: readonly {
      readonly name: string;
      readonly roles: readonly string[];
    }[];
    /** The deployment's pinned tool policy, part of every profile. */
    readonly pinned?: readonly string[];
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-admin-"));
  const accounts = new QaAccounts(path.join(root, "accounts.json"), {
    sessionTtlDays: 30,
    allowRegistration: true,
  });
  const admin = accounts.register("admin@example.com", "password-1");
  const reviewer = accounts.register("reviewer@example.com", "password-1");
  const alice = accounts.register("alice@example.com", "password-1");
  const bob = accounts.register("bob@example.com", "password-1");
  const accounts2 = accounts;
  accounts2.setUserRole("admin@example.com", "admin");
  accounts2.setUserRole("reviewer@example.com", "reviewer");

  const skillNames = [...(catalog.skills ?? [])];
  const ctx = {
    tools: {
      schemas: () => (catalog.tools ?? []).map((name) => ({ name })),
    },
    get: (service: string) => {
      const declared = catalog.declared ?? [];
      if (
        service !== "skills" ||
        (skillNames.length === 0 && declared.length === 0)
      ) {
        return undefined;
      }
      const names = [
        ...new Set([...skillNames, ...declared.map(({ name }) => name)]),
      ];
      return {
        snapshot: async () => ({
          skills: names.map((name) => ({
            name,
            description: `${name} skill`,
            provider: "plugin",
            source: "plugin",
            invocation: { modelInvocable: true, userInvocable: true },
          })),
        }),
        get: async (name: string) => {
          const entry = declared.find((candidate) => candidate.name === name);
          return entry === undefined
            ? { metadata: undefined }
            : {
                metadata: {
                  "qa-surface": {
                    version: 1,
                    audience: { type: "subroles", include: [...entry.roles] },
                  },
                },
              };
        },
      };
    },
  } as unknown as Context;
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
  const roles = new QaRoleRepository(path.join(root, "roles.json"));
  roles.create(admin.user.id, {
    id: "analyst",
    name: "Analyst",
    enabled: true,
    capabilities: {
      tools: { always: ["read"], skillGrantable: [] },
      skills: ["release-notes"],
    },
  });
  roles.create(admin.user.id, {
    id: "developer",
    name: "Developer",
    enabled: true,
    capabilities: {
      tools: { always: ["git"], skillGrantable: [] },
      skills: [],
    },
  });
  accounts.setAccess(alice.user.id, {
    allowedSubroles: ["analyst"],
    defaultSubrole: "analyst",
  });
  accounts.setAccess(bob.user.id, {
    allowedSubroles: ["developer"],
    defaultSubrole: "developer",
  });
  const access = new QaAccessService(ctx, {
    accounts: () => accounts,
    config: () =>
      resolveConfig({
        lockdown: { toolPolicy: { allow: [...(catalog.pinned ?? [])] } },
      }),
    logger,
    repository: roles,
  });
  const quality = new QaQualityStore(path.join(root, "quality.json"));
  const conversations: Record<string, StoredSessionEvent[]> = {
    "session-alice": logFor(
      "Release report",
      "Build the release report",
      "Here is the report",
    ),
    "session-bob": logFor("SQL migration", "Write the migration", "Done"),
  };
  const service = new QaAdminService({
    accounts: () => accounts,
    quality: () => quality,
    roles: () => roles,
    access: () => access,
    sessionLog: staticSessionLogReader({
      sessions: [
        {
          id: "session-alice",
          createdAt: 1_700_000_000_000,
          agentPreset: "qa-research",
        },
        { id: "session-bob", createdAt: 1_700_000_100_000 },
      ],
      events: conversations,
    }),
    logger,
  });
  accounts.reserveSession(alice.token, "session-alice", {
    subroleId: "analyst",
  });
  accounts.reserveSession(bob.token, "session-bob", { subroleId: "developer" });
  return {
    service,
    accounts,
    quality,
    roles,
    admin,
    reviewer,
    alice,
    bob,
  };
}

function refusal(call: () => Promise<unknown>): Promise<QaAccountsError> {
  return call().then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error as QaAccountsError,
  );
}

describe("admin authorization gates", () => {
  it("refuses every administrative read to an ordinary user", async () => {
    const { service, alice } = harness();
    for (const call of [
      () => service.users(alice.token, {}, undefined, undefined),
      () => service.conversations(alice.token, {}, undefined, undefined),
      () => service.feedback(alice.token, {}, undefined, undefined),
      () => service.reviewQueue(alice.token, undefined, undefined),
      () => service.metrics(alice.token),
      () => service.audit(alice.token, {}, undefined, undefined),
      () => service.overview(alice.token),
    ]) {
      const error = await refusal(call);
      expect(error).toBeInstanceOf(QaAccountsError);
      expect(error.reason).toBe("forbidden");
    }
  });

  it("lets a reviewer read conversations and answer them, but not manage users", async () => {
    const { service, reviewer } = harness();
    const page = await service.conversations(
      reviewer.token,
      {},
      undefined,
      undefined,
    );
    expect(page.total).toBe(2);
    expect(
      await refusal(() =>
        service.users(reviewer.token, {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.updateUser(reviewer.token, "someone", { disabled: true }),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.audit(reviewer.token, {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "forbidden" });
  });

  it("refuses an unknown token outright", async () => {
    const { service } = harness();
    expect(
      await refusal(() =>
        service.users("not-a-token", {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "auth-required" });
  });
});

describe("admin user management", () => {
  it("lists accounts with their role, status and assignment counters", async () => {
    const { service, admin, alice } = harness();
    const page = await service.users(admin.token, {}, undefined, undefined);
    expect(page.total).toBe(4);
    const row = page.items.find((item) => item.id === alice.user.id);
    expect(row?.role).toBe("user");
    expect(row?.access.defaultSubrole).toBe("analyst");
    expect(row?.conversations).toBe(1);
    expect(row?.fullName).toBe("");
  });

  it("filters the list by role, status and subrole", async () => {
    const { service, admin } = harness();
    const reviewers = await service.users(
      admin.token,
      { role: "reviewer" },
      undefined,
      undefined,
    );
    expect(reviewers.items.map((row) => row.email)).toEqual([
      "reviewer@example.com",
    ]);
    const developers = await service.users(
      admin.token,
      { subroleId: "developer" },
      undefined,
      undefined,
    );
    expect(developers.items.map((row) => row.email)).toEqual([
      "bob@example.com",
    ]);
    expect(
      (
        await service.users(
          admin.token,
          { status: "disabled" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(0);
  });

  it("changes a role, disables an account and writes both to the audit", async () => {
    const { service, admin, alice, quality } = harness();
    const detail = await service.updateUser(admin.token, alice.user.id, {
      role: "reviewer",
      disabled: true,
    });
    expect(detail.user.role).toBe("reviewer");
    expect(detail.user.disabled).toBe(true);
    const actions = quality.auditEvents().map((event) => event.action);
    expect(actions).toContain("authorization.changed");
    expect(actions).toContain("user.disabled");
    // A disabled user keeps their history.
    const page = await service.conversations(
      admin.token,
      {},
      undefined,
      undefined,
    );
    expect(
      page.items.find((row) => row.conversationId === "session-alice"),
    ).toMatchObject({ displayName: "alice" });
  });

  it("refuses to leave the deployment without an enabled administrator", async () => {
    const { service, admin } = harness();
    expect(
      await refusal(() =>
        service.updateUser(admin.token, admin.user.id, { role: "user" }),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.updateUser(admin.token, admin.user.id, { disabled: true }),
      ),
    ).toMatchObject({ reason: "forbidden" });
  });

  it("refuses an assignment naming a role that does not exist", async () => {
    const { service, admin, alice } = harness();
    expect(
      await refusal(() =>
        service.updateUser(admin.token, alice.user.id, {
          access: { allowedSubroles: ["sales"], defaultSubrole: "sales" },
        }),
      ),
    ).toMatchObject({ reason: "invalid-role" });
  });

  it("reports the effective capability counts of each assigned role", async () => {
    const { service, admin, alice } = harness();
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        tools: 0,
        grantableTools: 0,
        skills: 0,
      },
    ]);
    expect(detail.activity.conversations).toBe(1);
    expect(detail.activity.messages).toBe(2);
  });

  it("counts the pinned tools a profile resolves, not only its own list", async () => {
    const { service, admin, alice } = harness({
      // Every session resolves the deployment's pinned set on top of the role:
      // reporting the configured lists alone read as "0 tools" for a profile
      // whose chats run with the whole pinned list.
      pinned: ["glob", "grep", "ask_user_question"],
      tools: ["glob", "grep", "read", "git"],
      skills: ["release-notes"],
      declared: [{ name: "sales-playbook", roles: ["analyst"] }],
    });
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        // glob and grep are pinned and mounted, read is the role's own tool;
        // ask_user_question is pinned but unmounted, git is not configured.
        tools: 3,
        grantableTools: 0,
        // The assigned skill and the one whose own SKILL.md names this role.
        skills: 2,
      },
    ]);
  });

  it("reports the skill-grantable ceiling apart from visible tools", async () => {
    const { service, admin, alice, roles, accounts } = harness({
      tools: ["git", "read"],
    });
    roles.update(admin.user.id, "developer", {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: ["git", "ghost"] },
        skills: [],
      },
    });
    accounts.setAccess(alice.user.id, {
      allowedSubroles: ["analyst", "developer"],
      defaultSubrole: "analyst",
    });
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        tools: 1,
        grantableTools: 0,
        skills: 0,
      },
      {
        subroleId: "developer",
        name: "Developer",
        // A grantable tool is a ceiling, not a visible tool: git counts there
        // and nowhere else, and ghost is not mounted at all.
        tools: 0,
        grantableTools: 1,
        skills: 0,
      },
    ]);
  });
});

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
        async list() {
          return [{ id: "session-alice", createdAt: 1 }];
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
});

describe("feedback and reviews", () => {
  it("records a rating on the owner's own message and updates it in place", async () => {
    const { service, alice, quality } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
      comment: "wrong project",
    });
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "positive",
    });
    expect(quality.allFeedback()).toHaveLength(1);
    expect(quality.allFeedback()[0]?.rating).toBe("positive");
  });

  it("refuses to rate someone else's answer", async () => {
    const { service, bob } = harness();
    expect(() =>
      service.rateMessage(bob.token, "session-alice", "2", {
        rating: "negative",
      }),
    ).toThrow(/only be given on your own conversations/u);
  });

  it("surfaces negative feedback in the review queue, answered by a review", async () => {
    const { service, admin, reviewer, alice } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    const queue = await service.reviewQueue(admin.token, undefined, undefined);
    const item = queue.items.find(
      (row) =>
        row.conversationId === "session-alice" &&
        row.reason === "negative_feedback",
    );
    expect(item?.priority).toBe("high");
    expect(item?.displayName).toBe("alice");
    expect(item?.status).toBe("unreviewed");

    const review = service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      messageId: "2",
      status: "reviewed",
      issues: ["answer.incorrect", "context.missing_knowledge"],
      severity: "major",
      notes: "knowledge gap",
      target: "knowledge",
      suggestedAction: "add the release process",
    });
    expect(review.reviewerId).toBe(reviewer.user.id);
    const after = await service.reviewQueue(admin.token, undefined, undefined);
    expect(
      after.items.find(
        (row) =>
          row.conversationId === "session-alice" &&
          row.reason === "negative_feedback",
      )?.status,
    ).toBe("reviewed");
  });

  it("keeps a needs-followup review in the queue and audits the verdict", async () => {
    const { service, reviewer, quality, admin } = harness();
    service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      status: "needs_followup",
      issues: ["tool.failure"],
      severity: "minor",
    });
    const queue = await service.reviewQueue(admin.token, undefined, undefined);
    expect(
      queue.items.some(
        (row) =>
          row.conversationId === "session-alice" &&
          row.reason === "manual" &&
          row.status === "needs_followup",
      ),
    ).toBe(true);
    expect(quality.auditEvents().map((event) => event.action)).toContain(
      "conversation.reviewed",
    );
  });

  it("pages the feedback table and filters it", async () => {
    const { service, admin, alice, bob } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["missing_information"],
    });
    service.rateMessage(bob.token, "session-bob", "2", { rating: "positive" });
    const all = await service.feedback(admin.token, {}, undefined, undefined);
    expect(all.total).toBe(2);
    expect(all.items[0]?.conversationTitle).toBeDefined();
    const negatives = await service.feedback(
      admin.token,
      { rating: "negative" },
      undefined,
      undefined,
    );
    expect(negatives.items).toHaveLength(1);
    expect(negatives.items[0]?.displayName).toBe("alice");
    expect(
      (
        await service.feedback(
          admin.token,
          { reason: "missing_information" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(1);
    const first = await service.feedback(admin.token, {}, undefined, 1);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.feedback(
      admin.token,
      {},
      first.nextCursor ?? undefined,
      1,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

describe("quality metrics and audit", () => {
  it("aggregates ratings, subrole breakdown and issues", async () => {
    const { service, admin, reviewer, alice, bob } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    service.rateMessage(bob.token, "session-bob", "2", { rating: "positive" });
    service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      messageId: "2",
      status: "reviewed",
      issues: ["answer.incorrect"],
      severity: "major",
    });
    const metrics = await service.metrics(admin.token);
    expect(metrics.conversations).toBe(2);
    expect(metrics.activeUsers).toBe(2);
    expect(metrics.assistantMessages).toBe(2);
    expect(metrics.ratedMessages).toBe(2);
    expect(metrics.positiveRatings).toBe(1);
    expect(metrics.negativeRatings).toBe(1);
    expect(metrics.positiveRate).toBe(0.5);
    expect(metrics.ratingRate).toBe(1);
    expect(metrics.unreviewedNegatives).toBe(0);
    expect(metrics.reviewedItems).toBe(1);
    expect(metrics.issues).toEqual([{ issue: "answer.incorrect", count: 1 }]);
    expect(metrics.bySubrole.map((row) => row.key)).toEqual([
      "analyst",
      "developer",
    ]);
    expect(metrics.trend).toHaveLength(1);
  });

  it("raises an overview alert for unanswered negative feedback", async () => {
    const { service, admin, alice } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    const overview = await service.overview(admin.token);
    expect(overview.alerts.map((alert) => alert.code)).toContain(
      "unreviewed-negatives",
    );
    expect(overview.queue.length).toBeGreaterThan(0);
    expect(overview.recentFeedback[0]?.rating).toBe("negative");
  });

  it("merges capability-policy events into one audit timeline", async () => {
    const { service, admin, roles, alice } = harness();
    roles.updateCommon(admin.user.id, {
      tools: { always: ["read"], skillGrantable: [] },
      skills: [],
    });
    service.updateUser(admin.token, alice.user.id, { role: "reviewer" });
    const page = await service.audit(admin.token, {}, undefined, undefined);
    const actions = page.items.map((event) => event.action);
    expect(actions).toContain("common_capabilities.updated");
    expect(actions).toContain("authorization.changed");
    // Newest first.
    const newest = page.items[0]?.timestamp ?? "";
    const oldest = page.items.at(-1)?.timestamp ?? "";
    expect(newest >= oldest).toBe(true);
    const onlyRole = await service.audit(
      admin.token,
      { action: "authorization.changed" },
      undefined,
      undefined,
    );
    expect(onlyRole.total).toBe(1);
  });

  it("pages long lists with a cursor that survives new rows", async () => {
    const { service, admin } = harness();
    const first = await service.conversations(admin.token, {}, undefined, 1);
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.conversations(
      admin.token,
      {},
      first.nextCursor ?? undefined,
      1,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.conversationId).not.toBe(
      first.items[0]?.conversationId,
    );
    expect(second.nextCursor).toBeNull();
  });
});
