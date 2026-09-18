/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { describe, expect, test } from "vitest";
import {
  contentApiUrl,
  contentLookupUrl,
  extractPageRef,
  fetchPageMarkdown,
  restPrefix,
  storageToMarkdown,
} from "../src/adapters/confluence.js";
import { adapterSettings } from "./adapters.helpers.js";

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
