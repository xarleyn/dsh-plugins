import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  canonicalizeWorkspacePath,
  compactLocations,
  createDefaultSourceExtractorRegistry,
  dedupeAndRankSources,
  QaSourceCollector,
  normalizeReportedSource,
} from "../src/provenance/index.js";
import type {
  QaSourceOrigin,
  QaSourceReference,
} from "../src/provenance/types.js";

const parentOrigin: QaSourceOrigin = {
  sessionId: "session-1",
  turn: 2,
  step: 1,
  toolCallId: "call-1",
  toolName: "web_search",
  role: "parent",
};

describe("source normalization", () => {
  it("canonicalizes URLs without discarding business parameters", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://Example.COM:443/docs/?b=2&utm_source=qa&a=1#part",
      ),
    ).toBe("https://example.com/docs?a=1&b=2");
    expect(canonicalizeUrl("file:///secret.txt")).toBeNull();
  });

  it("honors URL normalization and tracking switches", () => {
    expect(
      canonicalizeUrl("https://Example.com/docs/?utm_source=qa&b=2#part", {
        normalize: false,
        stripTrackingParams: false,
      }),
    ).toBe("https://example.com/docs/?utm_source=qa&b=2#part");
  });

  it("normalizes workspace paths and compacts adjacent ranges", () => {
    expect(
      canonicalizeWorkspacePath(
        "D:\\repo\\docs\\..\\docs\\guide.md",
        "d:/repo",
      ),
    ).toBe("docs/guide.md");
    expect(
      compactLocations([
        { path: "docs/a.md", lineStart: 8, lineEnd: 12 },
        { path: "docs/a.md", lineStart: 13, lineEnd: 15 },
        { path: "docs/a.md", lineStart: 30, lineEnd: 31 },
      ]),
    ).toEqual([
      { path: "docs/a.md", lineStart: 8, lineEnd: 15 },
      { path: "docs/a.md", lineStart: 30, lineEnd: 31 },
    ]);
  });
});

describe("source dedupe", () => {
  it("promotes fetched evidence and merges origins", () => {
    const discovered: QaSourceReference = {
      id: "web:https://example.com/docs",
      kind: "web",
      title: "Search title",
      uri: "https://example.com/docs",
      locations: [],
      evidence: "discovered",
      origins: [parentOrigin],
      score: 20,
    };
    const fetched: QaSourceReference = {
      ...discovered,
      title: "Fetched documentation",
      evidence: "fetched",
      origins: [
        {
          ...parentOrigin,
          toolCallId: "call-2",
          toolName: "web_fetch",
          role: "subagent",
          subagentRunId: "run-1",
        },
      ],
      score: 100,
    };
    expect(dedupeAndRankSources([discovered, fetched])).toEqual([
      expect.objectContaining({
        id: discovered.id,
        title: "Fetched documentation",
        evidence: "fetched",
        score: 100,
        origins: [parentOrigin, fetched.origins[0]],
      }),
    ]);
  });

  it("keeps exact file ranges separate when compaction is disabled", () => {
    const source: QaSourceReference = {
      id: "file:src/a.ts",
      kind: "code",
      title: "a.ts",
      path: "src/a.ts",
      locations: [{ path: "src/a.ts", lineStart: 1, lineEnd: 3 }],
      evidence: "read",
      origins: [parentOrigin],
      score: 100,
    };
    const next = {
      ...source,
      locations: [{ path: "src/a.ts", lineStart: 4, lineEnd: 6 }],
      origins: [{ ...parentOrigin, toolCallId: "call-2" }],
    };

    expect(
      dedupeAndRankSources([source, next], { mergeFileRanges: false })[0]
        ?.locations,
    ).toEqual([
      { path: "src/a.ts", lineStart: 1, lineEnd: 3 },
      { path: "src/a.ts", lineStart: 4, lineEnd: 6 },
    ]);
  });
});

