import { describe, expect, it } from "vitest";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { MemoryQaProvenanceSnapshotStore } from "../../src/provenance/snapshot-store.js";
import { createDefaultSourceExtractorRegistry } from "../../src/provenance/extractors.js";
import { QaSourceCollector } from "../../src/provenance/collector.js";
import { dedupeAndRankSources } from "../../src/provenance/dedupe.js";
import { buildSourceRefs } from "../../src/client/components/source-refs.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  event,
  fakeSession,
  harness,
  readEvents,
} from "./provenance-host.helpers.js";
import type { SourceExtractorContext } from "../../src/provenance/types.js";

const context = (
  toolName: string,
  value: unknown,
  args: unknown = {},
): SourceExtractorContext => ({
  toolName,
  args,
  result: [{ type: "text", text: JSON.stringify(value) }],
  workspaceRoot: "/work",
  origin: { sessionId: "root", turn: 1, toolName, role: "parent" },
});
const registry = createDefaultSourceExtractorRegistry();

describe("source evidence repair", () => {
  it.each(["error", "mismatch"])(
    "rejects a %s result without attributing evidence",
    (mode) => {
      const events = readEvents("D:/repo/docs/guide.md");
      const result = events[2]!.data as {
        message: { isError: boolean; toolCallId: string };
      };
      if (mode === "error") result.message.isError = true;
      else result.message.toolCallId = "another-call";
      const root = fakeSession("root", events);
      const host = new QaProvenanceHost(harness([root.session]).ctx, () =>
        resolveConfig(),
      );
      expect(host.bundles("root").flatMap((bundle) => bundle.sources)).toEqual(
        [],
      );
      host.dispose();
    },
  );

  it("replaces a previously empty completed-turn snapshot and persists it without a new turn", () => {
    const store = new MemoryQaProvenanceSnapshotStore();
    store.put({
      version: 1,
      sessionId: "root",
      turn: 1,
      complete: true,
      sources: [],
    });
    const root = fakeSession("root", [
      ...readEvents("D:/repo/docs/guide.md"),
      event("turn/end", { turn: 1 }, 3),
    ]);
    const host = new QaProvenanceHost(
      harness([root.session]).ctx,
      () => resolveConfig(),
      store,
    );
    expect(host.bundles("root")[0]?.sources).toHaveLength(1);
    host.dispose();
    const restored = new QaProvenanceHost(
      harness([]).ctx,
      () => resolveConfig(),
      store,
    );
    expect(restored.bundles("root")[0]?.sources).toHaveLength(1);
    expect(root.appended).toEqual([]);
    restored.dispose();
  });

  it("resolves documentation against its configured root and honors actual read metadata", () => {
    const ctx = {
      ...context("docs_read", {}, { path: "guide.md" }),
      documentationRoot: "/shared/docs",
    };
    expect(registry.extract(ctx)[0]?.path).toBe("/shared/docs/guide.md");
    expect(
      registry.extract({
        ...ctx,
        presentation: {
          path: "/actual/docs/guide.md",
          aliases: ["guide.md"],
          lines: [{ number: 5, text: "Read" }],
        },
      })[0],
    ).toMatchObject({
      path: "/actual/docs/guide.md",
      locations: [{ lineStart: 5, lineEnd: 5 }],
    });
  });

  it("records consumed document inputs without claiming generated outputs were read", () => {
    const result = registry.extract({
      ...context(
        "document_to_markdown",
        { artifacts: [{ path: "/work/output.md" }] },
        { file: "input.pdf" },
      ),
      presentation: {
        qaDocumentSource: {
          path: "/work/input.pdf",
          snippet: "Consumed text",
          truncated: true,
        },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "input.pdf",
      evidence: "read",
      snippet: "Consumed text",
    });
    expect(
      registry.extract(
        context("document_inspect", {}, { file: "input.pdf" }),
      )[0],
    ).toMatchObject({ evidence: "queried", metadata: { metadataOnly: true } });
    expect(result[0]?.metadata?.truncated).toBe(true);
    expect(
      dedupeAndRankSources([
        ...result,
        ...registry.extract(
          context("document_inspect", {}, { file: "input.pdf" }),
        ),
      ])[0],
    ).toMatchObject({ evidence: "read", metadata: { metadataOnly: false } });
  });

  it("records spreadsheet pages as read sources and sheet inventories as metadata", () => {
    expect(
      registry.extract(
        context(
          "spreadsheet_read",
          {},
          { file: "input.xlsx", sheet: "Summary" },
        ),
      )[0],
    ).toMatchObject({
      path: "input.xlsx",
      evidence: "read",
      metadata: { metadataOnly: false },
    });
    expect(
      registry.extract(
        context("spreadsheet_inspect", {}, { file: "input.xlsx" }),
      )[0],
    ).toMatchObject({
      path: "input.xlsx",
      evidence: "queried",
      metadata: { metadataOnly: true },
    });
    expect(
      registry.extract(
        context("spreadsheet_create", {}, { filename: "report.xlsx" }),
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "jira_get_issue",
      {
        key: "PROJ-123",
        summary: "Demo issue",
        url: "https://jira.example.corp/browse/PROJ-123",
      },
      "jira",
    ] as const,
    [
      "confluence_get_page",
      {
        pageId: "123",
        title: "Demo page",
        url: "https://wiki.example.corp/pages/123",
      },
      "confluence",
    ] as const,
    ...["bitrix24", "gitlab", "teamcity", "testit", "weblate"].map(
      (provider) =>
        [
          `${provider}_get_item`,
          { name: "Demo item", webUrl: "https://example.com/items/123" },
          "other",
        ] as const,
    ),
  ])(
    "extracts %s from the integration's actual JSON text renderer",
    (tool, value, kind) => {
      const ctx = context(String(tool), value);
      expect(registry.extract(ctx)).toEqual([
        expect.objectContaining({ kind, evidence: "queried" }),
      ]);
      expect(
        registry.extract({
          ...ctx,
          result: [{ type: "text", text: `prefix ${JSON.stringify(value)}` }],
        }),
      ).toEqual([]);
    },
  );

  it("marks an unaddressable consumed read as incomplete while an empty search remains complete", () => {
    const collector = new QaSourceCollector({
      sessionId: "root",
      turn: 1,
      registry,
    });
    collector.observe(context("jira_search", { issues: [] }));
    expect(collector.snapshot().complete).toBe(true);
    collector.observe(context("read", "contents"));
    expect(collector.snapshot()).toMatchObject({
      complete: false,
      incompleteOrigins: [{ provider: "read" }],
    });
  });

  it("keeps real provider records without inventing their missing permalinks", () => {
    expect(
      registry.extract(
        context("bitrix24_tasks_get", {
          task: { id: "123", title: "Demo task" },
        }),
      )[0],
    ).toMatchObject({
      title: "Demo task",
      metadata: { provider: "bitrix24", addressUnavailable: true },
    });
    expect(
      registry.extract(
        context("bitrix24_crm_get", { ID: "123", TITLE: "Demo record" }),
      )[0]?.uri,
    ).toBeUndefined();
    expect(
      registry.extract(
        context("teamcity_get_build", {
          id: 123,
          number: "42",
          webUrl: "https://ci.example.com/build/123",
        }),
      )[0],
    ).toMatchObject({ title: "42", uri: "https://ci.example.com/build/123" });
    expect(
      registry.extract(
        context("gitlab_get_item", {
          arbitrary: "https://example.com",
          id: "123",
        }),
      ),
    ).toEqual([]);
  });

  it("matches canonical URLs, absolute paths and aliases without folding POSIX case", () => {
    const file = registry.extract({
      ...context("read", {}, { path: "docs/Guide.md" }),
      presentation: { path: "/work/docs/Guide.md", aliases: ["Guide.md"] },
    })[0]!;
    const refs = buildSourceRefs([file]);
    expect(refs.resolvePath("/work/docs/Guide.md")?.id).toBe(file.id);
    expect(refs.resolvePath("Guide.md")?.id).toBe(file.id);
    expect(refs.resolvePath("guide.md")).toBeUndefined();
    const windows = buildSourceRefs([
      { ...file, metadata: { absolutePath: "D:/work/docs/Guide.md" } },
    ]);
    expect(windows.resolvePath("DOCS/guide.md")?.id).toBe(file.id);
    const web = {
      ...file,
      path: undefined,
      uri: "https://example.com/docs?a=1&b=2",
      kind: "web" as const,
    };
    expect(
      buildSourceRefs([web]).resolveUrl(
        "https://example.com/docs?b=2&utm_source=qa&a=1#part",
      )?.id,
    ).toBe(file.id);
    expect(buildSourceRefs([{ ...file, title: "Changed" }]).signature).not.toBe(
      refs.signature,
    );
  });
});
