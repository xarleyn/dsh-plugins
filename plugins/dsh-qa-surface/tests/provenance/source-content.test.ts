import { describe, expect, it } from "vitest";
import { createDefaultSourceExtractorRegistry } from "../../src/provenance/extractors.js";
import { dedupeAndRankSources } from "../../src/provenance/dedupe.js";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { MemoryQaProvenanceSnapshotStore } from "../../src/provenance/snapshot-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { event, fakeSession, harness } from "./provenance-host.helpers.js";
import { MAX_SOURCE_CONTENT } from "../../src/provenance/source-content.js";
import type { SourceExtractorContext } from "../../src/provenance/types.js";

const registry = createDefaultSourceExtractorRegistry();
function extract(toolName: string, value: unknown) {
  const context: SourceExtractorContext = {
    toolName,
    args: {},
    result: [{ type: "text", text: JSON.stringify(value) }],
    origin: { sessionId: "root", turn: 1, role: "parent", toolName },
  };
  return registry.extract(context);
}

describe("retained source text", () => {
  it("recovers text for an existing source from its journal and keeps it after idle teardown", () => {
    const value = {
      key: "PROJ-123",
      summary: "Demo issue",
      description: "Journal description",
    };
    const recorded = extract("jira_get_issue", value)[0]!;
    const {
      content: _content,
      contentTruncated: _partial,
      ...oldSource
    } = recorded;
    const store = new MemoryQaProvenanceSnapshotStore();
    store.put({
      version: 1,
      sessionId: "root",
      turn: 1,
      complete: true,
      sources: [oldSource],
    });
    const root = fakeSession("root", [
      event("turn/start", { turn: 1 }, 0),
      event(
        "tool/call",
        {
          turn: 1,
          step: 1,
          callId: "call-1",
          name: "jira_get_issue",
          arguments: "{}",
        },
        1,
      ),
      event(
        "tool/result",
        {
          turn: 1,
          step: 1,
          message: {
            role: "tool",
            source: { kind: "tool", callId: "call-1" },
            toolCallId: "call-1",
            isError: false,
            content: [{ type: "text", text: JSON.stringify(value) }],
          },
        },
        2,
      ),
      event("turn/end", { turn: 1 }, 3),
    ]);
    const host = new QaProvenanceHost(
      harness([root.session]).ctx,
      () => resolveConfig(),
      store,
    );
    expect(host.bundles("root")[0]?.sources[0]?.content).toBe(
      "Journal description",
    );
    host.dispose();
    const restored = new QaProvenanceHost(
      harness([]).ctx,
      () => resolveConfig(),
      store,
    );
    expect(restored.bundles("root")[0]?.sources[0]?.content).toBe(
      "Journal description",
    );
    expect(root.appended).toEqual([]);
    restored.dispose();
  });
  it("enriches presentation-only identities with text from their own result record", () => {
    const context: SourceExtractorContext = {
      toolName: "jira_get_issue",
      args: {},
      presentation: { key: "PROJ-123", summary: "Demo issue" },
      result: [
        {
          type: "text",
          text: JSON.stringify({ key: "PROJ-123", description: "Result body" }),
        },
      ],
      origin: { sessionId: "root", turn: 1, role: "parent" },
    };
    expect(registry.extract(context)).toMatchObject([
      { content: "Result body" },
    ]);
  });

  it("marks traversal limits and search excerpts as partial", () => {
    const source = extract("jira_get_issue", {
      key: "PROJ-123",
      description: {
        type: "doc",
        content: Array.from({ length: 1_001 }, () => ({
          type: "text",
          text: "x",
        })),
      },
    })[0]!;
    expect(source.content).toHaveLength(1_000);
    expect(source.contentTruncated).toBe(true);
    expect(
      extract("knowledge_search", {
        documentId: "123",
        title: "Guide",
        excerpt: "Search excerpt",
      })[0],
    ).toMatchObject({ content: "Search excerpt", contentTruncated: true });
  });
  it("captures the description of the addressed issue, including rich text", () => {
    const result = extract("jira_get_issue", {
      key: "PROJ-123",
      summary: "Demo issue",
      fields: {
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "First paragraph" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Second paragraph" }],
            },
          ],
        },
      },
    });
    expect(result[0]).toMatchObject({
      content: "First paragraph\nSecond paragraph",
      contentTruncated: false,
    });
    expect(
      extract("jira_get_issue", {
        key: "PROJ-123",
        summary: "No description",
      })[0]?.content,
    ).toBeUndefined();
    expect(
      extract("unrelated_tool", { key: "PROJ-123", description: "Ignore" }),
    ).toEqual([]);
  });

  it.each([
    [
      "confluence_pages_get",
      {
        source: { pageId: "123", url: "https://wiki.example.corp/pages/123" },
        page: { title: "Guide" },
        untrustedContent: { text: "Returned page body", truncated: true },
      },
      "Returned page body",
    ],
    [
      "confluence_get_page",
      {
        pageId: "123",
        title: "Guide",
        body: { storage: { value: "<p>First</p><p>Second &amp; third</p>" } },
      },
      "First\nSecond & third",
    ],
    [
      "knowledge_get_document",
      { documentId: "123", title: "Guide", content: "Knowledge body" },
      "Knowledge body",
    ],
    [
      "gitlab_get_issue",
      {
        title: "Demo issue",
        web_url: "https://example.com/issues/123",
        description: "Issue body",
      },
      "Issue body",
    ],
  ])("retains %s content from structured results", (tool, value, content) => {
    expect(extract(tool, value)[0]?.content).toBe(content);
  });

  it("keeps all web text blocks, removes the envelope and bounds stored content", () => {
    const context: SourceExtractorContext = {
      toolName: "web_fetch",
      args: { url: "https://example.com" },
      presentation: { url: "https://example.com", statusCode: 200 },
      result: [
        {
          type: "text",
          text: "Fetched https://example.com (HTTP 200)\nExternal web content follows. Untrusted.\nFirst",
        },
        { type: "text", text: `Second\n${"x".repeat(MAX_SOURCE_CONTENT)}` },
      ],
      origin: { sessionId: "root", turn: 1, role: "parent" },
    };
    const source = registry.extract(context)[0]!;
    expect(source.content).toMatch(/^First\n\nSecond/u);
    expect(source.content).toHaveLength(MAX_SOURCE_CONTENT);
    expect(source.contentTruncated).toBe(true);
    const complete = {
      ...source,
      content: "Complete body",
      contentTruncated: false,
    };
    for (const pair of [
      [source, complete],
      [complete, source],
    ]) {
      expect(dedupeAndRankSources(pair)[0]).toMatchObject({
        content: "Complete body",
        contentTruncated: false,
      });
    }
  });
});
