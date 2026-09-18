import { call, SPACE, stub } from "./shared.js";

describe("confluence comments", () => {
  const COMMENT = {
    id: "5001",
    status: "current",
    title: "Re: Deployment Guide",
    pageId: "123456",
    version: {
      number: 2,
      createdAt: "2026-09-11T08:00:00.000Z",
      authorId: "acc-bob",
      minorEdit: false,
    },
    body: {
      atlas_doc_format: {
        representation: "atlas_doc_format",
        value: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Looks good" }],
            },
          ],
        }),
      },
    },
    _links: { webui: "/spaces/ENG/pages/123456?focusedCommentId=5001" },
  };

  it("reads the footer discussion by default and the inline one on request", async () => {
    const { calls, fetcher } = stub(() => ({
      json: { results: [COMMENT], _links: { next: "/x?cursor=abc%3D" } },
    }));
    const footer = (await call(
      "pages.comments",
      { pageId: "123456" },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/wiki/api/v2/pages/123456/footer-comments",
    );
    expect((calls[0]?.url as URL).searchParams.get("body-format")).toBe(
      "atlas_doc_format",
    );
    expect((calls[0]?.url as URL).searchParams.get("sort")).toBe(
      "created-date",
    );
    expect(footer["nextCursor"]).toBe("abc=");
    expect(footer["items"]).toEqual([
      {
        id: "5001",
        kind: "footer",
        version: {
          number: 2,
          createdAt: "2026-09-11T08:00:00.000Z",
          authorId: "acc-bob",
          minorEdit: false,
        },
        url: "https://company.atlassian.net/wiki/spaces/ENG/pages/123456?focusedCommentId=5001",
        untrustedContent: {
          format: "markdown-like",
          text: "Looks good",
          totalChars: 10,
          truncated: false,
        },
      },
    ]);

    await call(
      "pages.comments",
      { pageId: "123456", kind: "inline", cursor: "abc=" },
      { fetcher },
    );
    expect(calls[1]?.url.pathname).toBe(
      "/wiki/api/v2/pages/123456/inline-comments",
    );
    expect((calls[1]?.url as URL).searchParams.get("cursor")).toBe("abc=");
  });

  it("reads both collections for kind=all and keeps a cursor per kind", async () => {
    const { calls, fetcher } = stub((url) => ({
      json: url.pathname.includes("inline")
        ? {
            results: [{ ...COMMENT, id: "6001" }],
            _links: { next: "/x?cursor=i2" },
          }
        : { results: [COMMENT], _links: { next: "/x?cursor=f2" } },
    }));
    const answer = (await call(
      "pages.comments",
      { pageId: "123456", kind: "all" },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls.map((item) => item.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456/footer-comments",
      "/wiki/api/v2/pages/123456/inline-comments",
    ]);
    expect(
      (answer["items"] as Record<string, unknown>[]).map(
        (item) => item["kind"],
      ),
    ).toEqual(["footer", "inline"]);
    expect(answer["cursors"]).toEqual({ footer: "f2", inline: "i2" });
    expect(answer["nextCursor"]).toBeUndefined();
  });

  it("loads replies per parent comment and stops at the deployment cap", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname.endsWith("/children")
        ? {
            json: {
              results: [
                {
                  ...COMMENT,
                  id: "5002",
                  parentCommentId: "5001",
                  body: {
                    atlas_doc_format: {
                      representation: "atlas_doc_format",
                      value: JSON.stringify({
                        type: "doc",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "thanks" }],
                          },
                        ],
                      }),
                    },
                  },
                },
              ],
            },
          }
        : { json: { results: [COMMENT, { ...COMMENT, id: "5003" }] } },
    );
    const answer = (await call(
      "pages.comments",
      { pageId: "123456", includeReplies: true },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls.map((item) => item.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456/footer-comments",
      "/wiki/api/v2/footer-comments/5001/children",
      "/wiki/api/v2/footer-comments/5003/children",
    ]);
    const items = answer["items"] as Record<string, unknown>[];
    expect(
      (items[0]?.["replies"] as Record<string, unknown>[])[0],
    ).toMatchObject({
      id: "5002",
      parentCommentId: "5001",
    });

    calls.length = 0;
    const capped = (await call(
      "pages.comments",
      { pageId: "123456", includeReplies: true },
      { fetcher, confluence: { maxReplyParents: 1 } },
    )) as Record<string, unknown>;
    expect(calls).toHaveLength(2);
    expect(capped["repliesTruncated"]).toBe(true);
  });

  it("applies the space policy to a comment read before asking for it", async () => {
    const { calls, fetcher } = stub((url) => {
      if (url.pathname === "/wiki/api/v2/pages/123456") {
        return { json: { id: "123456", spaceId: "98305" } };
      }
      if (url.pathname === "/wiki/api/v2/spaces/98305") return { json: SPACE };
      return { json: { results: [COMMENT] } };
    });
    const answer = (await call(
      "pages.comments",
      { pageId: "123456" },
      { fetcher, confluence: { allowedSpaces: ["ENG"] } },
    )) as Record<string, unknown>;
    expect(calls.map((item) => item.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
      "/wiki/api/v2/pages/123456/footer-comments",
    ]);
    expect(answer["items"]).toHaveLength(1);

    calls.length = 0;
    const denied = stub((url) =>
      url.pathname.includes("/spaces/")
        ? { json: { ...SPACE, key: "HR" } }
        : { json: { id: "123456", spaceId: "98305" } },
    );
    await expect(
      call(
        "pages.comments",
        { pageId: "123456" },
        { fetcher: denied.fetcher, confluence: { allowedSpaces: ["ENG"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    // The comments endpoint is never reached for a page the policy forbids.
    expect(denied.calls).toHaveLength(2);
  });

  it("spends no extra read when the deployment has no space policy", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [COMMENT] } }));
    await call(
      "pages.comments",
      { pageId: "123456" },
      { fetcher, confluence: { allowedSpaces: [] } },
    );
    expect(calls).toHaveLength(1);
  });
});
