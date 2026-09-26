import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  createDocsReadTool,
  createDocsSearchTool,
  docsIdentityOf,
  docsRootOf,
  QA_DOCS_READ_DEFAULT_LINES,
  QA_DOCS_READ_MAX_LINES,
  QaDocsError,
  readDocumentation,
} from "../../src/qa-tools/docs-tools.js";

/**
 * A chat workspace with a documentation tree in it: two editions of one module
 * (`platform/3.8`, `platform/4.0`), a second module without a version
 * (`billing`), a file at the root, a binary file, and a directory outside the
 * workspace that a link would try to reach.
 */
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "qa-docs-"));
  const workspace = path.join(base, "ws");
  const docs = path.join(workspace, "docs");
  const outside = path.join(base, "outside");
  mkdirSync(path.join(docs, "platform", "3.8"), { recursive: true });
  mkdirSync(path.join(docs, "platform", "4.0"), { recursive: true });
  mkdirSync(path.join(docs, "billing"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(
    path.join(docs, "platform", "3.8", "auth.md"),
    "# Auth\n\nThe token is issued per session.\nA second line about tokens.\n",
  );
  writeFileSync(
    path.join(docs, "platform", "4.0", "auth.md"),
    "# Auth 4.0\n\nThe token is issued per session.\n",
  );
  writeFileSync(
    path.join(docs, "billing", "tokens.md"),
    "Billing counts tokens monthly.\n",
  );
  writeFileSync(path.join(docs, "readme.md"), "Documentation root notes.\n");
  writeFileSync(path.join(docs, "binary.md"), "text\u0000binary\n");
  writeFileSync(
    path.join(outside, "secret.md"),
    "The token is issued per session in the secret.\n",
  );
  return {
    workspace,
    docs,
    outside,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function agentWithCwd(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent;
}

/** The refusal one call ended with. */
async function refusal(pending: Promise<unknown>): Promise<QaDocsError> {
  const error = (await pending.catch((caught: unknown) => caught)) as unknown;
  expect(error).toBeInstanceOf(QaDocsError);
  return error as QaDocsError;
}

/**
 * The rendered report of one call. The arguments are the model's, and a report
 * that says where a facet came from reads them: "the stand's default" is only
 * true of a search that did not name the version itself.
 */
function render(tool: ToolDefinition, value: unknown, args?: unknown): string {
  const output = tool.output as {
    render?: (
      args: unknown,
      value: unknown,
    ) => readonly { readonly type: string; readonly text: string }[];
  };
  const parts = output.render?.(args, value) ?? [];
  return parts.map((part) => part.text).join("\n");
}

async function rootOf(cwd: string) {
  return docsRootOf({ agent: { session: { header: { cwd } } } });
}

describe("docs_read", () => {
  it("reads a window and tags it with module and version", async () => {
    const { workspace, cleanup } = fixture();
    const result = await readDocumentation(await rootOf(workspace), {
      path: "docs/platform/3.8/auth.md",
      from: 3,
      lines: 2,
    });
    expect(result).toMatchObject({
      path: "docs/platform/3.8/auth.md",
      module: "platform",
      version: "3.8",
      from: 3,
      to: 4,
      truncated: true,
    });
    expect(result.text).toBe(
      "The token is issued per session.\nA second line about tokens.",
    );
    cleanup();
  });

  it("accepts both the workspace-relative and the docs-relative spelling", async () => {
    const { workspace, cleanup } = fixture();
    const root = await rootOf(workspace);
    const workspaceRelative = await readDocumentation(root, {
      path: "docs/billing/tokens.md",
    });
    const docsRelative = await readDocumentation(root, {
      path: "billing/tokens.md",
    });
    expect(workspaceRelative).toEqual(docsRelative);
    cleanup();
  });

  it("accepts an absolute file path inside the resolved documentation root", async () => {
    const { workspace, docs, cleanup } = fixture();
    const result = await readDocumentation(await rootOf(workspace), {
      path: path.join(docs, "platform", "3.8", "auth.md"),
      from: 3,
      lines: 1,
    });
    expect(result).toMatchObject({
      path: "docs/platform/3.8/auth.md",
      module: "platform",
      version: "3.8",
      text: "The token is issued per session.",
    });
    cleanup();
  });

  it("offers the model the same path spellings docs_search offers", () => {
    // Both tools resolve through one fence, so both have to say so: a reader
    // of docs_read alone would otherwise believe an absolute path is search-only.
    const spelled = (tool: ToolDefinition) =>
      (
        tool.parameters as unknown as {
          properties: Record<string, { readonly description?: string }>;
        }
      ).properties["path"]?.description;
    expect(spelled(createDocsReadTool())).toContain("absolute path");
    expect(spelled(createDocsSearchTool())).toContain("absolute path");
  });

  it("refuses an absolute file path outside the documentation tree", async () => {
    // docs_read shares docs_search's fence: an absolute path is only a
    // spelling, never a way out of the tree the stand publishes.
    const { workspace, outside, cleanup } = fixture();
    const error = await refusal(
      readDocumentation(await rootOf(workspace), {
        path: path.join(outside, "secret.md"),
      }),
    );
    expect(error.code).toBe("outside-docs");
    cleanup();
  });

  it("bounds the window and reports the rest of the file", async () => {
    const { workspace, docs, cleanup } = fixture();
    const lines = Array.from(
      { length: 900 },
      (_, index) => `line ${index + 1}`,
    );
    writeFileSync(path.join(docs, "big.md"), `${lines.join("\n")}\n`);
    const result = await readDocumentation(await rootOf(workspace), {
      path: "big.md",
      lines: 5_000,
    });
    expect(result.from).toBe(1);
    expect(result.to).toBe(QA_DOCS_READ_MAX_LINES);
    expect(result.totalLines).toBe(900);
    expect(result.truncated).toBe(true);
    expect(result.text.split("\n")).toHaveLength(QA_DOCS_READ_MAX_LINES);
    cleanup();
  });

  it("uses the documented default window when none is given", async () => {
    const { workspace, docs, cleanup } = fixture();
    const lines = Array.from(
      { length: 300 },
      (_, index) => `line ${index + 1}`,
    );
    writeFileSync(path.join(docs, "window.md"), `${lines.join("\n")}\n`);
    const result = await readDocumentation(await rootOf(workspace), {
      path: "window.md",
    });
    expect(result.from).toBe(1);
    expect(result.to).toBe(QA_DOCS_READ_DEFAULT_LINES);
    expect(result.totalLines).toBe(300);
    cleanup();
  });

  it("refuses a directory, a missing path and a binary file", async () => {
    const { workspace, cleanup } = fixture();
    const root = await rootOf(workspace);
    const directory = await refusal(
      readDocumentation(root, { path: "docs/platform" }),
    );
    expect(directory.code).toBe("not-a-file");
    const missing = await refusal(
      readDocumentation(root, { path: "docs/platform/3.8/absent.md" }),
    );
    expect(missing.code).toBe("not-found");
    const binary = await refusal(
      readDocumentation(root, { path: "docs/binary.md" }),
    );
    expect(binary.code).toBe("not-text");
    cleanup();
  });

  it("refuses a path outside the tree and a link that leaves it", async () => {
    const { workspace, docs, outside, cleanup } = fixture();
    const root = await rootOf(workspace);
    const outsidePath = await refusal(
      readDocumentation(root, { path: "../outside/secret.md" }),
    );
    expect(outsidePath.code).toBe("outside-docs");
    let linked = true;
    try {
      symlinkSync(
        path.join(outside, "secret.md"),
        path.join(docs, "alias.md"),
        "file",
      );
    } catch {
      linked = false; // the platform denies symlink creation; skip cleanly
    }
    if (linked) {
      const escape = await refusal(
        readDocumentation(root, { path: "alias.md" }),
      );
      expect(escape.code).toBe("symlink-escape");
    }
    cleanup();
  });

  it("refuses a documentation root that is not a real directory", async () => {
    const { workspace, docs, cleanup } = fixture();
    rmSync(docs, { recursive: true, force: true });
    writeFileSync(docs, "not a directory");
    const error = await refusal(rootOf(workspace));
    expect(error.code).toBe("docs-unavailable");
    cleanup();
  });

  it("runs from a real execution record", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsReadTool();
    const value = (await tool.execute({ path: "docs/readme.md" }, {
      agent: agentWithCwd(workspace),
    } as never)) as unknown;
    expect(render(tool, value)).toContain("Documentation root notes.");
    cleanup();
  });
});

describe("docsIdentityOf", () => {
  it("reads the module before the version, and tolerates paths without one", () => {
    expect(docsIdentityOf(path.join("platform", "3.8", "a.md"))).toEqual({
      module: "platform",
      version: "3.8",
    });
    expect(docsIdentityOf("platform/v2.0/a/b.md")).toEqual({
      module: "platform",
      version: "v2.0",
    });
    expect(docsIdentityOf("platform/V2/a.md")).toEqual({
      module: "platform",
      version: "V2",
    });
    expect(docsIdentityOf("billing/tokens.md")).toEqual({ module: "billing" });
    expect(docsIdentityOf("readme.md")).toEqual({});
    expect(docsIdentityOf("3.8/a.md")).toEqual({ version: "3.8" });
  });
});
