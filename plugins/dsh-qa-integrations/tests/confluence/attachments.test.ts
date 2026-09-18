import { call, stub } from "./shared.js";

describe("confluence attachments and versions", () => {
  it("hands over attachment metadata and never the bytes", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        results: [
          {
            id: "att-1",
            title: "runbook.pdf",
            mediaType: "application/pdf",
            fileSize: 2048,
            status: "current",
            pageId: "123456",
            createdAt: "2026-08-02T10:00:00.000Z",
            version: { number: 3, authorId: "acc-bob" },
            webuiLink: "/wiki/download/attachments/123456/runbook.pdf",
            downloadLink:
              "https://company.atlassian.net/wiki/download/attachments/123456/runbook.pdf",
          },
        ],
        _links: { next: "/x?cursor=next-1" },
      },
    }));
    const answer = (await call(
      "pages.attachments",
      { pageId: "123456" },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe(
      "/wiki/api/v2/pages/123456/attachments",
    );
    expect(answer["nextCursor"]).toBe("next-1");
    expect(answer["items"]).toEqual([
      {
        id: "att-1",
        title: "runbook.pdf",
        mediaType: "application/pdf",
        fileSize: 2048,
        status: "current",
        versionNumber: 3,
        createdAt: "2026-08-02T10:00:00.000Z",
        authorId: "acc-bob",
        pageId: "123456",
        webuiLink: "/wiki/download/attachments/123456/runbook.pdf",
        downloadLink:
          "https://company.atlassian.net/wiki/download/attachments/123456/runbook.pdf",
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain("binary");
  });

  it("reads version metadata only", async () => {
    const { fetcher } = stub(() => ({
      json: {
        results: [
          {
            number: 7,
            message: "update steps",
            createdAt: "2026-09-10T09:00:00.000Z",
            authorId: "acc-alice",
            minorEdit: false,
            page: { id: "123456", title: "Deployment Guide" },
          },
        ],
      },
    }));
    const answer = (await call(
      "pages.versions",
      { pageId: "123456" },
      { fetcher },
    )) as Record<string, unknown>;
    expect(answer["items"]).toEqual([
      {
        number: 7,
        message: "update steps",
        createdAt: "2026-09-10T09:00:00.000Z",
        authorId: "acc-alice",
        minorEdit: false,
        pageId: "123456",
        title: "Deployment Guide",
      },
    ]);
  });
});
