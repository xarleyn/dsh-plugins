import { resolveConfig } from "../src/config.js";
import {
  Bitrix24Provider,
  parseBitrixWebhook,
} from "../src/providers/bitrix24.js";

const CREDENTIAL = JSON.stringify({
  webhookBaseUrl: "https://company.bitrix24.ru/rest/42/abcdefghijk",
});

interface StubCall {
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly headers: unknown;
}

function stub(bodies: Record<string, unknown> = {}) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf("/") + 1).replace(/\.json$/u, "");
    calls.push({
      method,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: init?.headers,
    });
    return new Response(JSON.stringify(bodies[method] ?? { result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

const PROFILE = {
  result: { ID: "7", NAME: "Иван", LAST_NAME: "Иванов" },
};

describe("Bitrix24 provider", () => {
  it("accepts only bounded HTTPS Bitrix webhook URLs", () => {
    const parsed = parseBitrixWebhook(
      "https://company.bitrix24.ru/rest/42/abcdefghijk/",
      [".bitrix24.ru"],
    );
    expect(parsed.portal).toBe("company.bitrix24.ru");
    expect(parsed.credential).toContain("abcdefghijk");
    for (const invalid of [
      "http://company.bitrix24.ru/rest/42/abcdefghijk",
      "https://company.bitrix24.ru:444/rest/42/abcdefghijk",
      "https://evil.example/rest/42/abcdefghijk",
      "https://bitrix24.ru/rest/42/abcdefghijk",
      "https://company.bitrix24.ru/rest/42/abcdefghijk?next=1",
      "https://company.bitrix24.ru/other/42/abcdefghijk",
    ]) {
      expect(() => parseBitrixWebhook(invalid, [".bitrix24.ru"])).toThrow(
        /webhook URL/u,
      );
    }
  });

  it("uses fixed read-only methods and does not put credentials in headers/body", async () => {
    const { calls, fetcher } = stub({
      profile: PROFILE,
      scope: { result: ["crm", "im"] },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.validate({ credential: CREDENTIAL });
    await provider.execute({ credential: CREDENTIAL }, "crm.get", {
      entityTypeId: 2,
      id: 9,
    });
    expect(calls.map(({ method }) => method)).toEqual([
      "profile",
      "scope",
      "crm.item.get",
    ]);
    expect(JSON.stringify(calls.map(({ headers }) => headers))).not.toContain(
      "abcdefghijk",
    );
    expect(calls[2]?.body).toEqual({ entityTypeId: 2, id: 9 });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "raw_rest", {}),
    ).rejects.toThrow(/Unsupported/u);
  });

  it("sends the documented parameter shape for product rows and activities", async () => {
    const { calls, fetcher } = stub({
      "crm.item.productrow.list": { result: { productRows: [] } },
      "crm.activity.list": { result: [], total: 120, next: 50 },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute({ credential: CREDENTIAL }, "crm.productRows", {
      ownerType: "D",
      ownerId: 13142,
    });
    expect(calls[0]?.body).toEqual({
      filter: { "=ownerType": "D", "=ownerId": 13142 },
      start: 0,
    });

    await provider.execute({ credential: CREDENTIAL }, "crm.activities", {
      entityTypeId: 2,
      entityId: 9,
      openOnly: true,
      deadlineTo: "2026-09-30",
    });
    expect(calls[1]?.body).toMatchObject({
      filter: {
        OWNER_TYPE_ID: 2,
        OWNER_ID: 9,
        COMPLETED: "N",
        "<=DEADLINE": "2026-09-30",
      },
      start: 0,
    });
  });

  it("maps timeline entity ids to Bitrix entity names and refuses the rest", async () => {
    const { calls, fetcher } = stub();
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute({ credential: CREDENTIAL }, "crm.timeline", {
      entityTypeId: 2,
      entityId: 9,
    });
    expect(calls[0]?.body).toMatchObject({
      filter: { ENTITY_TYPE: "deal", ENTITY_ID: 9 },
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.timeline", {
        entityTypeId: 7,
        entityId: 9,
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(1);
  });

  it("derives the numeric chat id that message search expects", async () => {
    const { calls, fetcher } = stub();
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute({ credential: CREDENTIAL }, "chat.messageSearch", {
      dialogId: "chat1489",
      query: "договор",
    });
    expect(calls[0]?.body).toMatchObject({
      CHAT_ID: 1489,
      SEARCH_MESSAGE: "договор",
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "chat.messageSearch", {
        dialogId: "contract-1489",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("defaults owner scoped reads to the connected Bitrix user", async () => {
    const { calls, fetcher } = stub();
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await provider.execute(
      { credential: CREDENTIAL, externalUserId: "7" },
      "tasks.list",
      { assignedToMe: true, openOnly: true },
    );
    expect(calls[0]?.body).toMatchObject({
      filter: { RESPONSIBLE_ID: 7, "!REAL_STATUS": 5 },
    });

    await provider.execute(
      { credential: CREDENTIAL, externalUserId: "7" },
      "calendar.events",
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(calls[1]?.body).toEqual({
      type: "user",
      ownerId: 7,
      from: "2026-09-01",
      to: "2026-09-30",
    });

    // Without a stored Bitrix user the "mine" default must fail closed.
    await expect(
      provider.execute({ credential: CREDENTIAL }, "calendar.events", {}),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("answers lists with one items envelope and keeps the pagination cursor", async () => {
    const { fetcher } = stub({
      "crm.item.list": { result: { items: [{ id: 1 }] }, total: 51, next: 50 },
      "crm.activity.list": { result: [{ ID: 5 }], total: 2 },
      "disk.file.search": { result: [{ ID: 9 }] },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.search", {
        entityTypeId: 2,
      }),
    ).resolves.toEqual({
      items: [{ id: 1 }],
      pagination: { start: 0, next: 50, total: 51 },
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "crm.activities", {}),
    ).resolves.toEqual({
      items: [{ ID: 5 }],
      pagination: { start: 0, total: 2 },
    });
    await expect(
      provider.execute({ credential: CREDENTIAL }, "disk.search", {
        query: "презентация",
      }),
    ).resolves.toEqual({ items: [{ ID: 9 }], pagination: { start: 0 } });
  });

  it("pages IM searches with OFFSET and still reports the cursor as start", async () => {
    const { calls, fetcher } = stub({
      "im.search.chat.list": { result: [{ id: 3 }], next: 40 },
    });
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    await expect(
      provider.execute({ credential: CREDENTIAL }, "chat.search", {
        query: "договор",
        start: 20,
      }),
    ).resolves.toEqual({
      items: [{ id: 3 }],
      pagination: { start: 20, next: 40 },
    });
    expect(calls[0]?.body).toEqual({ FIND: "договор", OFFSET: 20, LIMIT: 10 });
  });

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
});
