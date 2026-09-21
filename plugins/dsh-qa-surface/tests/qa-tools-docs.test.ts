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
  QA_DOCS_SEARCH_BYTE_BUDGET,
  QA_DOCS_SEARCH_DEFAULT_LIMIT,
  QaDocsError,
  readDocumentation,
  searchDocumentation,
} from "../src/qa-tools/docs-tools.js";

const LONG = "x".repeat(400);

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

function render(tool: ToolDefinition, value: unknown): string {
  const output = tool.output as {
    render?: (
      args: unknown,
      value: unknown,
    ) => readonly { readonly type: string; readonly text: string }[];
  };
  const parts = output.render?.(undefined, value) ?? [];
  return parts.map((part) => part.text).join("\n");
}

async function rootOf(cwd: string) {
  return docsRootOf({ agent: { session: { header: { cwd } } } });
}

describe("docs_search", () => {
  it("reports a line hit with its path, module and version", async () => {
    const { workspace, cleanup } = fixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "token is issued",
    });
    const hit = result.hits.find(
      (candidate) => candidate.path === "docs/platform/3.8/auth.md",
    );
    expect(hit).toEqual({
      path: "docs/platform/3.8/auth.md",
      line: 3,
      text: "The token is issued per session.",
      module: "platform",
      version: "3.8",
    });
    expect(result.root).toBe("docs");
    cleanup();
  });

  it("matches case-insensitively and reports every matching line", async () => {
    const { workspace, cleanup } = fixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "TOKEN",
      path: "docs/platform/3.8",
    });
    expect(result.hits.map((hit) => hit.line)).toEqual([3, 4]);
    cleanup();
  });

  it("keeps only the requested version", async () => {
    const { workspace, cleanup } = fixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "token is issued",
      version: "3.8",
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/3.8/auth.md",
    ]);
    cleanup();
  });

  it("keeps only the requested module", async () => {
    const { workspace, cleanup } = fixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "tokens",
      module: "billing",
    });
    expect(result.hits).toEqual([
      {
        path: "docs/billing/tokens.md",
        line: 1,
        text: "Billing counts tokens monthly.",
        module: "billing",
      },
    ]);
    cleanup();
  });

  it("returns no hits for a phrase that is not there, and does not list the tree", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "greenhouse",
    });
    expect(result.hits).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(0);
    const text = render(tool, result);
    expect(text).toContain('No documentation under docs/ matches "greenhouse"');
    expect(text).not.toContain("auth.md");
    expect(text).not.toContain("tokens.md");
    cleanup();
  });

  it("honours the documented default limit when none is given", async () => {
    const { workspace, docs, cleanup } = fixture();
    const many = Array.from({ length: 20 }, (_, index) => `hit ${index}`);
    writeFileSync(path.join(docs, "default.md"), `${many.join("\n")}\n`);
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "hit",
    });
    expect(result.hits).toHaveLength(QA_DOCS_SEARCH_DEFAULT_LIMIT);
    expect(result.truncated).toBe(true);
    cleanup();
  });

  it("stops at the limit and says the result is truncated", async () => {
    const { workspace, docs, cleanup } = fixture();
    const many = Array.from({ length: 10 }, (_, index) => `hit ${index}`);
    writeFileSync(path.join(docs, "many.md"), `${many.join("\n")}\n`);
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "hit",
      limit: 3,
    });
    expect(result.hits).toHaveLength(3);
    expect(result.truncated).toBe(true);
    cleanup();
  });

  it("stops at the byte budget even when the limit is high", async () => {
    const { workspace, docs, cleanup } = fixture();
    const many = Array.from(
      { length: 40 },
      (_, index) => `needle ${index} ${LONG}`,
    );
    writeFileSync(path.join(docs, "long.md"), `${many.join("\n")}\n`);
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "needle",
      limit: 40,
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.length).toBeLessThan(40);
    expect(result.truncated).toBe(true);
    const rendered = Buffer.byteLength(
      render(createDocsSearchTool(), result),
      "utf8",
    );
    expect(rendered).toBeLessThan(QA_DOCS_SEARCH_BYTE_BUDGET + 1_000);
    cleanup();
  });

  it("skips symbolic links instead of following them out of the tree", async () => {
    const { workspace, docs, outside, cleanup } = fixture();
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
    if (!linked) {
      cleanup();
      return;
    }
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "in the secret",
    });
    expect(result.hits).toEqual([]);
    expect(result.skipped).toBeGreaterThan(0);
    cleanup();
  });

  it("refuses a scope path outside the documentation tree", async () => {
    const { workspace, cleanup } = fixture();
    const root = await rootOf(workspace);
    for (const target of ["../outside", "../outside/secret.md"]) {
      const error = await refusal(
        searchDocumentation(root, { query: "token", path: target }),
      );
      expect(error.code).toBe("outside-docs");
    }
    const absolute = await refusal(
      searchDocumentation(root, {
        query: "token",
        path: path.join(workspace, "docs"),
      }),
    );
    expect(absolute.code).toBe("outside-docs");
    cleanup();
  });

  it("refuses a scope path that does not exist instead of reporting no matches", async () => {
    const { workspace, cleanup } = fixture();
    const error = await refusal(
      searchDocumentation(await rootOf(workspace), {
        query: "token",
        path: "platform/9.9",
      }),
    );
    expect(error.code).toBe("not-found");
    cleanup();
  });

  it("refuses an empty query", async () => {
    const { workspace, cleanup } = fixture();
    const error = await refusal(
      searchDocumentation(await rootOf(workspace), { query: "  " }),
    );
    expect(error.code).toBe("invalid-request");
    cleanup();
  });

  it("refuses a binary file instead of returning its bytes", async () => {
    const { workspace, cleanup } = fixture();
    const error = await refusal(
      searchDocumentation(await rootOf(workspace), {
        query: "binary",
        path: "binary.md",
      }),
    );
    expect(error.code).toBe("not-text");
    cleanup();
  });

  it("refuses a workspace without a documentation tree, and one without a root", async () => {
    const { workspace, cleanup } = fixture();
    const empty = path.join(workspace, "..", "empty-ws");
    mkdirSync(empty, { recursive: true });
    const missing = await refusal(rootOf(empty));
    expect(missing.code).toBe("docs-unavailable");
    expect(missing.message).toContain("docs/");
    const noCwd = await refusal(
      docsRootOf({ agent: { session: { header: {} } } }),
    );
    expect(noCwd.code).toBe("workspace-unavailable");
    const noAgent = await refusal(docsRootOf({}));
    expect(noAgent.code).toBe("workspace-unavailable");
    cleanup();
  });

  it("names the documentation as what it searches, not memory", () => {
    const description = createDocsSearchTool().description;
    expect(description).toContain("docs/");
    expect(description).toContain("not memory");
  });

  it("runs from a real execution record and renders its hits", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool();
    const value = (await tool.execute(
      { query: "token is issued", version: "4.0" },
      { agent: agentWithCwd(workspace) } as never,
    )) as unknown;
    expect(render(tool, value)).toContain("docs/platform/4.0/auth.md:3");
    cleanup();
  });
});

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
    expect(docsIdentityOf("billing/tokens.md")).toEqual({ module: "billing" });
    expect(docsIdentityOf("readme.md")).toEqual({});
    expect(docsIdentityOf("3.8/a.md")).toEqual({ version: "3.8" });
  });
});
