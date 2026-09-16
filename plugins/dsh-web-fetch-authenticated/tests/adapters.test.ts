/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { afterEach, describe, expect, test } from "vitest";
import { applyAdapter } from "../src/adapters/index.js";
import {
  extractIssueKey,
  fetchIssueMarkdown,
  issueApiUrl,
  wikiMarkupToMarkdown,
  adfToMarkdown,
} from "../src/adapters/jira.js";
import {
  contentApiUrl,
  contentLookupUrl,
  extractPageRef,
  fetchPageMarkdown,
  restPrefix,
  storageToMarkdown,
} from "../src/adapters/confluence.js";
import { resolveConfig } from "../src/config.js";
import { validateRule } from "../src/rule-validation.js";
import {
  fakeCredentials,
  configWith,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";
import { AuthenticatedFetchProvider } from "../src/provider.js";
import { WebError } from "@deepseek-ai/dsh-web";
import type { AdapterRequestContext } from "../src/adapters/index.js";
import type {
  ResolvedAdapter,
  ResolvedRule,
  AuthenticatedFetchRule,
} from "../src/types.js";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

/** A logger the audits can write into without any output. */
function silentLogger(): PluginLogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: "error",
    setLevel: () => {},
  } as unknown as PluginLogger;
}

function adapterSettings(
  overrides: Partial<ResolvedAdapter> = {},
): ResolvedAdapter {
  return {
    type: "jira",
    jiraFlavor: "server",
    includeComments: false,
    includeLinks: false,
    cleanup: "balanced",
    maxAttachments: 50,
    ...overrides,
  };
}

function context(
  adapter: ResolvedAdapter,
  overrides: Partial<AdapterRequestContext> = {},
): AdapterRequestContext {
  const rule = { adapter, source: { id: "r" } } as unknown as ResolvedRule;
  return {
    rule,
    rules: [rule],
    globals: { maxUrlLength: 2048, userAgent: "test" },
    resolveSecrets: async () => ({}),
    ...overrides,
  };
}

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
    expect(url.toString()).toBe(
      "https://jira.corp/rest/api/2/issue/PROJ-123?fields=summary%2Cstatus%2Cassignee%2Creporter%2Cpriority%2Clabels%2Ccomponents%2Ccreated%2Cupdated",
    );
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

describe("confluence recognition and REST URLs", () => {
  test("page-id paths and display paths are recognized", () => {
    expect(extractPageRef("/pages/123456")).toEqual({ id: "123456" });
    expect(extractPageRef("/wiki/spaces/DEV/pages/123456/Title")).toEqual({
      id: "123456",
    });
    expect(extractPageRef("/display/DEV/Some+Title")).toEqual({
      spaceKey: "DEV",
      title: "Some Title",
    });
    expect(extractPageRef("/login")).toBeUndefined();
  });

  test("view-page links (the address Confluence hands out) are recognized", () => {
    // The URL in the browser bar and in every "copy link" action.
    expect(
      extractPageRef(
        "/wiki/pages/viewpage.action",
        new URLSearchParams("pageId=112996462"),
      ),
    ).toEqual({ id: "112996462" });
    // Its legacy title form, which Confluence still emits in old links.
    expect(
      extractPageRef(
        "/pages/viewpage.action",
        new URLSearchParams(
          "spaceKey=SD&title=%D0%A0%D0%B5%D0%B3%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82+%D0%BF%D0%BE+Git",
        ),
      ),
    ).toEqual({ spaceKey: "SD", title: "Регламент по Git" });
    // Nothing usable in the query, and a non-view-page path carrying a stray
    // pageId, both stay unrecognized: they fall through to raw HTTP/HTML.
    expect(
      extractPageRef("/wiki/pages/viewpage.action", new URLSearchParams("")),
    ).toBeUndefined();
    expect(
      extractPageRef("/browse/abc", new URLSearchParams("pageId=7")),
    ).toBeUndefined();
  });

  test("REST prefix follows the /wiki (Cloud) convention", () => {
    expect(restPrefix("/wiki/spaces/DEV/pages/1/T")).toBe("/wiki/rest/api");
    expect(restPrefix("/display/DEV/T")).toBe("/rest/api");
  });

  test("direct content and lookup URLs carry the expansions", () => {
    expect(contentApiUrl("https://w.corp", "/rest/api", "7").pathname).toBe(
      "/rest/api/content/7",
    );
    expect(
      contentApiUrl("https://w.corp", "/rest/api", "7").searchParams.get(
        "expand",
      ),
    ).toBe("body.storage,space,version");
    const lookup = contentLookupUrl("https://w.corp", "/rest/api", "DEV", "T");
    expect(lookup.searchParams.get("spaceKey")).toBe("DEV");
    expect(lookup.searchParams.get("title")).toBe("T");
  });
});

