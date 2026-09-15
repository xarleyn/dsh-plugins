/**
 * The agent-facing tools: their names, their schemas, what they render, and
 * what `installDocumentSubsystem` registers.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { installDocumentSubsystem } from "../src/documents/index.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  createDocumentTools,
  DOCUMENT_TOOL_NAMES,
  registerDocumentTools,
} from "../src/documents/tools/index.js";
import { docxBytes, pdfBytes } from "./helpers/document-fixtures.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

let workspace: string;
let stub: StubProviders;

beforeEach(async () => {
  workspace = path.join(tmpdir(), `qa-docs-tools-${process.pid}-${Date.now()}`);
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

function tools(
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
): ToolDefinition[] {
  return createDocumentTools({ runtime: runtime(config) });
}

function toolNamed(name: string): ToolDefinition {
  const definition = tools().find((entry) => entry.name === name);
  if (definition === undefined)
    throw new Error(`tool ${name} is not registered`);
  return definition;
}

/**
 * Evaluated per call: the workspace is created in `beforeEach`. Only the two
 * fields a document tool reads are real; the rest of the registry context is
 * irrelevant to what these tests assert.
 */
function exec(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: {
      session: { header: { cwd: workspace, id: "session-1" } },
    },
  } as unknown as ToolRunContext;
}

/** The declared projector of a tool: content blocks from the tool's value. */
function render(
  definition: ToolDefinition,
  value: unknown,
): { type: string; text?: string }[] {
  return definition.output.render({}, value as never) as {
    type: string;
    text?: string;
  }[];
}

describe("document tool definitions", () => {
  test("registers exactly the five semantic tools", () => {
    expect(DOCUMENT_TOOL_NAMES).toEqual([
      "document_create",
      "document_to_markdown",
      "document_from_url",
      "document_convert",
      "document_inspect",
    ]);
    expect(tools().map((definition) => definition.name)).toEqual([
      ...DOCUMENT_TOOL_NAMES,
    ]);
  });

  test("no tool accepts a free-form command line or a backend name", () => {
    for (const definition of tools()) {
      const serialized = JSON.stringify(definition.parameters);
      for (const forbidden of [
        "cli",
        "argv",
        "argument",
        "flags",
        "pandoc",
        "libreoffice",
        "docling",
        "executable",
        "lua-filter",
        "pdf-engine",
      ]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden);
      }
      expect(definition.description.length).toBeGreaterThan(40);
      expect(definition.output).toBeDefined();
    }
  });

  test("declares a tool-call timeout budget it can honour", () => {
    for (const definition of tools()) {
      expect(definition.timeoutMs).toBeGreaterThan(0);
    }
  });

  test("registers and disposes through the host registry", () => {
    const registered: string[] = [];
    const dispose = registerDocumentTools(
      {
        register: (definition) => {
          registered.push(definition.name);
          return () => {
            registered.splice(registered.indexOf(definition.name), 1);
          };
        },
      },
      { runtime: runtime() },
    );
    expect(registered).toEqual([...DOCUMENT_TOOL_NAMES]);
    dispose();
    expect(registered).toEqual([]);
  });
});

