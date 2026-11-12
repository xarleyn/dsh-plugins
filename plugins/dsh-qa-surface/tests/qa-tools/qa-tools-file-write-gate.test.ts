import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installQaFileWriteGate } from "../../src/qa-tools/file-write-gate.js";
import { QaSessionOwnership } from "../../src/session-ownership.js";
import {
  resolveFileWritePolicy,
  type QaFileWritePolicy,
} from "../../src/shared/file-write-policy.js";

describe("file write policy through the native tool pipeline", () => {
  let ctx: Context;
  let directory: string;
  let root: Agent;
  let child: Agent;
  let outsider: Agent;
  let ownership: QaSessionOwnership;
  let policy: QaFileWritePolicy;
  let dispose: () => void;
  let dispatched: number;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "qa-write-policy-"));
    ctx = new Context();
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime);
    ownership = new QaSessionOwnership((id) => id === "root");
    policy = resolveFileWritePolicy({
      message: "Use spreadsheet tools; no script runtime is available.",
    });
    dispatched = 0;
    const agent = (id: string, parentSession?: string) =>
      ({
        session: {
          id,
          header: { cwd: directory, parentSession, origin: "subagent" },
        },
      }) as unknown as Agent;
    root = agent("root");
    child = agent("child", "root");
    outsider = agent("unrelated");
    await ctx.plugin(
      Object.assign(
        (inner: Context) => {
          for (const current of [root, child, outsider]) {
            (current as unknown as { ctx: Context }).ctx = createScope(
              inner,
              current,
            ).ctx;
          }
        },
        { inject: ["tools"] },
      ),
    );
    dispose = installQaFileWriteGate(ctx, ownership, () => policy);
    ctx.emit("session/created", child.session);
    for (const name of ["write", "edit", "str_replace_editor", "read"]) {
      ctx.tools.register({
        name,
        description: "Synthetic file operation",
        parameters: { type: "object", properties: {} },
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: String(value) }],
        },
        execute: async (raw) => {
          dispatched++;
          const args = raw as {
            file_path?: string;
            path?: string;
            command?: string;
          };
          const file = path.resolve(directory, args.file_path ?? args.path!);
          if (name === "read" || args.command === "view")
            return readFile(file, "utf8");
          await writeFile(file, "modified");
          return "written";
        },
      });
    }
  });

  afterEach(async () => {
    dispose();
    ownership.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  function call(name: string, args: unknown, agent = root) {
    return ctx.tools.execute({
      callId: "file-call" as never,
      name,
      arguments: args,
      agent,
      signal: new AbortController().signal,
    });
  }

  it.each([
    "report.py",
    "REPORT.PY",
    "subdir\\report.Py",
    "report.py.",
    "report.py ",
    "report.py:stream",
  ])("rejects creation of %s before dispatch", async (file_path) => {
    const result = await call("write", { file_path, content: "script" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(policy.message);
    expect(dispatched).toBe(0);
    await expect(access(path.resolve(directory, file_path))).rejects.toThrow();
  });

  it.each(["write", "edit"])(
    "preserves an existing blocked file for %s",
    async (name) => {
      const file = path.join(directory, "existing.py");
      await writeFile(file, "original");
      expect((await call(name, { file_path: file })).isError).toBe(true);
      expect(await readFile(file, "utf8")).toBe("original");
      expect(dispatched).toBe(0);
    },
  );

  it.each(["create", "str_replace", "insert", "undo_edit"])(
    "blocks editor mutation %s",
    async (command) => {
      expect(
        (await call("str_replace_editor", { path: "test.pyw", command }))
          .isError,
      ).toBe(true);
      expect(dispatched).toBe(0);
    },
  );

  it("permits reading blocked types and writing ordinary documents", async () => {
    await writeFile(path.join(directory, "test.py"), "original");
    expect((await call("read", { file_path: "test.py" })).isError).toBe(false);
    expect(
      (await call("str_replace_editor", { path: "test.py", command: "view" }))
        .isError,
    ).toBe(false);
    expect((await call("write", { file_path: "report.md" })).isError).toBe(
      false,
    );
    expect(await readFile(path.join(directory, "report.md"), "utf8")).toBe(
      "modified",
    );
  });

  it("covers delegated children while leaving unrelated sessions alone", async () => {
    expect(
      (await call("write", { file_path: "child.py" }, child)).isError,
    ).toBe(true);
    expect(
      (await call("write", { file_path: "other.py" }, outsider)).isError,
    ).toBe(false);
    expect(dispatched).toBe(1);
  });

  it("applies changed suffixes and messages to an existing agent immediately", async () => {
    policy = resolveFileWritePolicy({
      blockedExtensions: [".txt", "tar.gz"],
      message: "Use another file type.",
    });
    const denied = await call("write", { file_path: "archive.TAR.GZ" });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain(policy.message);
    expect((await call("write", { file_path: "allowed.py" })).isError).toBe(
      false,
    );
    policy = resolveFileWritePolicy({ blockedExtensions: [] });
    expect((await call("write", { file_path: "allowed.txt" })).isError).toBe(
      false,
    );
  });

  it("cannot be overridden by a pre-execute allow decision", async () => {
    ctx.on("tools/pre-execute", async () => ({ kind: "allow" }));
    expect((await call("write", { file_path: "blocked.py" })).isError).toBe(
      true,
    );
    expect(dispatched).toBe(0);
  });

  it("checks the canonical target behind an allowed symlink name", async (test) => {
    const target = path.join(directory, "target.py");
    const alias = path.join(directory, "alias.txt");
    await writeFile(target, "original");
    try {
      await symlink(target, alias, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      test.skip();
    }
    expect((await call("edit", { file_path: alias })).isError).toBe(true);
    expect(await readFile(target, "utf8")).toBe("original");
    expect(dispatched).toBe(0);
  });

  it("removes its restriction on disposal", async () => {
    dispose();
    expect(
      (await call("write", { file_path: "after-disposal.py" })).isError,
    ).toBe(false);
  });
});