describe("confluence storage → markdown", () => {
  test("paragraphs, headings, lists, tables, and entities convert", () => {
    const storage = [
      "<h1>Top</h1>",
      "<p>Alpha &amp; beta</p>",
      "<h2>Section</h2>",
      "<ul><li>one</li><li>two<ol><li>inner</li></ol></li></ul>",
      "<table><tbody><tr><th>H</th></tr><tr><td>v|1</td></tr></tbody></table>",
      "<blockquote><p>quoted</p></blockquote>",
      '<p><strong>b</strong> and <a href="https://x">link</a></p>',
    ].join("\n");
    const md = storageToMarkdown(storage);
    expect(md).toContain("# Top");
    expect(md).toContain("Alpha & beta");
    expect(md).toContain("## Section");
    expect(md).toContain("- one");
    expect(md).toContain("1. inner");
    expect(md).toContain("| H |");
    expect(md).toContain("v\\|1");
    expect(md).toContain("> quoted");
    expect(md).toContain("**b**");
    expect(md).toContain("[link](https://x)");
  });

  test("code macros render fenced with their language; status badges keep their label", () => {
    const storage = [
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[let a = 1;]]></ac:plain-text-body></ac:structured-macro>',
      '<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">Green</ac:parameter></ac:structured-macro>',
    ].join("\n");
    const md = storageToMarkdown(storage);
    expect(md).toContain("```js\nlet a = 1;\n```");
    expect(md).toContain("**Green**");
  });

  test("layout macros unwrap instead of swallowing the content they wrap", () => {
    const storage = [
      '<ac:structured-macro ac:name="section"><ac:rich-text-body>',
      "<h2>Deploy</h2><p>Steps follow.</p><ul><li>one</li><li>two</li></ul>",
      "</ac:rich-text-body></ac:structured-macro>",
    ].join("");
    const md = storageToMarkdown(storage);
    expect(md).toContain("## Deploy");
    expect(md).toContain("Steps follow.");
    // The paragraph structure inside the macro survives instead of collapsing
    // into a single placeholder line.
    expect(md).toContain("- one\n- two");
    expect(md).not.toContain("[macro: section");
  });

  test("callouts, task lists, and unknown macro bodies convert", () => {
    const storage = [
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Restart first.</p></ac:rich-text-body></ac:structured-macro>',
      "<ac:task-list>",
      "<ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Stop traffic</ac:task-body></ac:task>",
      "<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Drain queues</ac:task-body></ac:task>",
      "</ac:task-list>",
      '<ac:structured-macro ac:name="mystery"><ac:parameter ac:name="foo">bar</ac:parameter><ac:rich-text-body><p>Payload text</p></ac:rich-text-body></ac:structured-macro>',
    ].join("\n");
    const md = storageToMarkdown(storage);
    expect(md).toContain("> Restart first.");
    expect(md).toContain("- [x] Stop traffic");
    expect(md).toContain("- [ ] Drain queues");
    expect(md).toContain("Payload text");
  });

  test("ac:link renders the link body or the referenced page title", () => {
    const withBody = storageToMarkdown(
      "<ac:link><ac:link-body>Target</ac:link-body></ac:link>",
    );
    expect(withBody).toContain("Target");
    const withRef = storageToMarkdown(
      '<ac:link><ri:page ri:content-title="Other Page"/></ac:link>',
    );
    expect(withRef).toContain("Other Page");
  });

  test("a user mention keeps a placeholder instead of vanishing", () => {
    const md = storageToMarkdown(
      '<p>Reviewed by <ac:link><ri:user ri:account-id="5b10a"/></ac:link></p>',
    );
    expect(md).toContain("Reviewed by @user");
  });

  test("list items and table rows stay adjacent within their block", () => {
    const md = storageToMarkdown(
      [
        "<ul><li>one</li><li>two</li></ul>",
        "<table><tbody><tr><th>H</th></tr><tr><td>v</td></tr></tbody></table>",
      ].join("\n"),
    );
    // A blank line between items would make the list loose and split the table.
    expect(md).toContain("- one\n- two");
    expect(md).toContain("| H |\n| --- |\n| v |");
  });

  test("cleanup levels trim page chrome without touching the content", () => {
    const storage = [
      "<h1>Runbook</h1>",
      '<p>State: <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">Approved</ac:parameter></ac:structured-macro></p>',
      '<ac:structured-macro ac:name="toc"/>',
      '<ac:structured-macro ac:name="children"><ac:parameter ac:name="depth">2</ac:parameter></ac:structured-macro>',
      '<ac:structured-macro ac:name="include"><ri:page ri:content-title="Common Steps"/></ac:structured-macro>',
      '<p><ac:image><ri:attachment ri:filename="schema.png"/></ac:image></p>',
      '<p>Mood <ac:emoticon ac:name="smile"/> at the end</p>',
      '<ac:structured-macro ac:name="mystery"><ac:parameter ac:name="foo">bar</ac:parameter></ac:structured-macro>',
    ].join("\n");
    const off = storageToMarkdown(storage, "off");
    const balanced = storageToMarkdown(storage, "balanced");
    const strict = storageToMarkdown(storage, "strict");

    // Every level keeps the readable content.
    for (const md of [off, balanced, strict]) {
      expect(md).toContain("# Runbook");
      expect(md).toContain("**Approved**");
      expect(md).toContain("at the end");
    }

    // `off`: nothing is trimmed, parameters included.
    expect(off).toContain("_[macro: toc]_");
    expect(off).toContain("_[macro: children — 2]_");
    expect(off).toContain("_[includes: Common Steps]_");
    expect(off).toContain("_[schema.png]_");
    expect(off).toContain("smile");
    expect(off).toContain("_[macro: mystery — bar]_");

    // `balanced`: navigation and parameters go, links, media and emoticons stay.
    expect(balanced).not.toContain("[macro: toc");
    expect(balanced).not.toContain("[macro: children");
    expect(balanced).toContain("_[includes: Common Steps]_");
    expect(balanced).toContain("_[schema.png]_");
    expect(balanced).toContain("smile");
    expect(balanced).toContain("_[macro: mystery]_");
    expect(balanced).not.toContain("bar");

    // `strict`: only the content is left, with no marker of any kind.
    expect(strict).not.toContain("_[");
    expect(strict).not.toContain("schema.png");
    expect(strict).not.toContain("smile");
    expect(strict).not.toContain("Common Steps");
    expect(strict).not.toContain("mystery");
  });

  test("the default level is balanced", () => {
    expect(storageToMarkdown('<ac:structured-macro ac:name="toc"/>')).toBe("");
  });
});