describe("document_create tool", () => {
  test("creates a document and renders the artifact facts", async () => {
    const definition = toolNamed("document_create");
    const value = (await definition.execute(
      { content: "# Report\n\nBody.", formats: ["docx"], filename: "report" },
      exec(),
    )) as Record<string, unknown>;
    expect(value["artifactId"]).toMatch(/^doc_/u);
    expect(value["files"]).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);

    const rendered = render(definition, value);
    expect(rendered[0]?.text).toContain(
      `artifact: ${String(value["artifactId"])}`,
    );
    expect(rendered[0]?.text).toContain("docx:");
    expect(rendered[0]?.text).toContain("manifest:");
  });

  test("fails closed without a session working directory", async () => {
    const definition = toolNamed("document_create");
    await expect(
      definition.execute(
        { content: "# x", formats: ["docx"] },
        {} as unknown as ToolRunContext,
      ),
    ).rejects.toBeInstanceOf(DocumentError);
    await expect(
      definition.execute({ content: "# x", formats: ["docx"] }, {
        agent: { session: { header: { cwd: "  " } } },
      } as unknown as ToolRunContext),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("surfaces the pipeline's structured error codes", async () => {
    const definition = toolNamed("document_create");
    await expect(
      definition.execute(
        { content: "# x", formats: ["pdf"], options: { pdfMode: "typst" } },
        exec(),
      ),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    await expect(
      definition.execute(
        { content: "![x](https://example.com/a.png)", formats: ["docx"] },
        exec(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ASSET" });
  });

  test("renders a partial success as a warning line", async () => {
    const failing = stubProviderSet({
      pdfError: new DocumentError("CONVERSION_FAILED", "libreoffice crashed"),
    });
    const definition = createDocumentTools({
      runtime: new DocumentRuntime({
        config: resolveDocumentsConfig(),
        providers: failing.providers,
      }),
    }).find((entry) => entry.name === "document_create");
    if (definition === undefined)
      throw new Error("document_create is not registered");
    const value = (await definition.execute(
      { content: "# x", formats: ["docx", "pdf"], filename: "report" },
      exec(),
    )) as Record<string, unknown>;
    const rendered = render(definition, value);
    expect(rendered[0]?.text).toContain("pdf: failed (CONVERSION_FAILED)");
    expect(rendered[0]?.text).toContain("warning FORMAT_FAILED");
  });
});

describe("document_to_markdown tool", () => {
  test("returns the extracted Markdown with the artifact path", async () => {
    const pdf = path.join(workspace, "report.pdf");
    await writeFile(pdf, pdfBytes({ pages: 2 }));
    const definition = toolNamed("document_to_markdown");
    const value = (await definition.execute({ file: pdf }, exec())) as Record<
      string,
      unknown
    >;
    expect(String(value["markdown"])).toContain("# Заголовок");
    expect(value["backend"]).toBe("docling");
    expect(value["pages"]).toBeUndefined();
    const rendered = render(definition, value);
    expect(rendered[0]?.text).toContain("markdown:");
    expect(rendered[0]?.text).toContain("# Заголовок");
  });
});

describe("document_convert tool", () => {
  test("converts and lists the produced file", async () => {
    const docx = path.join(workspace, "report.docx");
    await writeFile(docx, docxBytes());
    const definition = toolNamed("document_convert");
    const value = (await definition.execute(
      { file: docx, targetFormat: "pdf" },
      exec(),
    )) as Record<string, unknown>;
    expect((value["files"] as { format: string }[])[0]?.format).toBe("pdf");
    const rendered = render(definition, value);
    expect(rendered[0]?.text).toContain("source:");
    expect(rendered[0]?.text).toContain("pdf:");
  });

  test("refuses an unsupported route with the documented code", async () => {
    const pdf = path.join(workspace, "report.pdf");
    await writeFile(pdf, pdfBytes());
    await expect(
      toolNamed("document_convert").execute(
        { file: pdf, targetFormat: "docx" },
        exec(),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONVERSION" });
  });
});

describe("document_inspect tool", () => {
  test("reports structure and metadata without touching a backend", async () => {
    const docx = path.join(workspace, "report.docx");
    await writeFile(
      docx,
      docxBytes({ headings: ["A", "B"], tables: 1, title: "T" }),
    );
    const definition = toolNamed("document_inspect");
    const value = (await definition.execute({ file: docx }, exec())) as Record<
      string,
      unknown
    >;
    expect(value["format"]).toBe("docx");
    expect((value["structure"] as { headings: number }).headings).toBe(2);
    expect(stub.calls.docx).toHaveLength(0);
    expect(stub.calls.convert).toHaveLength(0);
    expect(stub.calls.extract).toHaveLength(0);
    const rendered = render(definition, value);
    expect(rendered[0]?.text).toContain("headings: 2");
    expect(rendered[0]?.text).toContain("title: T");
  });
});

describe("installDocumentSubsystem", () => {
  function fakeContext(): {
    ctx: unknown;
    registered: string[];
    disposers: (() => void)[];
    runDisposers: () => void;
  } {
    const registered: string[] = [];
    const disposers: (() => void)[] = [];
    return {
      registered,
      disposers,
      runDisposers: () => {
        for (const dispose of disposers.reverse()) dispose();
      },
      ctx: {
        tools: {
          register: (definition: ToolDefinition) => {
            registered.push(definition.name);
            return () => {
              registered.splice(registered.indexOf(definition.name), 1);
            };
          },
        },
        effect: (factory: () => () => void) => {
          disposers.push(factory());
          return () => undefined;
        },
      },
    };
  }

  test("registers the tools once and tears them down on dispose", () => {
    const fake = fakeContext();
    const subsystem = installDocumentSubsystem(fake.ctx as never, {
      config: {},
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      register: (definition) => {
        fake.registered.push(definition.name);
        return () => {
          fake.registered.splice(fake.registered.indexOf(definition.name), 1);
        };
      },
      seams: { pandoc: { versionProbe: async () => "test" } },
    });
    expect(fake.registered).toEqual([...DOCUMENT_TOOL_NAMES]);
    expect(subsystem?.toolNames).toEqual([...DOCUMENT_TOOL_NAMES]);
    subsystem?.dispose();
    expect(fake.registered).toEqual([]);
  });

  test("stays absent when the subsystem is disabled", () => {
    const fake = fakeContext();
    const subsystem = installDocumentSubsystem(fake.ctx as never, {
      config: { enabled: false },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      register: (definition) => {
        fake.registered.push(definition.name);
        return () => undefined;
      },
    });
    expect(subsystem).toBeUndefined();
    expect(fake.registered).toEqual([]);
  });
});
