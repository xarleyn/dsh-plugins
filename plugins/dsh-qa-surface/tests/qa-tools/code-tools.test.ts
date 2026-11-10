import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCodeSources } from "@yadsh/dsh-plugin-kit/code-sources";
import {
  codeScope,
  readCode,
  searchCode,
  type CodeFilesOptions,
} from "../../src/qa-tools/code-files.js";
import { createCodeSourcesTool } from "../../src/qa-tools/code-tools.js";
import {
  createDocsSearchTool,
  createDocsReadTool,
} from "../../src/qa-tools/docs-tools.js";
import { createCodeReadTool } from "../../src/qa-tools/code-tools.js";
import { readFileExtractor } from "../../src/provenance/extractors.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

let root: string;
const exec = () => ({
  agent: { session: { header: { cwd: join(root, "scratch") } } },
});
const toolExec = () => exec() as unknown as ToolRunContext;
function options(defaultSource = "stable"): CodeFilesOptions {
  return {
    codeSources: () =>
      resolveCodeSources({
        defaultSource,
        entries: [
          {
            id: "stable",
            label: "Release",
            path: join(root, "one"),
            docsVersion: "2.0",
          },
          {
            id: "preview",
            label: "Development",
            path: join(root, "two"),
            docsVersion: "2.1",
          },
        ],
      }),
    codeReadRoots: () => [join(root, "one"), join(root, "two")],
  };
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "qa-code-sources-"));
  for (const directory of [
    "scratch",
    "one",
    "two",
    "one/node_modules",
    "docs/module/2.0",
    "docs/module/2.1",
  ])
    await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, "one/file.ts"), "shared stable\nsecond line\n");
  await writeFile(join(root, "two/file.ts"), "shared preview\n");
  await writeFile(
    join(root, "one/node_modules/generated.ts"),
    "shared dependency",
  );
  await writeFile(join(root, "one/binary"), Buffer.from([0, 1, 2]));
  await writeFile(join(root, "one/oversized"), "x".repeat(1024 * 1024 + 1));
  await writeFile(join(root, "one/long-line"), "x".repeat(40 * 1024));
  await writeFile(
    join(root, "docs/module/2.0/guide.md"),
    "source edition stable",
  );
  await writeFile(
    join(root, "docs/module/2.1/guide.md"),
    "source edition preview",
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("source-aware code and documentation tools", () => {
  it("never mixes same-path files from different sources", async () => {
    const stable = await codeScope(options(), exec());
    const preview = await codeScope(options(), exec(), "preview");
    expect(await readCode(stable, { path: "file.ts", lines: 1 })).toMatchObject(
      { source: "stable", text: "shared stable", truncated: true },
    );
    expect(await searchCode(stable, { query: "shared" })).toMatchObject({
      source: "stable",
      hits: [expect.objectContaining({ text: "shared stable" })],
    });
    expect(await searchCode(preview, { query: "shared" })).toMatchObject({
      source: "preview",
      hits: [expect.objectContaining({ text: "shared preview" })],
    });
  });
  it("fails closed for missing/default ambiguity and access grants", async () => {
    await expect(codeScope(options(""), exec())).rejects.toThrow(/Several/u);
    await expect(codeScope(options(), exec(), "missing")).rejects.toThrow(
      /Unknown/u,
    );
    await expect(
      codeScope({ ...options(), codeReadRoots: () => [] }, exec()),
    ).rejects.toThrow(/outside/u);
    await expect(codeScope(options(), {})).rejects.toThrow(/session/u);
    await expect(
      codeScope(
        {
          ...options(),
          codeSources: () =>
            resolveCodeSources({
              defaultSource: "missing",
              entries: [
                {
                  id: "missing",
                  label: "Missing",
                  path: join(root, "missing"),
                },
              ],
            }),
        },
        exec(),
      ),
    ).rejects.toThrow(/unavailable/u);
  });
  it("reports only session-readable entries in discovery availability", async () => {
    const tool = createCodeSourcesTool({
      ...options(),
      codeReadRoots: () => [join(root, "one")],
    });
    expect(await tool.execute({}, toolExec())).toMatchObject({
      entries: [
        expect.objectContaining({ readable: true }),
        expect.objectContaining({ readable: false }),
      ],
    });
  });
  it("rejects traversal, binary and oversized files; bounds long lines", async () => {
    const scope = await codeScope(options(), exec());
    await expect(readCode(scope, { path: "../two/file.ts" })).rejects.toThrow(
      /traversal/u,
    );
    await expect(readCode(scope, { path: "binary" })).rejects.toThrow(
      /binary/u,
    );
    await expect(readCode(scope, { path: "oversized" })).rejects.toThrow(
      /limit/u,
    );
    expect(await readCode(scope, { path: "long-line" })).toMatchObject({
      text: "",
      truncated: true,
    });
    expect(await searchCode(scope, { query: "line", limit: 1 })).toMatchObject({
      hits: [expect.objectContaining({ line: 2 })],
    });
  });
  it("refuses directory links into another source", async () => {
    await symlink(
      join(root, "two"),
      join(root, "one/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const scope = await codeScope(options(), exec());
    await expect(readCode(scope, { path: "linked/file.ts" })).rejects.toThrow(
      /links/u,
    );
    expect((await searchCode(scope, { query: "preview" })).hits).toEqual([]);
  });
  it("uses source-to-docs mapping, with explicit edition override preserved", async () => {
    const tool = createDocsSearchTool({
      root: join(root, "docs"),
      ...options(),
    });
    expect(await tool.execute({ query: "edition" }, toolExec())).toMatchObject({
      source: "stable",
      version: "2.0",
      hits: [expect.objectContaining({ text: "source edition stable" })],
    });
    expect(
      await tool.execute({ query: "edition", source: "preview" }, toolExec()),
    ).toMatchObject({
      source: "preview",
      version: "2.1",
      hits: [expect.objectContaining({ text: "source edition preview" })],
    });
    expect(
      await tool.execute({ query: "edition", version: "2.1" }, toolExec()),
    ).toMatchObject({ version: "2.1" });
    await expect(
      tool.execute(
        { query: "edition", source: "stable", version: "2.1" },
        toolExec(),
      ),
    ).rejects.toThrow(/different/u);
    const reader = createDocsReadTool({
      root: join(root, "docs"),
      ...options(),
    });
    expect(
      await reader.execute(
        { path: "module/2.1/guide.md", source: "preview" },
        toolExec(),
      ),
    ).toMatchObject({ source: "preview" });
    await expect(
      reader.execute(
        { path: "module/2.1/guide.md", source: "stable" },
        toolExec(),
      ),
    ).rejects.toThrow(/edition/u);
  });
  it("retains the source identity and actual file address in provenance", async () => {
    const tool = createCodeReadTool(options());
    const result = await tool.execute(
      { source: "preview", path: "file.ts" },
      toolExec(),
    );
    const presentation = tool.output!.presentationMeta!(
      { source: "preview", path: "file.ts" },
      result as never,
    );
    const sources = readFileExtractor.extract({
      toolName: "code_read",
      args: { path: "file.ts" },
      result,
      presentation,
      origin: {
        sessionId: "test-session",
        turn: 1,
        toolName: "code_read",
        role: "parent",
      },
      workspaceRoot: join(root, "scratch"),
    });
    expect(sources).toMatchObject([
      { title: "[preview] file.ts", metadata: { codeSource: "preview" } },
    ]);
  });
  it("validates source configuration through the QA resolver", () => {
    expect(
      resolveConfig({ codeSources: options().codeSources?.() }).codeSources
        .defaultSource,
    ).toBe("stable");
    expect(() =>
      resolveConfig({ codeSources: { defaultSource: "missing" } }),
    ).toThrow(/defaultSource/u);
  });
});