describe("confluence page normalization", () => {
  const pagePayload = {
    id: "7",
    title: "Runbook",
    space: { name: "Operations" },
    version: { when: "2026-03-04T00:00:00.000Z" },
    body: { storage: { value: "<p>Hello world</p>" } },
  };

  test("direct fetch renders metadata plus converted storage body", async () => {
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence" }),
      async (url) => {
        expect(url.pathname).toBe("/rest/api/content/7");
        return { statusCode: 200, data: pagePayload };
      },
    );
    expect(markdown).toContain("# Runbook");
    expect(markdown).toContain("- Space: Operations");
    expect(markdown).toContain("Hello world");
  });

  test("display URLs resolve through the title lookup envelope", async () => {
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/display/OPS/Runbook"),
      adapterSettings({ type: "confluence" }),
      async (url) => {
        if (url.pathname.endsWith("/child/attachment"))
          return { statusCode: 200, data: { results: [] } };
        expect(url.pathname).toBe("/rest/api/content");
        expect(url.searchParams.get("spaceKey")).toBe("OPS");
        return { statusCode: 200, data: { results: [pagePayload] } };
      },
    );
    expect(markdown).toContain("# Runbook");
  });

  test("a view-page link fetches the REST content, keeping the context path", async () => {
    const { markdown } = await fetchPageMarkdown(
      new URL(
        "https://jira.corp/wiki/pages/viewpage.action?pageId=112996462&src=quick-create",
      ),
      adapterSettings({ type: "confluence" }),
      async (url) => {
        if (url.pathname.endsWith("/child/attachment"))
          return { statusCode: 200, data: { results: [] } };
        expect(url.pathname).toBe("/wiki/rest/api/content/112996462");
        return { statusCode: 200, data: pagePayload };
      },
    );
    expect(markdown).toContain("# Runbook");
    expect(markdown).toContain("Hello world");
  });

  test("non-2xx REST responses stay results with a short note", async () => {
    const { statusCode, markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence" }),
      async () => ({ statusCode: 403, data: {} }),
    );
    expect(statusCode).toBe(403);
    expect(markdown).toContain("HTTP 403");
  });
});