describe("structured extractors", () => {
  it("uses read metadata for exact line provenance", () => {
    const collector = new QaSourceCollector({
      sessionId: "session-1",
      turn: 2,
      registry: createDefaultSourceExtractorRegistry(),
    });
    collector.observe({
      toolName: "read",
      args: { file_path: "wrong.md" },
      result: [{ type: "text", text: "fallback" }],
      presentation: {
        path: "docs/guide.md",
        offset: 20,
        lines: [
          { number: 20, text: "# Guide" },
          { number: 21, text: "Body" },
        ],
        totalLines: 80,
        lang: "md",
      },
      origin: { ...parentOrigin, toolName: "read" },
    });
    expect(collector.snapshot()).toMatchObject({
      version: 1,
      sessionId: "session-1",
      turn: 2,
      complete: true,
      sources: [
        {
          id: "file:docs/guide.md",
          kind: "file",
          evidence: "read",
          locations: [{ path: "docs/guide.md", lineStart: 20, lineEnd: 21 }],
          metadata: { totalLines: 80, lang: "md" },
        },
      ],
    });
  });

  it("bounds search evidence and promotes a later fetch", () => {
    const collector = new QaSourceCollector({
      sessionId: "session-1",
      turn: 2,
      registry: createDefaultSourceExtractorRegistry(2),
    });
    collector.observe({
      toolName: "web_search",
      args: { query: "docs" },
      result: [],
      presentation: {
        sources: [
          { url: "https://example.com/a?utm_source=q", title: "A" },
          { url: "https://example.com/b", title: "B" },
          { url: "https://example.com/c", title: "C" },
        ],
        truncated: false,
      },
      origin: parentOrigin,
    });
    collector.observe({
      toolName: "web_fetch",
      args: { url: "https://example.com/a" },
      result: [{ type: "text", text: "Fetched A" }],
      presentation: {
        url: "https://example.com/a",
        statusCode: 200,
        truncated: false,
      },
      origin: {
        ...parentOrigin,
        toolCallId: "call-2",
        toolName: "web_fetch",
      },
    });
    const snapshot = collector.snapshot();
    expect(
      snapshot.sources.map((source) => [source.id, source.evidence]),
    ).toEqual([
      ["web:https://example.com/a", "fetched"],
      ["web:https://example.com/b", "queried"],
    ]);
    expect(snapshot.discovered?.map((source) => source.id)).toEqual([
      "web:https://example.com/c",
    ]);
  });

  it("extracts structured Jira, Confluence and knowledge records", () => {
    const registry = createDefaultSourceExtractorRegistry();
    const cases = [
      {
        toolName: "jira_get_issue",
        result: {
          key: "mdc-12",
          fields: { summary: "Fix history" },
          url: "https://jira.example/browse/MDC-12",
        },
        id: "jira:MDC-12",
      },
      {
        toolName: "confluence_get_page",
        result: {
          type: "page",
          id: "12345",
          title: "Architecture",
          url: "https://wiki.example/pages/12345",
        },
        id: "confluence:12345",
      },
      {
        toolName: "knowledge_get",
        result: { documentId: "doc-7", title: "Runbook", backend: "internal" },
        id: "knowledge:internal:doc-7",
      },
    ];
    for (const candidate of cases) {
      expect(
        registry
          .extract({
            toolName: candidate.toolName,
            args: {},
            result: candidate.result,
            origin: parentOrigin,
          })
          .map((source) => source.id),
      ).toContain(candidate.id);
    }
  });

  it("normalizes structured fallback reports without parsing prose", () => {
    expect(
      normalizeReportedSource(
        {
          kind: "code",
          title: "worker.ts",
          path: "D:/repo/src/worker.ts",
          locations: [{ lineStart: 10, lineEnd: 20 }],
        },
        { ...parentOrigin, role: "subagent" },
        "D:/repo",
      ),
    ).toMatchObject({
      id: "file:src/worker.ts",
      kind: "code",
      evidence: "reported",
      locations: [{ path: "src/worker.ts", lineStart: 10, lineEnd: 20 }],
    });
  });
});
