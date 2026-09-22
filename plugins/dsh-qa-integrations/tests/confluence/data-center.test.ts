import { IntegrationError } from "../../src/errors.js";
import { ConfluenceProvider } from "../../src/providers/confluence/index.js";
import {
  DC,
  PAT,
  callServer,
  config,
  dcCredentialFor,
  stub,
} from "./shared.js";

const CONTEXT = "https://wiki.example.corp/confluence";

/** One page as `/rest/api/content/:id` answers it, storage body and all. */
const PAGE = {
  id: "123456",
  type: "page",
  status: "current",
  title: "Демо-страница",
  space: { id: 98305, key: "DEMO", name: "Демо-пространство" },
  version: {
    by: {
      type: "known",
      username: "alice",
      userKey: "402880e5",
      displayName: "Alice Example",
    },
    when: "2026-01-02T10:00:00.000+03:00",
    number: 3,
    message: "правка",
    minorEdit: false,
  },
  body: {
    storage: {
      value:
        "<h1>Заголовок</h1><p>Текст <strong>жирный</strong> и <em>курсив</em></p>",
      representation: "storage",
    },
  },
  ancestors: [{ id: "100", type: "page", title: "Родитель" }],
  metadata: { labels: { results: [{ name: "demo" }] } },
  _links: {
    webui: "/spaces/DEMO/pages/123456/Демо-страница",
    base: CONTEXT,
    download: "/download/attachments/123456/x.png",
  },
};

/** A CQL search answer, paged by offset with a `_links.next` of its own. */
function searchPage(start: number, size: number, next: boolean) {
  return {
    results: Array.from({ length: size }, (_, index) => ({
      id: String(123456 + start + index),
      type: "page",
      status: "current",
      title: `Демо-${start + index}`,
      space: { id: 98305, key: "DEMO", name: "Демо-пространство" },
      version: { when: "2026-01-02T10:00:00.000+03:00", number: 1 },
      excerpt: "фрагмент с <span>подсветкой</span>",
      _links: {
        webui: `/spaces/DEMO/pages/${123456 + start + index}`,
        base: CONTEXT,
      },
    })),
    start,
    limit: 25,
    size,
    _links: next
      ? {
          next: `/rest/api/content/search?cql=x&start=${start + size}&limit=25`,
        }
      : {},
  };
}

