import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCodeSources } from "@yadsh/dsh-plugin-kit/code-sources";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";
import { resolveGitReadonlyConfig } from "../src/config.js";
import {
  createGitContextTool,
  type GitContextResult,
} from "../src/tools/context.js";
import { createGitHistoryTool } from "../src/tools/history.js";
import { createGitShowTool } from "../src/tools/show.js";
import { createGitBlameTool } from "../src/tools/blame.js";
import { createGitSourcesTool } from "../src/tools/sources.js";
import { createTempRepo, makeExec, type TempRepo } from "./fixtures/git.js";

let stable: TempRepo, preview: TempRepo, cwd: string;
beforeAll(async () => {
  stable = await createTempRepo();
  preview = await createTempRepo();
  cwd = await mkdtemp(join(tmpdir(), "dsh-source-session-"));
  await stable.commit("file.txt", "stable content\n", "stable change");
  await preview.commit("file.txt", "preview content\n", "preview change");
});
afterAll(async () => {
  await stable.dispose();
  await preview.dispose();
  await rm(cwd, { recursive: true, force: true });
});

function deps(roots = [stable.dir, preview.dir]) {
  return {
    config: resolveGitReadonlyConfig({ repositoryRoots: roots }),
    logger: silentPluginLogger(),
    codeSources: () =>
      resolveCodeSources({
        defaultSource: "stable",
        entries: [
          { id: "stable", label: "Release", path: stable.dir },
          { id: "preview", label: "Development", path: preview.dir },
        ],
      }),
  };
}

describe("Git named sources", () => {
  it("uses the calling session's saved source even with a local catalogue", async () => {
    const local = deps();
    const tool = createGitContextTool({
      ...local,
      config: { ...local.config, codeSources: local.codeSources() },
      selectedSource: () => "preview",
    });
    expect(await tool.execute({}, makeExec(cwd))).toMatchObject({
      source: "preview",
      subject: "preview change",
    });
    expect(
      await tool.execute({ source: "stable" }, makeExec(cwd)),
    ).toMatchObject({ source: "stable", subject: "stable change" });
  });
  it("supports named linked worktrees and refuses nested non-root source paths", async () => {
    const linked = join(cwd, "linked");
    await preview.run(["worktree", "add", "--detach", linked]);
    const local = {
      config: resolveGitReadonlyConfig({
        repositoryRoots: [cwd],
        codeSources: {
          entries: [{ id: "linked", label: "Linked checkout", path: linked }],
        },
      }),
      logger: silentPluginLogger(),
    };
    expect(
      await createGitContextTool(local).execute({}, makeExec(cwd)),
    ).toMatchObject({
      source: "linked",
      detached: true,
      subject: "preview change",
    });
    const nested = join(stable.dir, "nested");
    await mkdir(nested);
    const invalid = {
      config: resolveGitReadonlyConfig({
        repositoryRoots: [stable.dir],
        codeSources: {
          entries: [{ id: "nested", label: "Nested", path: nested }],
        },
      }),
      logger: silentPluginLogger(),
    };
    await expect(
      createGitContextTool(invalid).execute({}, makeExec(cwd)),
    ).rejects.toThrow(/work-tree root/u);
  });
  it("uses a shared default and explicitly selects the other tree in every provenance tool", async () => {
    const tools = deps();
    const exec = makeExec(cwd);
    expect(await createGitContextTool(tools).execute({}, exec)).toMatchObject({
      source: "stable",
      subject: "stable change",
    });
    const context = (await createGitContextTool(tools).execute(
      { source: "preview" },
      exec,
    )) as GitContextResult;
    expect(context).toMatchObject({
      source: "preview",
      subject: "preview change",
    });
    expect(
      await createGitHistoryTool(tools).execute({ source: "preview" }, exec),
    ).toMatchObject({
      source: "preview",
      commits: [expect.objectContaining({ subject: "preview change" })],
    });
    expect(
      await createGitShowTool(tools).execute(
        { source: "preview", oid: context.head },
        exec,
      ),
    ).toMatchObject({ source: "preview", subject: "preview change" });
    expect(
      await createGitBlameTool(tools).execute(
        { source: "preview", file: "file.txt" },
        exec,
      ),
    ).toMatchObject({
      source: "preview",
      lines: [expect.objectContaining({ content: "preview content" })],
    });
  });
  it("does not grant Git access by adding a catalogue entry", async () => {
    await expect(
      createGitContextTool(deps([stable.dir])).execute(
        { source: "preview" },
        makeExec(cwd),
      ),
    ).rejects.toThrow(/outside/u);
  });
  it("rejects unknown ids and conflicting selectors without falling back", async () => {
    const tool = createGitContextTool(deps());
    await expect(
      tool.execute({ source: "missing" }, makeExec(cwd)),
    ).rejects.toThrow(/Unknown/u);
    await expect(
      tool.execute(
        { source: "stable", repository: preview.dir },
        makeExec(cwd),
      ),
    ).rejects.toThrow(/not both/u);
  });
  it("retains explicit legacy repository paths even when a source default is set", async () => {
    expect(
      await createGitContextTool(deps()).execute(
        { repository: preview.dir },
        makeExec(cwd),
      ),
    ).toMatchObject({ subject: "preview change" });
  });
  it("discovers a catalogue provided after tool registration", async () => {
    let catalog = resolveCodeSources();
    const tool = createGitSourcesTool({
      ...deps(),
      codeSources: () => catalog,
    });
    expect(await tool.execute({}, makeExec(cwd))).toMatchObject({
      entries: [],
    });
    catalog = deps().codeSources();
    expect(await tool.execute({}, makeExec(cwd))).toMatchObject({
      defaultSource: "stable",
      entries: expect.arrayContaining([
        expect.objectContaining({ id: "preview" }),
      ]),
    });
  });
});