describe("confluence attachments", () => {
  const DOCX = "Регламент v3.docx";
  const linkTo = (filename: string): string =>
    `https://w.corp/download/attachments/7/${encodeURIComponent(filename)}?api=v2`;

  test("attachment references in the body become download links", () => {
    const storage = [
      `<p>Смотри <ac:link><ri:attachment ri:filename="${DOCX}"/><ac:link-body>${DOCX}</ac:link-body></ac:link> и схему</p>`,
      '<p><ac:image><ri:attachment ri:filename="схема.png"/></ac:image></p>',
      '<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name"><ri:attachment ri:filename="Приложение.docx"/></ac:parameter></ac:structured-macro>',
      '<ac:structured-macro ac:name="viewpdf"><ac:parameter ac:name="name"><ri:attachment ri:filename="Отчёт.pdf"/></ac:parameter></ac:structured-macro>',
      '<p><ac:image><ri:url ri:value="https://cdn.corp/remote.png"/></ac:image></p>',
    ].join("\n");
    const md = storageToMarkdown(storage, "balanced", linkTo);
    expect(md).toContain(`[${DOCX}](${linkTo(DOCX)})`);
    expect(md).toContain(`[схема.png](${linkTo("схема.png")})`);
    expect(md).toContain(`[Приложение.docx](${linkTo("Приложение.docx")})`);
    expect(md).toContain(`[Отчёт.pdf](${linkTo("Отчёт.pdf")})`);
    expect(md).toContain("![](https://cdn.corp/remote.png)");
    expect(md).not.toContain("_[");
  });

  test("a filename the linker cannot resolve keeps the plain marker", () => {
    const storage =
      '<p><ac:image><ri:attachment ri:filename="schema.png"/></ac:image></p>';
    expect(storageToMarkdown(storage, "balanced", () => undefined)).toContain(
      "_[schema.png]_",
    );
  });

  test("strict cleanup serves no attachments at all", () => {
    const storage = `<p><ac:link><ri:attachment ri:filename="${DOCX}"/></ac:link></p>`;
    const md = storageToMarkdown(storage, "strict", linkTo);
    expect(md).not.toContain(DOCX);
    expect(md).not.toContain("download/attachments");
  });

  test("the page lists its attachments with sizes and download URLs", async () => {
    const pagePayload = {
      id: "7",
      title: "Runbook",
      space: { name: "Operations" },
      body: {
        storage: {
          value: `<p>Смотри <ri:attachment ri:filename="${DOCX}"/></p>`,
        },
      },
    };
    const collection = {
      results: [
        {
          title: DOCX,
          metadata: { mediaType: "application/msword" },
          extensions: { fileSize: 47104 },
          _links: {
            base: "https://w.corp/",
            download: `/download/attachments/7/${encodeURIComponent(DOCX)}?version=3&api=v2`,
          },
        },
        {
          title: "схема.png",
          metadata: { mediaType: "image/png" },
          extensions: { fileSize: 233000 },
        },
      ],
    };
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence" }),
      async (url) =>
        url.pathname.endsWith("/child/attachment")
          ? { statusCode: 200, data: collection }
          : { statusCode: 200, data: pagePayload },
    );
    expect(markdown).toContain("## Attachments");
    // The versioned link Confluence returned is preferred over the bare path.
    expect(markdown).toContain(
      `- [${DOCX}](https://w.corp/download/attachments/7/${encodeURIComponent(DOCX)}?version=3&api=v2) — 46.0 KiB, application/msword`,
    );
    expect(markdown).toContain("- [схема.png](");
    expect(markdown).toContain("227.5 KiB, image/png");
  });

  test("the attachment list is capped and says how many it kept", async () => {
    const collection = {
      results: Array.from({ length: 5 }, (_, index) => ({
        title: `file-${index}.docx`,
      })),
    };
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence", maxAttachments: 2 }),
      async (url) =>
        url.pathname.endsWith("/child/attachment")
          ? { statusCode: 200, data: collection }
          : {
              statusCode: 200,
              data: { id: "7", title: "T", body: { storage: { value: "" } } },
            },
    );
    expect(markdown).toContain("- [file-0.docx](");
    expect(markdown).toContain("- [file-1.docx](");
    expect(markdown).not.toContain("file-2.docx");
    expect(markdown).toContain("_[list capped at 2 attachments]_");
  });

  test("a failed attachment listing never costs the page", async () => {
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence" }),
      async (url) => {
        if (url.pathname.endsWith("/child/attachment")) throw new Error("boom");
        return {
          statusCode: 200,
          data: {
            id: "7",
            title: "Runbook",
            body: { storage: { value: "<p>Hello world</p>" } },
          },
        };
      },
    );
    expect(markdown).toContain("Hello world");
    expect(markdown).toContain("_[attachment list unavailable]_");
  });

  test("maxAttachments: 0 turns the listing off without a marker", async () => {
    const { markdown } = await fetchPageMarkdown(
      new URL("https://w.corp/pages/7"),
      adapterSettings({ type: "confluence", maxAttachments: 0 }),
      async (url) => {
        if (url.pathname.endsWith("/child/attachment"))
          throw new Error("must not be requested");
        return {
          statusCode: 200,
          data: {
            id: "7",
            title: "Runbook",
            body: { storage: { value: "<p>Hi</p>" } },
          },
        };
      },
    );
    expect(markdown).toContain("Hi");
    expect(markdown).not.toContain("Attachments");
  });
});