describe("Confluence Server / Data Center connection", () => {
  it("authenticates a personal access token as a bearer, with no e-mail", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        type: "known",
        username: "alice",
        userKey: "402880e5",
        displayName: "Alice Example",
      },
    }));
    const provider = new ConfluenceProvider(
      config({ instances: [DC] }),
      fetcher,
    );
    const credential = dcCredentialFor(DC.id, fetcher);
    const validation = await provider.validate({ credential });
    // A v1 identity names the user by key and login; there is no account id.
    expect(validation.externalUserId).toBe("402880e5");
    expect(validation.displayName).toBe("Alice Example");
    expect(validation.tenantId).toBe(CONTEXT);
    expect(calls[0]?.url.pathname).toBe("/confluence/rest/api/user/current");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${PAT}`,
    );
  });

  it("accepts a personal access token the Cloud token shape would refuse", () => {
    const provider = new ConfluenceProvider(
      config({ instances: [DC] }),
      stub(() => ({})).fetcher,
    );
    const credential = provider.parseCredential(PAT, { instanceId: DC.id });
    expect(credential.portal).toBe(CONTEXT);
    expect(JSON.parse(credential.credential)).toEqual({
      instanceId: DC.id,
      email: "",
      token: PAT,
    });
  });

  it("refuses a Cloud site whose connection carries no account e-mail", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new ConfluenceProvider(
      config({
        instances: [
          {
            id: "cloud",
            label: "",
            baseUrl: "https://wiki.example.corp/confluence",
          },
        ],
      }),
      fetcher,
    );
    // The operator repointed the instance from server to cloud after the
    // connection was made: the stored bearer credential is refused instead of
    // being sent as an empty-account Basic pair.
    const stored = JSON.stringify({
      instanceId: "cloud",
      email: "",
      token: PAT,
    });
    await expect(
      provider.validate({ credential: stored }),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
  });
});

describe("Confluence Server / Data Center reads", () => {
  it("searches through the v1 CQL endpoint and pages by offset", async () => {
    const { fetcher, calls } = stub(() => ({ json: searchPage(0, 2, true) }));
    const answer = (await callServer(
      "search.run",
      { query: "демо" },
      {
        fetcher,
      },
    )) as Record<string, unknown>;
    const [call] = calls;
    expect(call?.url.pathname).toBe("/confluence/rest/api/content/search");
    expect(call?.url.searchParams.get("cql")).toContain('text ~ "демо"');
    expect(call?.url.searchParams.get("start")).toBe("0");
    expect(call?.url.searchParams.get("limit")).toBe("20");
    // The archived-spaces filter is a Cloud concept and never travels here.
    expect(call?.url.searchParams.get("includeArchivedSpaces")).toBeNull();
    const items = answer["items"] as Record<string, unknown>[];
    expect(items[0]?.["title"]).toBe("Демо-0");
    expect(items[0]?.["url"]).toBe(`${CONTEXT}/spaces/DEMO/pages/123456`);
    expect(
      (items[0]?.["untrustedContent"] as Record<string, unknown>)["excerpt"],
    ).toBe("фрагмент с подсветкой");
    // The next page is the offset the product named, not a count of rows.
    expect(answer["nextCursor"]).toBe("2");
  });

  it("continues a listing from the offset the product reported", async () => {
    const { fetcher, calls } = stub(() => ({ json: searchPage(2, 2, false) }));
    await callServer("search.run", { query: "демо", cursor: "2" }, { fetcher });
    expect(calls[0]?.url.searchParams.get("start")).toBe("2");
  });

  it("refuses a cursor this product could not have minted", async () => {
    const { fetcher } = stub(() => ({ json: searchPage(0, 1, false) }));
    await expect(
      callServer(
        "search.run",
        { query: "демо", cursor: "eyJvZmZzZXQiOjI1fQ==" },
        {
          fetcher,
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("reads a space by its key through the v1 listing", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        results: [
          {
            id: 98305,
            key: "DEMO",
            name: "Демо-пространство",
            type: "global",
            status: "current",
            description: {
              plain: { value: "Описание", representation: "plain" },
            },
          },
        ],
      },
    }));
    const answer = (await callServer(
      "spaces.get",
      { space: "DEMO" },
      {
        fetcher,
      },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/confluence/rest/api/space");
    expect(calls[0]?.url.searchParams.get("keys")).toBe("DEMO");
    const space = answer["space"] as Record<string, unknown>;
    expect(space["key"]).toBe("DEMO");
    expect(space["id"]).toBe("98305");
    expect(
      (answer["untrustedContent"] as Record<string, unknown>)["text"],
    ).toBe("Описание");
  });

  it("renders a storage-format body and reads the page's own space", async () => {
    const { fetcher, calls } = stub(() => ({ json: PAGE }));
    const answer = (await callServer(
      "pages.get",
      { pageId: "123456" },
      {
        fetcher,
      },
    )) as Record<string, unknown>;
    // One read: the page carries its space, so no second call is spent on it.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/confluence/rest/api/content/123456",
    ]);
    expect(calls[0]?.url.searchParams.get("expand")).toContain("body.storage");
    const page = answer["page"] as Record<string, unknown>;
    expect((page["space"] as Record<string, unknown>)["key"]).toBe("DEMO");
    // A v1 page has no creator and no creation date of its own; the version it
    // is at carries the last edit, and that is what the answer says.
    expect(page["createdAt"]).toBeUndefined();
    expect((page["version"] as Record<string, unknown>)["createdAt"]).toBe(
      "2026-01-02T10:00:00.000+03:00",
    );
    expect(
      (
        (page["version"] as Record<string, unknown>)["author"] as Record<
          string,
          unknown
        >
      )["displayName"],
    ).toBe("Alice Example");
    expect(page["parentId"]).toBe("100");
    expect(page["labels"]).toEqual(["demo"]);
    const body = answer["untrustedContent"] as Record<string, unknown>;
    expect(body["format"]).toBe("markdown-like");
    expect(String(body["text"])).toContain("# Заголовок");
    expect(String(body["text"])).toContain("**жирный**");
    expect(String(body["text"])).toContain("_курсив_");
  });

  it("keeps a page outside the operator allowlist out of the answer", async () => {
    const { fetcher } = stub(() => ({ json: PAGE }));
    await expect(
      callServer(
        "pages.get",
        { pageId: "123456" },
        { fetcher, confluence: { instances: [DC], allowedSpaces: ["OTHER"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
  });

  it("reads comments from the one collection the product keeps", async () => {
    const { fetcher, calls } = stub((url) => {
      if (url.pathname.endsWith("/123456/child/comment")) {
        return {
          json: {
            results: [
              {
                id: "900",
                type: "comment",
                body: { storage: { value: "<p>Футер</p>" } },
                version: { number: 1, when: "2026-01-03T10:00:00.000+03:00" },
                extensions: { location: "footer" },
              },
              {
                id: "901",
                type: "comment",
                ancestors: [{ id: "123456", type: "page" }],
                body: { storage: { value: "<p>Инлайн</p>" } },
                version: { number: 1, when: "2026-01-03T11:00:00.000+03:00" },
                extensions: { location: "inline" },
              },
            ],
            start: 0,
            limit: 25,
            size: 2,
          },
        };
      }
      return { json: {} };
    });
    const footer = (await callServer(
      "pages.comments",
      { pageId: "123456" },
      {
        fetcher,
      },
    )) as Record<string, unknown>;
    // One request for both kinds: the product marks each comment, and the
    // requested kind is applied to the rows it marked.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe(
      "/confluence/rest/api/content/123456/child/comment",
    );
    const items = footer["items"] as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.["id"]).toBe("900");
    expect(items[0]?.["kind"]).toBe("footer");
    expect(
      (items[0]?.["untrustedContent"] as Record<string, unknown>)["text"],
    ).toBe("Футер");

    const all = (await callServer(
      "pages.comments",
      { pageId: "123456", kind: "all" },
      { fetcher },
    )) as Record<string, unknown>;
    const every = all["items"] as Record<string, unknown>[];
    expect(every.map((item) => item["kind"])).toEqual(["footer", "inline"]);
  });

  it("reads the replies of one comment from their own collection", async () => {
    const { fetcher, calls } = stub((url) => {
      if (url.pathname.endsWith("/900/child/comment")) {
        return {
          json: {
            results: [
              {
                id: "902",
                type: "comment",
                ancestors: [
                  { id: "123456", type: "page" },
                  { id: "900", type: "comment" },
                ],
                body: { storage: { value: "<p>Ответ</p>" } },
                version: { number: 1, when: "2026-01-04T10:00:00.000+03:00" },
                extensions: { location: "footer" },
              },
            ],
            size: 1,
          },
        };
      }
      if (url.pathname.endsWith("/123456/child/comment")) {
        return {
          json: {
            results: [
              {
                id: "900",
                type: "comment",
                body: { storage: { value: "<p>Футер</p>" } },
                version: { number: 1, when: "2026-01-03T10:00:00.000+03:00" },
                extensions: { location: "footer" },
              },
            ],
            size: 1,
          },
        };
      }
      return { json: {} };
    });
    const answer = (await callServer(
      "pages.comments",
      { pageId: "123456", includeReplies: true },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/confluence/rest/api/content/123456/child/comment",
      "/confluence/rest/api/content/900/child/comment",
    ]);
    const items = answer["items"] as Record<string, unknown>[];
    const replies = items[0]?.["replies"] as Record<string, unknown>[];
    expect(replies[0]?.["id"]).toBe("902");
    // The reply's parent is the comment its ancestors name, not the page.
    expect(replies[0]?.["parentCommentId"]).toBe("900");
  });

  it("reads attachment and version metadata as the v1 API spells it", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.endsWith("/child/attachment")
        ? {
            json: {
              results: [
                {
                  id: "555",
                  type: "attachment",
                  title: "отчёт.png",
                  metadata: { mediaType: "image/png" },
                  extensions: { mediaType: "image/png", fileSize: 2048 },
                  version: {
                    number: 2,
                    when: "2026-01-05T10:00:00.000+03:00",
                    by: { username: "alice", displayName: "Alice Example" },
                  },
                  _links: {
                    webui: "/pages/viewpageattachments.action?pageId=123456",
                    download: "/download/attachments/123456/отчёт.png",
                  },
                },
              ],
              size: 1,
            },
          }
        : {
            json: {
              results: [
                {
                  number: 3,
                  when: "2026-01-02T10:00:00.000+03:00",
                  message: "правка",
                  minorEdit: false,
                  by: { username: "alice", displayName: "Alice Example" },
                  content: { id: "123456", title: "Демо-страница" },
                },
              ],
              size: 1,
            },
          },
    );
    const attachments = (await callServer(
      "pages.attachments",
      { pageId: "123456" },
      { fetcher },
    )) as Record<string, unknown>;
    const rows = attachments["items"] as Record<string, unknown>[];
    expect(rows[0]?.["mediaType"]).toBe("image/png");
    expect(rows[0]?.["fileSize"]).toBe(2048);
    expect(rows[0]?.["createdAt"]).toBe("2026-01-05T10:00:00.000+03:00");
    expect(rows[0]?.["downloadLink"]).toBe(
      `${CONTEXT}/download/attachments/123456/отчёт.png`,
    );

    const versions = (await callServer(
      "pages.versions",
      { pageId: "123456" },
      { fetcher },
    )) as Record<string, unknown>;
    const history = versions["items"] as Record<string, unknown>[];
    expect(history[0]?.["number"]).toBe(3);
    expect(history[0]?.["message"]).toBe("правка");
    expect(history[0]?.["pageId"]).toBe("123456");
    expect(calls[1]?.url.pathname).toBe(
      "/confluence/rest/api/content/123456/version",
    );
  });

  it("answers a read of the wrong product with a policy error, not a guess", async () => {
    // A Cloud instance whose pages live at the v2 API: the same call against a
    // server-configured instance must not silently try the v2 path.
    const { fetcher, calls } = stub(() => ({ status: 404, json: {} }));
    await expect(
      callServer("pages.get", { pageId: "123456" }, { fetcher }),
    ).rejects.toMatchObject({ code: "ResourceNotFound" });
    expect(calls[0]?.url.pathname.startsWith("/confluence/rest/api/")).toBe(
      true,
    );
  });
});

describe("Confluence Server / Data Center transport", () => {
  it("keeps the credential out of the URL and off a redirect", async () => {
    const { fetcher, calls } = stub(() => ({ json: PAGE }));
    await callServer("pages.get", { pageId: "123456" }, { fetcher });
    const [call] = calls;
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.method).toBe("GET");
    expect(call?.url.toString()).not.toContain(PAT);
  });

  it("maps a refused permission onto the same error model as Cloud", async () => {
    const { fetcher } = stub(() => ({ status: 403, json: {} }));
    const cause = await callServer(
      "pages.get",
      { pageId: "123456" },
      {
        fetcher,
      },
    ).catch((error: unknown) => error);
    expect((cause as IntegrationError).code).toBe("ProviderPermissionDenied");
  });
});
