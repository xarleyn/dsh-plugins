import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
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
} from "../../src/qa-tools/docs-tools.js";
import type { QaDocsSearchResult } from "../../src/qa-tools/docs-tools.js";

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

  it("reads a corpus the deployment publishes outside every chat workspace", async () => {
    // The per-user layout puts the chat's cwd in a per-account directory, so a
    // corpus published once is unreachable to these tools unless the deployment
    // names it. Naming it must not change what the tools report or how they
    // fence: same `docs/…` paths, same refusal to leave the tree.
    const { workspace, cleanup } = fixture();
    const corpus = workspace; // any real tree with `docs/` in it
    const root = await docsRootOf({}, { root: path.join(corpus, "docs") });
    expect(root.docs).toBe(realpathSync(path.join(corpus, "docs")));
    // The parent takes the part the chat's workspace plays per-chat.
    expect(root.workspace).toBe(realpathSync(corpus));

    const elsewhere = await docsRootOf(
      { agent: { session: { header: { cwd: path.join(corpus, "..") } } } },
      { root: path.join(corpus, "docs") },
    );
    const result = await searchDocumentation(elsewhere, {
      query: "token is issued",
    });
    expect(result.hits[0]?.path).toBe("docs/platform/3.8/auth.md");
    // The fence is unchanged: a path that leaves the configured tree is
    // refused exactly as it is refused in the per-chat layout.
    const read = createDocsReadTool({ root: path.join(corpus, "docs") });
    const escape = await refusal(
      read.execute({ path: "../outside/secret.md" }, {} as never),
    );
    expect(escape.code).toBe("outside-docs");
    cleanup();
  });

  it("keeps the docs/ public path when the configured root has another basename", async () => {
    const { workspace, cleanup } = fixture();
    const published = path.join(workspace, "published-corpus");
    mkdirSync(path.join(published, "platform", "V2"), { recursive: true });
    writeFileSync(
      path.join(published, "platform", "V2", "auth.md"),
      "The configured corpus is reachable.\n",
    );
    const root = await docsRootOf({}, { root: published });

    const result = await searchDocumentation(root, {
      query: "configured corpus",
      path: "docs/platform/V2",
      version: "v2",
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/V2/auth.md",
    ]);
    cleanup();
  });

  it("refuses a configured root that is not there, and one that is not a path", async () => {
    const { workspace, cleanup } = fixture();
    const missing = await refusal(
      docsRootOf({}, { root: path.join(workspace, "no-such-corpus") }),
    );
    expect(missing.code).toBe("docs-unavailable");
    expect(missing.message).toContain("no-such-corpus");

    const relative = await refusal(docsRootOf({}, { root: "docs" }));
    expect(relative.code).toBe("docs-unavailable");

    const file = await refusal(
      docsRootOf(
        {},
        { root: path.join(workspace, "docs", "platform", "3.8", "auth.md") },
      ),
    );
    expect(file.code).toBe("docs-unavailable");
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

  it("answers a filtered search with facets its own output schema declares", async () => {
    // A filtered result tags itself with the facets it ran under, and the
    // registry refuses a property the schema does not declare: an undeclared
    // facet turns the one call the filters exist for into "returned invalid
    // output", with the search already done and its answer thrown away.
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool();
    const value = (await tool.execute(
      { query: "token is issued", version: "3.8", module: "platform" },
      { agent: agentWithCwd(workspace) } as never,
    )) as unknown;
    expect(validateJsonSchemaValue(tool.output.schema, value as never)).toEqual(
      [],
    );
    expect(value).toMatchObject({ version: "3.8", module: "platform" });
    // The report says which edition it answered from, the same way a hit does.
    expect(render(tool, value)).toContain("(version 3.8, module platform)");
    cleanup();
  });
});

/**
 * A corpus the way a stand publishes one: documented modules beside the
 * corpus's own working material — an asset tree of pictures and the inventories
 * that name every document there is — which is where a bounded search used to
 * spend itself before it reached a single document.
 */
