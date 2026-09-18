/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { describe, expect, test } from "vitest";
import {
  extractIssueKey,
  fetchIssueMarkdown,
  issueApiUrl,
  wikiMarkupToMarkdown,
  adfToMarkdown,
} from "../src/adapters/jira.js";
import { adapterSettings } from "./adapters.helpers.js";

describe("jira URL and REST URL construction", () => {
  test("extracts issue keys from browse and issues paths at any depth", () => {
    expect(extractIssueKey("/browse/PROJ-123")).toBe("PROJ-123");
    expect(extractIssueKey("/jira/browse/abc-9")).toBe("ABC-9");
    expect(extractIssueKey("/issues/EX-42/")).toBe("EX-42");
    expect(extractIssueKey("/display/DEV/Home")).toBeUndefined();
    expect(extractIssueKey("/browse/notakey")).toBeUndefined();
  });

  test("builds REST v2 URLs for server flavor with the field list", () => {
    const url = issueApiUrl("https://jira.corp", "PROJ-123", adapterSettings());
    expect(url.pathname).toBe("/rest/api/2/issue/PROJ-123");
    const fields = url.searchParams.get("fields")?.split(",") ?? [];
    // The description is the body of the issue: a card without it renders a
    // task as a title and a status. Attachments ride the same card, so a file
    // the description names is reachable at all.
    expect(fields).toEqual([
      "summary",
      "description",
      "status",
      "assignee",
      "reporter",
      "priority",
      "labels",
      "components",
      "created",
      "updated",
      "attachment",
    ]);
  });

  test("adds comment and link fields when enabled", () => {
    const url = issueApiUrl(
      "https://jira.corp",
      "PROJ-123",
      adapterSettings({ includeComments: true, includeLinks: true }),
    );
    expect(url.searchParams.get("fields")).toContain("comment");
    expect(url.searchParams.get("fields")).toContain("issuelinks");
  });

  test("cloud flavor uses REST v3", () => {
    const url = issueApiUrl(
      "https://corp.atlassian.net",
      "EX-1",
      adapterSettings({ jiraFlavor: "cloud" }),
    );
    expect(url.pathname).toBe("/rest/api/3/issue/EX-1");
  });
});

describe("jira wiki markup → markdown", () => {
  test("headings, lists, emphasis, code, quotes, and links convert", () => {
    const source = [
      "h2. Plan",
      "* first",
      "*# nested",
      "*bold* and _italic_ and {{mono}}",
      "[label|https://x]",
      "bq. quoted line",
      "{code:java}",
      "int x = 1;",
      "{code}",
    ].join("\n");
    const md = wikiMarkupToMarkdown(source);
    expect(md).toContain("### Plan");
    expect(md).toContain("- first");
    expect(md).toContain("1. nested");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("`mono`");
    expect(md).toContain("[label](https://x)");
    expect(md).toContain("> quoted line");
    expect(md).toContain("```java");
    expect(md).toContain("int x = 1;");
  });

  test("wiki tables convert to pipe tables with separators", () => {
    const md = wikiMarkupToMarkdown("||Name||Value||\n|a|b|");
    expect(md.split("\n")).toEqual([
      "| Name | Value |",
      "| --- | --- |",
      "| a | b |",
    ]);
  });
});

describe("jira ADF → markdown (Cloud bodies)", () => {
  test("paragraphs, headings, lists, and code blocks convert", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "bold", marks: [{ type: "strong" }] },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Head" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "item" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1" }],
        },
      ],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain("plain **bold**");
    expect(md).toContain("## Head");
    expect(md).toContain("- item");
    expect(md).toContain("```ts\nconst a = 1\n```");
  });

  test("links come from marks", () => {
    const md = adfToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://x" } }],
            },
          ],
        },
      ],
    });
    expect(md).toContain("[docs](https://x)");
  });
});

describe("jira issue normalization", () => {
  const issuePayload = {
    key: "PROJ-123",
    fields: {
      summary: "Fix the thing",
      status: { name: "In Progress" },
      assignee: { displayName: "Ada" },
      reporter: { displayName: "Grace" },
      priority: { name: "High" },
      labels: ["infra"],
      components: [{ name: "core" }],
      created: "2026-01-02T10:00:00.000+0000",
      updated: "2026-02-03T11:00:00.000+0000",
      description: "h3. Steps\n* do it",
    },
  };

  test("renders the field block and converted description", async () => {
    const { statusCode, markdown } = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings(),
      async () => ({ statusCode: 200, data: issuePayload }),
    );
    expect(statusCode).toBe(200);
    expect(markdown).toContain("# PROJ-123: Fix the thing");
    expect(markdown).toContain("- Status: In Progress");
    expect(markdown).toContain("- Assignee: Ada");
    expect(markdown).toContain("- Updated: 2026-02-03");
    expect(markdown).toContain("## Description");
    expect(markdown).toContain("### Steps");
    expect(markdown).toContain("- do it");
    expect(markdown).not.toContain("Comments");
  });

  test("comments and links render only when enabled", async () => {
    const payload = {
      ...issuePayload,
      fields: {
        ...issuePayload.fields,
        comment: {
          comments: [
            {
              author: { displayName: "Bob" },
              created: "2026-02-04T00:00:00.000+0000",
              body: "looks good",
            },
          ],
        },
        issuelinks: [
          {
            type: {
              name: "Blocks",
              outward: "blocks",
              inward: "is blocked by",
            },
            outwardIssue: { key: "PROJ-9" },
          },
        ],
      },
    };
    const enabled = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings({ includeComments: true, includeLinks: true }),
      async () => ({ statusCode: 200, data: payload }),
    );
    expect(enabled.markdown).toContain("## Comments");
    expect(enabled.markdown).toContain("### Bob — 2026-02-04");
    expect(enabled.markdown).toContain("blocks [PROJ-9]");
    const disabled = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings(),
      async () => ({ statusCode: 200, data: payload }),
    );
    expect(disabled.markdown).not.toContain("## Comments");
    expect(disabled.markdown).not.toContain("PROJ-9");
  });

  test("attachments render as name, size, type and download URL", async () => {
    const payload = {
      ...issuePayload,
      fields: {
        ...issuePayload.fields,
        attachment: [
          {
            filename: "screen.png",
            mimeType: "image/png",
            size: 249_856,
            content: "https://jira.corp/secure/attachment/42/screen.png",
          },
          {
            filename: "log.txt",
            mimeType: "text/plain",
            size: 512,
            content: "https://jira.corp/secure/attachment/43/log.txt",
          },
        ],
      },
    };
    const { markdown } = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings(),
      async () => ({ statusCode: 200, data: payload }),
    );
    expect(markdown).toContain("## Attachments");
    expect(markdown).toContain(
      "- [screen.png](https://jira.corp/secure/attachment/42/screen.png) — 244.0 KiB, image/png",
    );
    expect(markdown).toContain(
      "- [log.txt](https://jira.corp/secure/attachment/43/log.txt) — 512 B, text/plain",
    );
  });

  test("an issue without attachments renders no attachment section", async () => {
    const { markdown } = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings(),
      async () => ({ statusCode: 200, data: issuePayload }),
    );
    expect(markdown).not.toContain("## Attachments");
  });

  test("non-2xx REST responses stay results with a short note", async () => {
    const { statusCode, markdown } = await fetchIssueMarkdown(
      new URL("https://jira.corp/browse/PROJ-123"),
      adapterSettings(),
      async () => ({ statusCode: 404, data: {} }),
    );
    expect(statusCode).toBe(404);
    expect(markdown).toContain("HTTP 404");
  });
});
