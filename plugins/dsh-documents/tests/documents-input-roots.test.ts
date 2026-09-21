/**
 * Extra readable input roots (§26.2).
 *
 * A deployment's read fence grants some sessions roots that sit outside every
 * workspace — the mounted attachment store is the one that exists today, and
 * the prompt hands the model the stored path of an upload. The pipeline has to
 * read exactly that file, and nothing else in the same tree: the store is
 * shared by every account, so a granted root may never become a directory to
 * walk.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { installDocumentSubsystem } from "../src/documents/index.js";
import {
  allowedInputRoots,
  resolveDocumentScope,
} from "../src/documents/orchestrator/scope.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { resolveInsideRoot } from "../src/documents/security/paths.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { docxBytes } from "./helpers/document-fixtures.js";

const config = resolveDocumentsConfig();

/** The session workspace: what the model may read without a grant. */
let workspace: string;
/** The mounted attachment store: outside every workspace, shared by users. */
let store: string;
/** A directory no test grants, standing in for the rest of the filesystem. */
let elsewhere: string;
/** The stored file an upload produced, addressed by its absolute path. */
let stored: string;

async function makeDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

beforeEach(async () => {
  workspace = await makeDir("qa-docs-input-roots-ws-");
  store = await makeDir("qa-docs-input-roots-store-");
  elsewhere = await makeDir("qa-docs-input-roots-other-");
  const dir = path.join(store, "files", "2f9c1a");
  await mkdir(dir, { recursive: true });
  stored = path.join(dir, "report.docx");
  await writeFile(stored, docxBytes({ headings: ["Отчёт"] }));
  await writeFile(path.join(elsewhere, "report.docx"), docxBytes());
});

afterEach(async () => {
  for (const dir of [workspace, store, elsewhere]) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A directory symlink, or `undefined` where the platform refuses to make one. */
async function linkTo(
  target: string,
  name: string,
): Promise<string | undefined> {
  await symlink(target, name, "dir").catch(() => undefined);
  return (await lstat(name).catch(() => undefined)) === undefined
    ? undefined
    : name;
}

/** `document_inspect` is the read-only tool: no provider and no artifact. */
function inspectTool(
  source?: (sessionId?: string) => readonly string[],
): ToolDefinition {
  const definition = createDocumentTools({
    runtime: new DocumentRuntime({ config }),
    ...(source === undefined ? {} : { extraInputRoots: source }),
  }).find((entry) => entry.name === "document_inspect");
  if (definition === undefined)
    throw new Error("document_inspect is not registered");
  return definition;
}

function exec(sessionId = "session-1"): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: workspace, id: sessionId } } },
  } as unknown as ToolRunContext;
}

/** The grant a QA deployment makes: the mounted store, read-only. */
const storeGrant = (): readonly string[] => [store];

describe("a session with a granted input root", () => {
  test("reads the stored file its fence allows", async () => {
    const value = (await inspectTool(storeGrant).execute(
      { file: stored },
      exec(),
    )) as Record<string, unknown>;
    expect(value["format"]).toBe("docx");
    expect(value["filename"]).toBe("report.docx");
  });

  test("reads the same file when the grant is spelled as a symlink", async () => {
    const alias = await linkTo(store, path.join(workspace, "store-link"));
    if (alias === undefined) return;
    const value = (await inspectTool(() => [alias]).execute(
      { file: stored },
      exec(),
    )) as Record<string, unknown>;
    expect(value["format"]).toBe("docx");
  });
});

describe("a session without a grant", () => {
  test("refuses the stored file, naming the roots it does have", async () => {
    const refused = await inspectTool()
      .execute({ file: stored }, exec())
      .then(
        () => undefined,
        (error: Error) => error,
      );
    expect(refused).toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(refused?.message).toMatch(
      /session workspace or a configured document root/u,
    );
  });

  test("refuses a workspace file that does not exist", async () => {
    await expect(
      inspectTool(storeGrant).execute(
        { file: path.join(workspace, "missing.docx") },
        exec(),
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});

describe("what a granted root never opens", () => {
  test("refuses a path outside every granted root", async () => {
    await expect(
      inspectTool(storeGrant).execute(
        { file: path.join(elsewhere, "report.docx") },
        exec(),
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  test("refuses a symlink that leaves the granted root", async () => {
    const link = await linkTo(elsewhere, path.join(store, "escape"));
    if (link === undefined) return;
    const target = path.join(link, "report.docx");
    await expect(
      resolveInsideRoot(store, target, "file"),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    await expect(
      inspectTool(storeGrant).execute({ file: target }, exec()),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  test("refuses a directory, so the shared store cannot be walked", async () => {
    for (const directory of [store, path.join(store, "files")]) {
      await expect(
        inspectTool(storeGrant).execute({ file: directory }, exec()),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    }
  });
});

describe("resolving the grant", () => {
  test("canonicalizes it and drops blanks and duplicates", async () => {
    const scope = await resolveDocumentScope(config, {
      workspaceRoot: workspace,
      extraInputRoots: [
        "",
        "   ",
        workspace,
        path.join(workspace, "."),
        store,
        store,
      ],
    });
    expect(scope.extraInputRoots).toEqual([await realpath(store)]);
    expect(allowedInputRoots(config, scope)).toEqual([
      await realpath(workspace),
      path.join(await realpath(workspace), ".qa", "artifacts", "documents"),
      await realpath(store),
    ]);
  });

  test("leaves the configured roots ahead of the granted one", async () => {
    const shared = await makeDir("qa-docs-input-roots-shared-");
    const configured = resolveDocumentsConfig({
      storage: { allowedInputRoots: [shared] },
    });
    try {
      const scope = await resolveDocumentScope(configured, {
        workspaceRoot: workspace,
        extraInputRoots: [store],
      });
      const roots = allowedInputRoots(configured, scope);
      expect(roots).toContain(await realpath(shared));
      expect(roots.at(-1)).toBe(await realpath(store));
    } finally {
      await rm(shared, { recursive: true, force: true });
    }
  });

  test("reads a scope without a grant from its own workspace only", async () => {
    const scope = await resolveDocumentScope(config, {
      workspaceRoot: workspace,
    });
    expect(scope.extraInputRoots).toEqual([]);
  });
});

describe("installDocumentSubsystem", () => {
  function fakeContext(): Record<string, unknown> {
    return {
      tools: { register: () => () => undefined },
      effect: () => () => undefined,
    };
  }

  test("hands each session its own grant", async () => {
    const registered = new Map<string, ToolDefinition>();
    const subsystem = installDocumentSubsystem(fakeContext() as never, {
      config: {},
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      register: (definition) => {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
      extraInputRoots: (sessionId) =>
        sessionId === "session-1" ? [store] : [],
    });
    const definition = registered.get("document_inspect");
    if (definition === undefined)
      throw new Error("document_inspect is not registered");
    await expect(
      definition.execute({ file: stored }, exec("session-1")),
    ).resolves.toMatchObject({ format: "docx" });
    await expect(
      definition.execute({ file: stored }, exec("session-2")),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    subsystem?.dispose();
    expect(registered.size).toBe(0);
  });
});