describe("adapter seam", () => {
  test("falls through for none adapters and unrecognized URLs", async () => {
    const none = await applyAdapter(
      new URL("https://jira.corp/browse/PROJ-1"),
      context(adapterSettings({ type: "none" })),
    );
    expect(none).toBeUndefined();
    const unmapped = await applyAdapter(
      new URL("https://jira.corp/status"),
      context(adapterSettings()),
    );
    expect(unmapped).toBeUndefined();
  });

  test("a view-page link is served from the REST API, not passed through raw", async () => {
    // The adapter reads the rule's char limit after the REST hop, so the seam
    // context carries a resolved rule (the provider always supplies one).
    const rule = {
      adapter: adapterSettings({ type: "confluence" }),
      source: { id: "r" },
      limits: { maxBodyChars: 100_000 },
    } as unknown as ResolvedRule;
    const result = await applyAdapter(
      new URL("https://jira.corp/wiki/pages/viewpage.action?pageId=112996462"),
      {
        rule,
        rules: [rule],
        globals: { maxUrlLength: 2048, userAgent: "test" },
        resolveSecrets: async () => ({}),
      },
      async (restUrl) => {
        if (restUrl.pathname.endsWith("/child/attachment")) {
          // A page without attachments contributes no section to the text.
          return {
            url: restUrl.toString(),
            statusCode: 200,
            body: { kind: "text", content: JSON.stringify({ results: [] }) },
            truncated: false,
          };
        }
        expect(restUrl.pathname).toBe("/wiki/rest/api/content/112996462");
        return {
          url: restUrl.toString(),
          statusCode: 200,
          body: {
            kind: "text",
            content: JSON.stringify({
              title: "Регламент по работе с Git",
              space: { name: "SD" },
              version: { when: "2022-01-21T00:00:00.000Z" },
              body: {
                storage: {
                  value:
                    "<h2>Принятая схема ветвления</h2><p>Одна основная ветка.</p>" +
                    '<ac:structured-macro ac:name="toc"/>',
                },
              },
            }),
          },
          truncated: false,
        };
      },
    );
    // Page metadata plus the converted body: no wiki chrome, no macro marker.
    expect(result?.body.content).toBe(
      [
        "# Регламент по работе с Git",
        "",
        "- Space: SD",
        "- Updated: 2022-01-21",
        "",
        "## Принятая схема ветвления",
        "",
        "Одна основная ветка.",
      ].join("\n"),
    );
  });

  test("rejects non-JSON REST bodies with a structured error", async () => {
    const promise = applyAdapter(
      new URL("https://jira.corp/browse/PROJ-1"),
      context(adapterSettings()),
      async () => ({
        url: "u",
        statusCode: 200,
        body: { kind: "html", content: "<p>x</p>" },
        truncated: false,
      }),
    );
    await expect(promise).rejects.toMatchObject({
      code: "AUTH_FETCH_ADAPTER_FAILED",
    });
  });

  test("rejects malformed JSON with a structured error", async () => {
    const promise = applyAdapter(
      new URL("https://jira.corp/browse/PROJ-1"),
      context(adapterSettings()),
      async () => ({
        url: "u",
        statusCode: 200,
        body: { kind: "text", content: "not-json" },
        truncated: false,
      }),
    );
    await expect(promise).rejects.toBeInstanceOf(WebError);
  });

  test("caps the generated text by maxBodyChars", async () => {
    const rule = {
      adapter: adapterSettings(),
      source: { id: "r" },
      limits: { maxBodyChars: 10 },
    } as unknown as ResolvedRule;
    const result = await applyAdapter(
      new URL("https://jira.corp/browse/PROJ-1"),
      {
        rule,
        rules: [rule],
        globals: { maxUrlLength: 2048, userAgent: "t" },
        resolveSecrets: async () => ({}),
      },
      async () => ({
        url: "u",
        statusCode: 200,
        body: { kind: "text", content: JSON.stringify(issuePayloadOf(100)) },
        truncated: false,
      }),
    );
    expect(result?.truncated).toBe(true);
    expect(result?.body.content.length).toBe(10);
  });

  function issuePayloadOf(summaryLength: number): unknown {
    return { key: "PROJ-1", fields: { summary: "x".repeat(summaryLength) } };
  }
});

