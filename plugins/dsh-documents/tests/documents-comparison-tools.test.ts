/**
 * The comparison tools end to end (§5–§7, §22–§24).
 *
 * Everything below the tools has its own tests; this file exercises the whole
 * path the model actually sees: two documents on disk, a comparison artifact
 * written under the session's artifact root, a bounded preview in the tool
 * result, and pages of changes read back by id. It also pins the properties the
 * specification asks for by name — determinism, stable ids, and the fact that
 * disabling the feature removes the tools instead of weakening them.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  createDocumentTools,
  DOCUMENT_COMPARISON_TOOL_NAMES,
  DOCUMENT_TOOL_NAMES,
} from "../src/documents/tools/index.js";
import {
  docxWithBody,
  heading,
  paragraph,
  table,
} from "./helpers/comparison-fixtures.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

let workspace: string;
let stub: StubProviders;

const CONTRACT_BEFORE = [
  "# Договор оказания услуг",
  "",
  "## 5. Стоимость",
  "",
  "## 5.2 Порядок оплаты",
  "",
  "Оплата производится в течение 10 рабочих дней.",
  "",
  "## 6. Ответственность",
  "",
  "Исполнитель несёт ответственность за убытки.",
  "",
].join("\n");

const CONTRACT_AFTER = [
  "# Договор оказания услуг",
  "",
  "## 5. Стоимость",
  "",
  "## 5.2 Порядок оплаты",
  "",
  "Оплата производится в течение 30 календарных дней.",
  "",
  "## 6. Ответственность",
  "",
  "Исполнитель не несёт ответственности за убытки.",
  "",
  "## 7. Прочие условия",
  "",
  "Договор вступает в силу с момента подписания.",
  "",
].join("\n");

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-compare-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runtime(
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(config),
    providers: stub.providers,
    now: () => new Date("2026-09-14T10:00:00Z"),
  });
}

function tool(runtimeInstance: DocumentRuntime, name: string): ToolDefinition {
  const definition = createDocumentTools({ runtime: runtimeInstance }).find(
    (entry) => entry.name === name,
  );
  if (definition === undefined)
    throw new Error(`tool ${name} is not registered`);
  return definition;
}

function exec(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: {
      session: { header: { cwd: workspace, id: "session-1" } },
    },
  } as unknown as ToolRunContext;
}

async function run(
  runtimeInstance: DocumentRuntime,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await tool(runtimeInstance, name).execute(args, exec())) as Record<
    string,
    unknown
  >;
}

async function write(name: string, content: string | Buffer): Promise<string> {
  const target = path.join(workspace, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return name;
}

function artifactRoot(): string {
  return path.join(workspace, ".qa", "artifacts", "documents");
}

async function errorOf(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    if (error instanceof DocumentError) return error.code;
    throw error;
  }
  throw new Error("the call did not fail");
}

describe("document_compare", () => {
  test("compares two Markdown documents and reports what changed", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const result = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });

    expect(result.comparisonId).toMatch(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(result.status).toBe("completed");
    // Two edited paragraphs, plus the added section — one heading and one
    // paragraph — which is two insertions and not one.
    expect(result.summary).toMatchObject({
      replacements: 2,
      insertions: 2,
      deletions: 0,
      moves: 0,
      total: 4,
    });
    expect(result.previewTruncated).toBe(false);
    const preview = result.preview as { changeId: string; signals: string[] }[];
    expect(preview.length).toBe(4);
    expect(preview[0]?.signals).toContain("DURATION_CHANGED");
    expect(preview[1]?.signals).toContain("NEGATION_CHANGED");

    // The artifact is a real bundle, with the layout the spec fixes (§22).
    const bundle = path.join(artifactRoot(), result.comparisonId as string);
    const files = (await readdir(bundle, { recursive: true })).map((entry) =>
      entry.split(path.sep).join("/"),
    );
    expect(files).toContain("manifest.json");
    expect(files).toContain("diff/changes.jsonl");
    expect(files).toContain("diff/report.md");
    expect(files).toContain("diff/summary.json");
    expect(files).toContain("inputs/left.md");
    expect(files).toContain("normalized/left.json");

    const manifest = JSON.parse(
      await readFile(path.join(bundle, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.kind).toBe("document-comparison");
    expect(manifest.operation).toBe("document_compare");
    const comparison = manifest.comparison as {
      engine: { diff: string };
      changes: number;
      quality: { level: string };
    };
    expect(comparison.engine.diff).toBe("document-diff-v1");
    expect(comparison.changes).toBe(4);
    expect(comparison.quality.level).toBe("high");

    const report = await readFile(
      path.join(bundle, "diff", "report.md"),
      "utf8",
    );
    // Sections are the heading path, outermost first (§35).
    expect(report).toContain("## Договор оказания услуг › 5.2 Порядок оплаты");
    expect(report).toContain("30 календарных дней");
    expect(report).toContain("Signals: `NUMBER_CHANGED`, `DURATION_CHANGED`");
  });

  test("compares DOCX packages without any converter", async () => {
    await write(
      "before.docx",
      docxWithBody({
        body:
          heading("5.2 Порядок оплаты", 2) +
          paragraph("Оплата производится в течение 10 рабочих дней.") +
          table([
            ["Позиция", "Сумма"],
            ["Лицензия", "500 000 ₽"],
          ]),
      }),
    );
    await write(
      "after.docx",
      docxWithBody({
        body:
          heading("5.2 Порядок оплаты", 2) +
          paragraph("Оплата производится в течение 30 рабочих дней.") +
          table([
            ["Позиция", "Сумма"],
            ["Лицензия", "750 000 ₽"],
          ]),
      }),
    );
    const instance = runtime();
    const result = await run(instance, "document_compare", {
      left: { path: "before.docx" },
      right: { path: "after.docx" },
      mode: "contract",
    });
    expect(result.summary).toMatchObject({ replacements: 2, insertions: 0 });
    const preview = result.preview as { changeId: string; location: string }[];
    expect(preview.map((entry) => entry.location)).toEqual([
      "5.2 Порядок оплаты",
      "5.2 Порядок оплаты, table 1, row 1, column 1",
    ]);
    // A DOCX pair is the high-quality case, and it never touched a provider.
    expect(stub.calls.extract).toHaveLength(0);
    expect(stub.calls.docx).toHaveLength(0);
    expect(result.quality).toMatchObject({
      level: "high",
      leftExtraction: "native-docx",
      rightExtraction: "native-docx",
    });
  });

  test("headers and footers are compared only in scope=all", async () => {
    const before = docxWithBody({
      body: paragraph("Текст договора."),
      extra: { "word/header1.xml": headerFixture("Редакция 1") },
    });
    const after = docxWithBody({
      body: paragraph("Текст договора."),
      extra: { "word/header1.xml": headerFixture("Редакция 2") },
    });
    await write("h1.docx", before);
    await write("h2.docx", after);
    const instance = runtime();
    const bodyOnly = await run(instance, "document_compare", {
      left: { path: "h1.docx" },
      right: { path: "h2.docx" },
      scope: "body",
    });
    expect(bodyOnly.summary).toMatchObject({ total: 0 });

    const everything = await run(instance, "document_compare", {
      left: { path: "h1.docx" },
      right: { path: "h2.docx" },
      scope: "all",
    });
    expect(everything.summary).toMatchObject({ replacements: 1 });
    const preview = everything.preview as { location: string }[];
    expect(preview[0]?.location).toContain("header");
  });

  test("an artifact id names a document the session produced earlier", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const extracted = await run(instance, "document_to_markdown", {
      file: "before.md",
    });
    const compareResult = await run(instance, "document_compare", {
      left: { artifactId: extracted.artifactId },
      right: { path: "after.md" },
    });
    expect(compareResult.summary).toMatchObject({ replacements: 2 });
    expect(compareResult.left).toMatchObject({ name: "before.md" });
  });

  test("the same inputs always produce the same change set (§24, §40)", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const digests: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await run(instance, "document_compare", {
        left: { path: "before.md" },
        right: { path: "after.md" },
      });
      digests.push(await readFile(result.changesPath as string, "utf8"));
    }
    expect(new Set(digests).size).toBe(1);
  });

  test("mode=contract is the conservative default of the deployment", () => {
    const instance = runtime();
    const effective = instance.comparisonOptions({});
    expect(effective.scope).toBe("all");
    expect(effective.options).toMatchObject({
      detectMoves: true,
      includeHeaders: true,
      includeFooters: true,
      includeFootnotes: true,
      ignoreWhitespace: true,
      ignoreFormatting: true,
      includeComments: false,
    });
    const plain = instance.comparisonOptions({ mode: "default" });
    expect(plain.scope).toBe("body");
    expect(plain.options.includeHeaders).toBe(true);
    const scoped = instance.comparisonOptions({
      mode: "contract",
      scope: "body",
    });
    expect(scoped.scope).toBe("body");
  });

  test("an explicit option overrides the mode", () => {
    const instance = runtime();
    const effective = instance.comparisonOptions({
      mode: "contract",
      options: { includeHeaders: false },
    });
    expect(effective.options.includeHeaders).toBe(false);
  });
});

describe("document_diff_read", () => {
  test("pages through a change set with a cursor", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;

    const first = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 2,
    });
    expect(first.returned).toBe(2);
    expect(first.total).toBe(4);
    expect(first.remaining).toBe(2);
    expect(typeof first.nextCursor).toBe("string");

    const second = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.returned).toBe(2);
    expect(second.remaining).toBe(0);
    expect(second.nextCursor).toBeUndefined();
    const ids = [
      ...(first.changes as { id: string }[]),
      ...(second.changes as { id: string }[]),
    ].map((change) => change.id);
    expect(new Set(ids).size).toBe(4);
  });

  test("filters by signal family name and by kind", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;

    const money = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { signals: ["deadline"] },
    });
    expect(money.returned).toBe(1);
    expect((money.changes as { signals: string[] }[])[0]?.signals).toContain(
      "DURATION_CHANGED",
    );

    // A short family name and a full code select the same changes; a name that
    // is neither is refused instead of silently matching nothing.
    const obligation = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { signals: ["OBLIGATION_TERM_CHANGED"] },
    });
    expect(obligation.returned).toBe(0);

    const inserts = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { kinds: ["insert"] },
    });
    expect(inserts.returned).toBe(2);
    expect(
      (inserts.changes as { kind: string }[]).every(
        (change) => change.kind === "insert",
      ),
    ).toBe(true);
  });

  test("filters by section and refuses a cursor from another filter", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const compared = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    const comparisonId = compared.comparisonId as string;
    const section = await run(instance, "document_diff_read", {
      comparisonId,
      filters: { section: "ответственность" },
    });
    expect(section.returned).toBe(1);

    // A cursor names a place in one filtered stream; reusing it under another
    // filter is a caller mistake, and the fingerprint makes it visible.
    const paged = await run(instance, "document_diff_read", {
      comparisonId,
      limit: 1,
    });
    expect(paged.returned).toBe(1);
    expect(typeof paged.nextCursor).toBe("string");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId,
          cursor: paged.nextCursor,
          filters: { section: "6" },
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId,
          cursor: "not-a-cursor",
        }),
      ),
    ).toBe("INVALID_INPUT");
  });

  test("an unknown comparison id is reported, not guessed", async () => {
    const instance = runtime();
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", {
          comparisonId: "cmp_01K51GQ7V18R3PQ9J11A87AVFB",
        }),
      ),
    ).toBe("COMPARE_ARTIFACT_NOT_FOUND");
    expect(
      await errorOf(() =>
        run(instance, "document_diff_read", { comparisonId: "not-an-id" }),
      ),
    ).toBe("COMPARE_ARTIFACT_NOT_FOUND");
  });
});

describe("registration and configuration (§31)", () => {
  test("comparison tools appear beside the others", () => {
    const names = createDocumentTools({ runtime: runtime() }).map(
      (definition) => definition.name,
    );
    expect(names).toEqual([
      ...DOCUMENT_TOOL_NAMES,
      ...DOCUMENT_COMPARISON_TOOL_NAMES,
    ]);
  });

  test("comparison.enabled=false removes the tools instead of weakening them", async () => {
    const instance = runtime({ comparison: { enabled: false } });
    const names = createDocumentTools({ runtime: instance }).map(
      (definition) => definition.name,
    );
    expect(names).toEqual([...DOCUMENT_TOOL_NAMES]);
    expect(
      await errorOf(() =>
        instance.compare({ left: {}, right: {} }, { workspaceRoot: workspace }),
      ),
    ).toBe("BACKEND_UNAVAILABLE");
  });

  test("a deployment can tighten the comparison budgets", async () => {
    const instance = runtime({
      comparison: { maxNodes: 3, maxInputBytes: 4096 },
    });
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    expect(
      await errorOf(() =>
        run(instance, "document_compare", {
          left: { path: "before.md" },
          right: { path: "after.md" },
        }),
      ),
    ).toBe("COMPARE_TOO_MANY_NODES");
  });

  test("the preview is bounded by inlineChanges", async () => {
    const instance = runtime({ comparison: { inlineChanges: 1 } });
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const result = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });
    expect((result.preview as unknown[]).length).toBe(1);
    expect(result.previewTruncated).toBe(true);
  });
});

function headerFixture(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(text)}</w:hdr>`;
}