function corpusFixture() {
  const base = mkdtempSync(path.join(tmpdir(), "qa-corpus-"));
  const workspace = path.join(base, "ws");
  const docs = path.join(workspace, "docs");
  mkdirSync(path.join(docs, "platform", "3.8"), { recursive: true });
  mkdirSync(path.join(docs, "_meta"), { recursive: true });
  mkdirSync(path.join(docs, "_assets", "00"), { recursive: true });
  writeFileSync(
    path.join(docs, "platform", "3.8", "auth.md"),
    "# Auth\n\nThe ftp client is configured per stand.\n",
  );
  writeFileSync(
    path.join(docs, "_meta", "INVENTORY.md"),
    [
      "ftp client inventory",
      "- v38_platform_auth — ftp client",
      "- v38_platform_auth — ftp client",
      "- v38_platform_auth — ftp client",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(docs, "index.md"), "The corpus index.\n");
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(
      path.join(docs, "_assets", "00", `img-${index}.png`),
      "\u0089PNG\r\n\u001a\n",
    );
  }
  return {
    workspace,
    docs,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe("docs_search over a published corpus", () => {
  it("answers from a documented module before the corpus's own inventory", async () => {
    // Name order put `_meta` first (`_` sorts before letters) and its inventory
    // matches nearly every product term, so the one hit a caller asked for was
    // an inventory line about the document rather than the document.
    const { workspace, cleanup } = corpusFixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "ftp client",
      limit: 1,
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/3.8/auth.md",
    ]);
    cleanup();
  });

  it("counts pictures as skipped material, never as documents read", async () => {
    const { workspace, cleanup } = corpusFixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "greenhouse",
    });
    expect(result.hits).toEqual([]);
    // The three text files of the corpus: two documents and the inventory.
    expect(result.filesScanned).toBe(3);
    expect(result.skipped).toBe(5);
    cleanup();
  });

  it("still searches the corpus's own directories, after the documents", async () => {
    const { workspace, cleanup } = corpusFixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "v38_platform_auth",
    });
    expect(result.hits).not.toEqual([]);
    expect(result.hits[0]?.path).toBe("docs/_meta/INVENTORY.md");
    cleanup();
  });

  it("filters before the walk, so an excluded edition is not counted or read", async () => {
    const { workspace, cleanup } = corpusFixture();
    const result = await searchDocumentation(await rootOf(workspace), {
      query: "ftp client",
      version: "4.0",
    });
    expect(result.hits).toEqual([]);
    // Nothing in the corpus carries 4.0: no document was read at all.
    expect(result.filesScanned).toBe(0);
    cleanup();
  });
});

describe("docs_search: the deployment's default version", () => {
  it("reads the current default version instead of a boot-time snapshot", async () => {
    const { workspace, cleanup } = fixture();
    let defaultVersion = "3.8";
    const tool = createDocsSearchTool({
      get defaultVersion() {
        return defaultVersion;
      },
    });
    const execution = { agent: agentWithCwd(workspace) } as never;

    const first = (await tool.execute(
      { query: "token is issued" },
      execution,
    )) as unknown as QaDocsSearchResult;
    defaultVersion = "4.0";
    const second = (await tool.execute(
      { query: "token is issued" },
      execution,
    )) as unknown as QaDocsSearchResult;

    expect(first.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/3.8/auth.md",
    ]);
    expect(second.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/4.0/auth.md",
    ]);
    cleanup();
  });

  it("keeps a search without version and without path inside the default edition", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool({ defaultVersion: "3.8" });
    const args = { query: "token is issued" };
    const value = (await tool.execute(args, {
      agent: agentWithCwd(workspace),
    } as never)) as unknown;
    const result = value as QaDocsSearchResult;
    expect(result.hits.map((hit) => hit.path)).toEqual([
      "docs/platform/3.8/auth.md",
    ]);
    // The answer says the stand narrowed it, so a model that did not ask for
    // 3.8 reads the result as "this edition", not as "the whole corpus".
    expect(render(tool, value, args)).toContain(
      "(version 3.8, the stand's default)",
    );
    expect(validateJsonSchemaValue(tool.output.schema, value as never)).toEqual(
      [],
    );
    cleanup();
  });

  it("lets the call's own version win, including another edition", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool({ defaultVersion: "3.8" });
    const args = { query: "token is issued", version: "4.0" };
    const value = (await tool.execute(args, {
      agent: agentWithCwd(workspace),
    } as never)) as unknown;
    expect((value as QaDocsSearchResult).hits.map((hit) => hit.path)).toEqual([
      "docs/platform/4.0/auth.md",
    ]);
    // The caller named the edition, so the report does not attribute it to the
    // stand's default.
    expect(render(tool, value, args)).not.toContain("the stand's default");
    cleanup();
  });

  it("lets an explicit path win, so a scoped search of another edition still works", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool({ defaultVersion: "3.8" });
    const value = (await tool.execute(
      { query: "token is issued", path: "platform/4.0" },
      { agent: agentWithCwd(workspace) } as never,
    )) as unknown;
    expect((value as QaDocsSearchResult).hits.map((hit) => hit.path)).toEqual([
      "docs/platform/4.0/auth.md",
    ]);
    expect(
      render(tool, value, { query: "token is issued", path: "platform/4.0" }),
    ).not.toContain("the stand's default");
    cleanup();
  });

  it("searches every edition when the deployment has no default", async () => {
    const { workspace, cleanup } = fixture();
    const tool = createDocsSearchTool();
    const value = (await tool.execute({ query: "token is issued" }, {
      agent: agentWithCwd(workspace),
    } as never)) as unknown;
    expect((value as QaDocsSearchResult).hits.map((hit) => hit.path)).toEqual([
      "docs/platform/3.8/auth.md",
      "docs/platform/4.0/auth.md",
    ]);
    cleanup();
  });

  it("tells the model which edition a search it did not scope stays inside", () => {
    expect(
      createDocsSearchTool({ defaultVersion: "3.8" }).description,
    ).toContain("This stand documents version 3.8 by default");
    expect(createDocsSearchTool().description).not.toContain("by default");
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
    expect(docsIdentityOf("platform/V2/a.md")).toEqual({
      module: "platform",
      version: "V2",
    });
    expect(docsIdentityOf("billing/tokens.md")).toEqual({ module: "billing" });
    expect(docsIdentityOf("readme.md")).toEqual({});
    expect(docsIdentityOf("3.8/a.md")).toEqual({ version: "3.8" });
  });
});