describe("provider end-to-end with a Jira adapter over a fixture", () => {
  let server: FixtureServer | undefined;

  afterEach(async () => {
    if (server !== undefined) await server.close();
    server = undefined;
  });

  test("a browse URL is served from the REST fixture as normalized text", async () => {
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          key: "PROJ-1",
          fields: {
            summary: "Fixture issue",
            status: { name: "Open" },
            description: "plain body",
          },
        }),
      },
    );
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "jira" },
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/browse/**", "/rest/api/**"],
      },
    });
    const credentials = fakeCredentials({ TEST_TOKEN: "secret" });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials,
      logger: silentLogger(),
    });
    const result = await provider.fetch({
      url: `${server.origin}/browse/PROJ-1`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.kind).toBe("text");
    expect(result.body.content).toContain("# PROJ-1: Fixture issue");
    expect(result.body.content).toContain("plain body");
    expect(server.requests.map((request) => request.url)).toEqual([
      "/rest/api/2/issue/PROJ-1?fields=summary%2Cstatus%2Cassignee%2Creporter%2Cpriority%2Clabels%2Ccomponents%2Ccreated%2Cupdated",
    ]);
  });

  test("an adapter URL the adapter cannot map falls through to raw transport", async () => {
    server = await startFixture({
      "/open": {
        body: "<html><body>hello</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "jira" },
    });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
      logger: silentLogger(),
    });
    const result = await provider.fetch({ url: `${server.origin}/open` });
    expect(result.body.kind).toBe("html");
    expect(result.body.content).toContain("hello");
  });

  test("a Confluence rule serves the page with its configured cleanup level", async () => {
    const storage =
      '<h1>Runbook</h1><ac:structured-macro ac:name="toc"/><p><ac:image><ri:attachment ri:filename="schema.png"/></ac:image></p>';
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          id: "7",
          title: "Runbook",
          space: { name: "Operations" },
          body: { storage: { value: storage } },
        }),
      },
    );
    const ruleFor = (cleanup: "balanced" | "strict"): AuthenticatedFetchRule =>
      fixtureRule(server!.origin, {
        adapter: { type: "confluence", cleanup },
        match: {
          schemes: ["http"],
          hosts: ["127.0.0.1"],
          ports: [server!.port],
          allowPaths: ["/pages/**", "/rest/api/**"],
        },
      });
    const providerFor = (
      rule: AuthenticatedFetchRule,
    ): AuthenticatedFetchProvider =>
      new AuthenticatedFetchProvider({
        configSource: () => configWith([rule]),
        credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
        logger: silentLogger(),
      });

    const balanced = await providerFor(ruleFor("balanced")).fetch({
      url: `${server.origin}/pages/7`,
    });
    expect(balanced.body.content).toContain("# Runbook");
    expect(balanced.body.content).toContain(
      `[schema.png](${server.origin}/download/attachments/7/schema.png?api=v2)`,
    );
    expect(balanced.body.content).not.toContain("[macro: toc");

    const strict = await providerFor(ruleFor("strict")).fetch({
      url: `${server.origin}/pages/7`,
    });
    expect(strict.body.content).toContain("# Runbook");
    expect(strict.body.content).not.toContain("_[");
  });

  test("a Server view-page link under a context path is served end to end", async () => {
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          id: "112996462",
          title: "Регламент по работе с Git",
          space: { name: "SD" },
          body: { storage: { value: "<p>Одна основная ветка.</p>" } },
        }),
      },
    );
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "confluence" },
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/wiki/**"],
      },
    });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
      logger: silentLogger(),
    });
    const result = await provider.fetch({
      url: `${server.origin}/wiki/pages/viewpage.action?pageId=112996462`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.content).toContain("# Регламент по работе с Git");
    expect(result.body.content).toContain("Одна основная ветка.");
    expect(server.requests.map((request) => request.url)).toEqual([
      "/wiki/rest/api/content/112996462?expand=body.storage%2Cspace%2Cversion",
      "/wiki/rest/api/content/112996462/child/attachment?limit=50&expand=version%2Cmetadata",
    ]);
  });
});

describe("adapter configuration", () => {
  test("defaults resolve to none with server flavor", () => {
    const config = resolveConfig(
      configWith([fixtureRule("http://127.0.0.1:1")]),
    );
    expect(config.rules[0]?.adapter).toEqual({
      type: "none",
      jiraFlavor: "server",
      maxAttachments: 50,
      includeComments: false,
      includeLinks: false,
      cleanup: "balanced",
    });
  });

  test("adapter settings resolve with defaults applied", () => {
    const config = resolveConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "jira", includeComments: true },
        }),
      ]),
    );
    expect(config.rules[0]?.adapter).toEqual({
      type: "jira",
      jiraFlavor: "server",
      maxAttachments: 50,
      includeComments: true,
      includeLinks: false,
      cleanup: "balanced",
    });
  });

  test("a confluence rule carries its cleanup level into the adapter settings", () => {
    const config = resolveConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "confluence", cleanup: "strict" },
        }),
      ]),
    );
    expect(config.rules[0]?.adapter.cleanup).toBe("strict");
    expect(
      validateRule(
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "confluence", cleanup: "aggressive" as never },
        }),
        0,
      ).some((error) => error.includes("adapter.cleanup")),
    ).toBe(true);
  });

  test("unknown adapter types and flavors are rejected", () => {
    const broken = fixtureRule("http://127.0.0.1:1", {
      adapter: { type: "wiki" as never },
    });
    const errors = validateRule(broken, 0);
    expect(errors.some((error: string) => error.includes("adapter type"))).toBe(
      true,
    );
    const badFlavor = fixtureRule("http://127.0.0.1:1", {
      adapter: { type: "jira", jiraFlavor: "solaris" as never },
    });
    expect(
      validateRule(badFlavor, 0).some((error: string) =>
        error.includes("jiraFlavor"),
      ),
    ).toBe(true);
  });
});
