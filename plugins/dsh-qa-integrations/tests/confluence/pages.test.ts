import { adfToText, textBudget } from "../../src/providers/confluence/adf.js";
import { ADF, bodyOf, call, PAGE, siteStub, SPACE } from "./shared.js";

describe("confluence page reads", () => {
  it("renders the body and resolves the page's space", async () => {
    const { calls, fetcher } = siteStub();
    const answer = (await call(
      "pages.get",
      { pageId: 123456 },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls.map((item) => item.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
    ]);
    const pageUrl = calls[0]?.url as URL;
    expect(pageUrl.searchParams.get("body-format")).toBe("atlas_doc_format");
    expect(pageUrl.searchParams.get("include-labels")).toBe("true");

    expect(answer["source"]).toEqual({
      provider: "confluence",
      site: "https://company.atlassian.net",
      pageId: "123456",
      url: "https://company.atlassian.net/wiki/spaces/ENG/pages/123456/Deployment+Guide",
    });
    expect(answer["page"]).toEqual({
      title: "Deployment Guide",
      status: "current",
      space: { id: "98305", key: "ENG", name: "Engineering" },
      parentId: "111",
      author: { accountId: "acc-alice" },
      owner: { accountId: "acc-alice" },
      createdAt: "2026-08-01T10:00:00.000Z",
      version: {
        number: 7,
        createdAt: "2026-09-10T09:00:00.000Z",
        message: "update steps",
        authorId: "acc-alice",
        minorEdit: false,
      },
      labels: ["runbook", "release"],
    });
    expect(answer["untrustedContent"]).toMatchObject({
      format: "markdown-like",
      truncated: false,
    });
  });

  it("flattens the document format into markdown-like text", () => {
    const text = adfToText(ADF);
    expect(text).toContain("## Steps");
    expect(text).toContain(
      "Run `npm ci` then [roll back](https://example.com/rb)",
    );
    expect(text).toContain("@Bob");
    expect(text).toContain("- first");
    expect(text).toContain("  - nested");
    expect(text).toContain("- second");
    expect(text).toContain("```bash\nmake deploy\n```");
    expect(text).toContain("| env | url |");
    expect(text).toContain("| --- | --- |");
    expect(text).toContain("| prod | https://a\\|b |");
    expect(text).toContain("[panel: warning]\nCareful");
    expect(text).toContain("[status: DONE]");
    expect(text).toContain("[Confluence macro: jira]");
    expect(text).toContain("[media: chart]");
    expect(text).toContain("- [x] plan");
    expect(text).toContain("- [ ] ship");
  });

  it("keeps an unknown node's words and survives a broken body", () => {
    expect(
      adfToText({
        type: "doc",
        content: [
          { type: "somethingNew", content: [{ type: "text", text: "kept" }] },
        ],
      }),
    ).toBe("kept");
    expect(adfToText("not json")).toBe("");
    expect(adfToText(undefined)).toBe("");
    expect(adfToText({ type: "doc" })).toBe("");
    // A deeply nested document is not walked to death.
    let node: Record<string, unknown> = { type: "text", text: "x" };
    for (let index = 0; index < 200; index += 1) {
      node = { type: "paragraph", content: [node] };
    }
    expect(adfToText({ type: "doc", content: [node] })).toBe("");
  });

  it("cuts a body to the requested budget and says that it cut", async () => {
    const { fetcher } = siteStub();
    const answer = (await call(
      "pages.get",
      { pageId: "123456", maxChars: 120 },
      { fetcher },
    )) as Record<string, unknown>;
    const body = bodyOf(answer);
    expect(body["truncated"]).toBe(true);
    expect(String(body["text"]).length).toBe(120);
    expect(Number(body["totalChars"])).toBeGreaterThan(120);
    // A budget above the deployment ceiling is clamped, not trusted.
    expect(textBudget("abcdef", 3)).toEqual({
      text: "abc",
      totalChars: 6,
      truncated: true,
    });
  });

  it("refuses a page outside the operator allowlist", async () => {
    const { fetcher } = siteStub(PAGE, { ...SPACE, key: "HR" });
    await expect(
      call(
        "pages.get",
        { pageId: "123456" },
        { fetcher, confluence: { allowedSpaces: ["ENG"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
  });

  it("refuses a page id that is not an id, before any request", async () => {
    const { calls, fetcher } = siteStub();
    for (const bad of ["../etc/passwd", "abc", "12 34", ""]) {
      await expect(
        call("pages.get", { pageId: bad }, { fetcher }),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });
});
