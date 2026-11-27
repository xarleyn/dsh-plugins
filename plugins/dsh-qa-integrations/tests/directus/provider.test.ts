import { randomBytes } from "node:crypto";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../../src/broker.js";
import { resolveConfig } from "../../src/config.js";
import DirectusProvider from "../../src/providers/directus/index.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import { resolveManagedServiceCredentials } from "../../src/service-credentials/config.js";
import { ServiceCredentialRegistry } from "../../src/service-credentials/registry.js";
import { createIntegrationTools } from "../../src/tools.js";

const fileId = "648835be-391b-4ea5-a5cf-eef956ba42fd";
const first = {
  id: "north",
  label: "North",
  baseUrl: "https://north.example.com/data",
  collections: [
    {
      name: "demo_records",
      primaryKey: "id",
      fields: ["id", "title", "attachment"],
      fileFields: ["attachment"],
    },
  ],
};
const second = {
  ...first,
  id: "south",
  label: "South",
  baseUrl: "https://south.example.com",
};
const config = resolveConfig({ directus: { instances: [first, second] } });

function setup(directusConfig = config) {
  const requests: {
    url: URL;
    method: string | undefined;
    auth: string | null;
  }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    requests.push({ url, auth, method: init?.method });
    const path = url.pathname.replace(/^\/data(?=\/)/u, "");
    if (path === "/users/me")
      return Response.json({ data: { id: "demo-reader" } });
    const record = {
      id: 1,
      title: url.hostname,
      attachment: fileId,
      private_note: "should not reach the model",
    };
    if (path === "/items/demo_records")
      return Response.json({ data: [record] });
    if (path === "/items/demo_records/2")
      return new Response(null, { status: 403 });
    if (path === "/items/demo_records/1")
      return Response.json({ data: record });
    if (path === `/files/${fileId}`) {
      return Response.json({
        data: {
          id: fileId,
          filename_download: "sample.pdf",
          type: "application/pdf",
          filename_disk: "hidden",
        },
      });
    }
    return new Response(null, { status: 404 });
  };
  const [north, south] = directusConfig.directus.instances.map(
    (instance) => new DirectusProvider(instance, directusConfig, fetcher),
  );
  if (north === undefined || south === undefined)
    throw Error("Expected two Directus instances");
  return { requests, north, south };
}

