/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { describe, expect, test } from "vitest";
import {
  fetchPageMarkdown,
  storageToMarkdown,
} from "../src/adapters/confluence.js";
import { adapterSettings } from "./adapters.helpers.js";

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
