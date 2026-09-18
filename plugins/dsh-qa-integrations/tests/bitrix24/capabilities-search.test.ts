import { resolveConfig } from "../../src/config.js";
import { Bitrix24Provider } from "../../src/providers/bitrix24/index.js";
import { createBitrix24Tools } from "../../src/providers/bitrix24/tools.js";
import { CREDENTIAL, PROFILE, stub } from "./shared.js";

describe("Bitrix24 provider", () => {
  it("projects id-keyed responses into ordered arrays", async () => {
    const { fetcher } = stub({
      "imopenlines.session.history.get": {
        result: {
          sessionId: 321,
          chatId: 1489,
          message: { "12": { id: 12 }, "9": { id: 9 } },
          users: { "7": { id: 7 } },
          files: {},
        },
      },
      "im.dialog.messages.search": {
        result: {
          messages: [{ id: 1 }],
          users: [{ id: 7 }],
          files: [],
          reactions: [{ messageId: 1 }],
        },
      },
      "calendar.accessibility.get": {
        result: { "7": [{ ACCESSIBILITY: "busy" }], "9": [] },
      },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "openlines.history", {
        sessionId: 321,
      }),
    ).resolves.toEqual({
      sessionId: 321,
      chatId: 1489,
      messages: [{ id: 9 }, { id: 12 }],
      users: [{ id: 7 }],
      files: [],
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "chat.messageSearch", {
        dialogId: "chat1489",
      }),
    ).resolves.toEqual({
      messages: [{ id: 1 }],
      users: [{ id: 7 }],
      files: [],
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "calendar.accessibility", {
        from: "2026-09-01",
        to: "2026-09-02",
        users: [7, 9],
      }),
    ).resolves.toEqual({
      availability: [
        { userId: "7", events: [{ ACCESSIBILITY: "busy" }] },
        { userId: "9", events: [] },
      ],
    });
  });

  it("offers only the capabilities the connected webhook was granted", async () => {
    const { calls, fetcher } = stub({
      profile: PROFILE,
      scope: { result: ["crm", "im", "task", "department"] },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    const validation = await provider.validate({ credential: CREDENTIAL });
    expect(validation.capabilities).toEqual([
      "crm.read",
      "chat.read",
      "department.read",
      "tasks.read",
    ]);
    expect(validation.externalUserId).toBe("7");
    expect(validation.displayName).toBe("Иван Иванов");
    expect(calls.map(({ method }) => method)).toEqual(["profile", "scope"]);
  });

  it("falls back to the deployment switches when scope cannot be read", async () => {
    const { fetcher } = stub({
      profile: PROFILE,
      scope: { error: "insufficient_scope" },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    const validation = await provider.validate({ credential: CREDENTIAL });
    expect(validation.capabilities).toEqual([
      "crm.read",
      "chat.read",
      "openlines.read",
      "user.read",
      "department.read",
      "tasks.read",
      "calendar.read",
      "disk.read",
    ]);
  });

  it("honours a deployment that switches a scope off", async () => {
    const { fetcher } = stub({
      profile: PROFILE,
      scope: { result: ["crm", "im", "task"] },
    });
    const provider = new Bitrix24Provider(
      resolveConfig({ bitrix24: { tasksRead: false, chatRead: false } }),
      fetcher,
    );
    const validation = await provider.validate({ credential: CREDENTIAL });
    expect(validation.capabilities).toEqual(["crm.read"]);
  });

  it("offers the write capability only when the deployment switch is on", async () => {
    const { fetcher } = stub({
      profile: PROFILE,
      scope: { result: ["crm"] },
    });
    const off = await new Bitrix24Provider(resolveConfig(), fetcher).validate({
      credential: CREDENTIAL,
    });
    expect(off.capabilities).toEqual(["crm.read"]);

    const on = await new Bitrix24Provider(
      resolveConfig({ bitrix24: { crmCommentWrite: true } }),
      fetcher,
    ).validate({ credential: CREDENTIAL });
    expect(on.capabilities).toEqual(["crm.read", "crm.comment.write"]);
  });

  it("narrows crm.search with stages, categories, freshness and a pinned order", async () => {
    const { calls, fetcher } = stub({
      "crm.item.list": { result: { items: [] }, total: 0 },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute({ credential: CREDENTIAL }, "crm.search", {
      entityTypeId: 2,
      stageId: "C12|WIN",
      categoryId: 3,
      openOnly: true,
      createdSince: "2026-09-01",
      updatedSince: "2026-09-15",
      orderBy: "updatedTime",
      orderDir: "desc",
    });
    expect(calls[0]?.method).toBe("crm.item.list");
    expect(calls[0]?.body).toEqual({
      entityTypeId: 2,
      filter: {
        stageId: "C12|WIN",
        categoryId: 3,
        closed: "N",
        ">=createdTime": "2026-09-01",
        ">=updatedTime": "2026-09-15",
      },
      order: { updatedTime: "DESC" },
      select: ["id", "title", "createdTime", "updatedTime", "assignedById"],
      start: 0,
    });
  });

  it("pins the search order by default and refuses nonsense ordering", async () => {
    const { calls, fetcher } = stub({
      "crm.item.list": { result: { items: [] }, total: 0 },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute({ credential: CREDENTIAL }, "crm.search", {
      entityTypeId: 2,
    });
    expect(calls[0]?.body).toMatchObject({ order: { id: "ASC" } });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.search", {
        entityTypeId: 2,
        orderBy: "budget",
      }),
    ).rejects.toThrow(/orderBy/u);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.search", {
        entityTypeId: 2,
        orderDir: "sideways",
      }),
    ).rejects.toThrow(/orderDir/u);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.search", {
        entityTypeId: 1,
        openOnly: true,
      }),
    ).rejects.toThrow(/openOnly/u);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.search", {
        entityTypeId: 2,
        query: "   ",
      }),
    ).rejects.toThrow(/query is invalid/u);
  });

  it("names the repair for an empty search query at the tool boundary", async () => {
    const search = createBitrix24Tools({
      broker: {
        call: async () => ({
          provider: "bitrix24",
          operation: "crm.search",
          data: {},
        }),
      } as never,
      principalForSession: () => ({ userId: "1" }),
    }).find((tool) => tool.name === "bitrix_search_crm");
    expect(search).toBeDefined();
    // The audited loop: an empty query answered with a bare "query is invalid"
    // was retried verbatim instead of repaired.
    await expect(
      search!.execute(
        { entityTypeId: 2, query: "   " } as never,
        {
          agent: { session: { header: { id: "s1" } } },
        } as never,
      ),
    ).rejects.toThrow(/query is invalid: a non-empty title substring/u);
  });

  it("sends the documented field shape for the timeline comment", async () => {
    const { calls, fetcher } = stub({
      "crm.timeline.comment.add": { result: { id: 9001 } },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    const result = await provider.execute(
      { credential: CREDENTIAL },
      "crm.timelineCommentAdd",
      { entityTypeId: 2, entityId: 10, comment: "Передали дистрибьютору" },
    );
    expect(result).toEqual({ id: 9001 });
    expect(calls[0]?.method).toBe("crm.timeline.comment.add");
    expect(calls[0]?.body).toEqual({
      fields: {
        ENTITY_TYPE: "deal",
        ENTITY_ID: 10,
        COMMENT: "Передали дистрибьютору",
      },
    });
    for (const invalid of [
      { entityTypeId: 9, entityId: 10, comment: "smart processes stay out" },
      { entityTypeId: 2, entityId: 10, comment: "" },
      { entityTypeId: 2, entityId: 10 },
    ]) {
      await expect(
        provider.execute(
          { credential: CREDENTIAL },
          "crm.timelineCommentAdd",
          invalid,
        ),
      ).rejects.toBeDefined();
    }
  });
});
