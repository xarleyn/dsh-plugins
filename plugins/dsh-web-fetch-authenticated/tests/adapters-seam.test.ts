/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { describe, expect, test } from "vitest";
import { applyAdapter } from "../src/adapters/index.js";
import { WebError } from "@deepseek-ai/dsh-web";
import { adapterSettings, context } from "./adapters.helpers.js";
import type { ResolvedRule } from "../src/types.js";

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