describe("Directus read-only provider", () => {
  it("uses a scoped managed token only while the current chat has the required role", async () => {
    const { requests, north } = setup(
      resolveConfig({
        directus: {
          instances: [
            {
              ...first,
              collections: [
                ...first.collections,
                { name: "other_records", primaryKey: "id", fields: ["id"] },
              ],
            },
            second,
          ],
        },
      }),
    );
    const providers = new IntegrationProviderRegistry();
    providers.register(north);
    const repository = new IntegrationRepository(":memory:");
    const secrets = new SecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as PluginLogger;
    const profile = {
      id: "north-reader",
      provider: north.id,
      instance: "north",
      requiredQaSubrole: "records-reader",
      credential: { secretEnv: "DIRECTUS_DEMO_TOKEN" },
      resources: { collections: ["demo_records"] },
    };
    const serviceCredentials = new ServiceCredentialRegistry(
      resolveManagedServiceCredentials({ enabled: true, profiles: [profile] }),
      (_provider, id) => north.instancePortal(id),
      { env: { DIRECTUS_DEMO_TOKEN: "fake-managed-token" } },
    );
    let activeRole = "general";
    const broker = new IntegrationBroker(
      repository,
      secrets,
      providers,
      logger,
      {
        serviceCredentials,
        serviceCredentialRoleForSession: () => activeRole,
      },
    );
    const principal = { userId: "reader-without-a-token" };
    const request = {
      provider: north.id,
      operation: "items.get",
      input: { collection: "demo_records", id: 1 },
      sourceSessionId: "demo-session",
    };
    try {
      expect(broker.summary(principal, north.id).status).toBe("not_connected");
      await expect(broker.call(principal, request)).rejects.toMatchObject({
        code: "OperationDeniedByPolicy",
      });
      expect(repository.find(principal, north.id)).toBeUndefined();
      expect(requests).toHaveLength(0);

      activeRole = "records-reader";
      const catalog = await broker.call(principal, {
        ...request,
        operation: "collections.list",
        input: {},
      });
      expect(catalog.data["collections"]).toMatchObject([
        { name: "demo_records" },
      ]);
      await expect(broker.call(principal, request)).resolves.toMatchObject({
        data: { item: { id: 1 } },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.auth).toBe("Bearer fake-managed-token");
      await expect(
        broker.call(principal, {
          ...request,
          input: { collection: "other_records", id: 1 },
        }),
      ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });

      activeRole = "general";
      await expect(broker.call(principal, request)).rejects.toMatchObject({
        code: "OperationDeniedByPolicy",
      });
      expect(requests).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  it("keeps two connections under the same account isolated, including policy and disconnect", async () => {
    const { requests, north, south } = setup();
    const registry = new IntegrationProviderRegistry();
    registry.register(north);
    registry.register(south);
    const repository = new IntegrationRepository(":memory:");
    const secrets = new SecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as PluginLogger;
    const broker = new IntegrationBroker(repository, secrets, registry, logger);
    const principal = { userId: "demo-reader" };
    const tools = createIntegrationTools({
      broker,
      principalForSession: (id) =>
        id === "demo-session" ? principal : undefined,
      enabledProviders: [north.id, south.id],
    });
    const tool = tools.find((entry) => entry.name === "directus_item_get");
    if (tool === undefined) throw Error("Directus tool was not mounted");
    const input = { collection: "demo_records", id: 1 };
    const context = {
      agent: { session: { header: { id: "demo-session" } } },
    } as never;
    try {
      await broker.connect(principal, north.id, { token: "fake-token-north" });
      await broker.connect(principal, south.id, { token: "fake-token-south" });
      expect(broker.list(principal).map((item) => item.status)).toEqual([
        "connected",
        "connected",
      ]);
      broker.patchPolicy(principal, north.id, {
        operation: "items.read",
        mode: "allow",
      });
      broker.patchPolicy(principal, south.id, {
        operation: "items.read",
        mode: "deny",
      });
      await expect(
        tool.execute({ ...input, instance: "south" }, context),
      ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
      broker.patchPolicy(principal, south.id, {
        operation: "items.read",
        mode: "allow",
      });
      const result = await Promise.all([
        tool.execute({ ...input, instance: "north" }, context),
        tool.execute({ ...input, instance: "south" }, context),
      ]);
      expect(result).toMatchObject([
        {
          provider: north.id,
          data: {
            source: "north",
            address:
              "https://north.example.com/data/admin/content/demo_records/1",
            item: { title: "north.example.com" },
          },
        },
        {
          provider: south.id,
          data: { source: "south", item: { title: "south.example.com" } },
        },
      ]);
      expect(result[0]).not.toHaveProperty("data.item.private_note");
      expect(
        requests.every(
          ({ url, auth, method }) =>
            method === "GET" &&
            !url.search.includes("token") &&
            auth === `Bearer fake-token-${url.hostname.split(".")[0]}`,
        ),
      ).toBe(true);
      broker.disconnect(principal, north.id);
      expect(broker.summary(principal, south.id).status).toBe("connected");
      await expect(
        tool.execute({ ...input, instance: "north" }, context),
      ).rejects.toMatchObject({ code: "IntegrationNotConnected" });
    } finally {
      repository.close();
    }
  });

  it("bounds queries and refuses unknown paths, fields and write operations before fetching", async () => {
    const { requests, north, south } = setup();
    const context = {
      credential: north.parseCredential("fake-token-north").credential,
    };
    await expect(
      south.execute(context, "items.get", {
        collection: "demo_records",
        id: 1,
      }),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    await expect(
      north.execute(context, "items.update", {}),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      north.execute(context, "items.get", {
        collection: "directus_users",
        id: 1,
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      north.execute(context, "items.get", {
        collection: "demo_records",
        id: "../1",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      north.execute(context, "items.list", {
        collection: "demo_records",
        limit: 26,
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      north.execute(context, "items.list", {
        collection: "demo_records",
        filters: [{ field: "private_note", op: "contains", value: "x" }],
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(requests).toHaveLength(0);
    await expect(
      north.execute(context, "items.list", {
        collection: "demo_records",
        limit: 1,
        sort: "-title",
        filters: [{ field: "title", op: "contains", value: "north" }],
      }),
    ).resolves.toMatchObject({ nextOffset: 1, items: [{ id: 1 }] });
    expect(requests[0]?.url.searchParams.get("filter")).toBe(
      '{"_and":[{"title":{"_contains":"north"}}]}',
    );
    expect(requests[0]?.url.searchParams.get("sort")).toBe("-title,id");
  });

  it("checks readable parent relations before serving file metadata", async () => {
    const { requests, north } = setup();
    const context = {
      credential: north.parseCredential("fake-token-north").credential,
    };
    const input = { collection: "demo_records", field: "attachment" };
    await expect(
      north.execute(context, "files.get", { ...input, id: 2 }),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/data/items/demo_records/2",
    ]);
    const result = await north.execute(context, "files.get", {
      ...input,
      id: 1,
    });
    expect(result).toMatchObject({
      address: `https://north.example.com/data/assets/${fileId}`,
      file: { id: fileId, filename_download: "sample.pdf" },
    });
    expect(result).not.toHaveProperty("file.filename_disk");
  });

  it("counts a filtered set in one query without reading pages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ count: { id: "7370" } }] }),
      );
    const provider = new DirectusProvider(first, config, fetcher);
    const context = {
      credential: provider.parseCredential("fake-token-north").credential,
    };
    const filters = [{ field: "title", op: "contains", value: "demo" }];
    await expect(
      provider.execute(context, "items.count", {
        collection: "demo_records",
        filters,
      }),
    ).resolves.toEqual({
      source: "north",
      collection: "demo_records",
      count: 7370,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    const request = new URL(String(url));
    expect(request.pathname).toBe("/data/items/demo_records");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      "aggregate[count]": "id",
      filter: '{"_and":[{"title":{"_contains":"demo"}}]}',
    });
    expect(options?.method).toBe("GET");
  });

  it("distinguishes an empty count from a malformed aggregate", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ count: { id: 0 } }] }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ count: { id: null } }] }),
      );
    const provider = new DirectusProvider(first, config, fetcher);
    const context = {
      credential: provider.parseCredential("fake-token-north").credential,
    };
    const input = { collection: "demo_records" };
    await expect(
      provider.execute(context, "items.count", input),
    ).resolves.toMatchObject({ count: 0 });
    await expect(
      provider.execute(context, "items.count", input),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
  });

  it("pages through a large project while bounding the data returned to the model", async () => {
    const rows = Array.from({ length: 378 }, (_, index) => ({
      id: index + 1,
      title: "Synthetic record text. ".repeat(48),
      attachment: null,
    }));
    let requests = 0;
    const provider = new DirectusProvider(first, config, async (input) => {
      requests += 1;
      const query = new URL(String(input)).searchParams;
      const offset = Number(query.get("offset"));
      const limit = Number(query.get("limit"));
      expect(limit).toBe(25);
      return Response.json({ data: rows.slice(offset, offset + limit) });
    });
    const context = {
      credential: provider.parseCredential("fake-token-north").credential,
    };
    let offset: number | null = 0;
    const ids: number[] = [];
    while (offset !== null && requests < 17) {
      const page = (await provider.execute(context, "items.list", {
        collection: "demo_records",
        offset,
      })) as { items: typeof rows; nextOffset: number | null };
      expect(JSON.stringify(page).length).toBeLessThan(10_000);
      expect(page.items[0]?.title).toMatch(/…$/u);
      ids.push(...page.items.map((item) => item.id));
      offset = page.nextOffset;
    }
    expect(offset).toBeNull();
    expect(requests).toBe(16);
    expect(ids).toEqual(rows.map((item) => item.id));
  });
});
