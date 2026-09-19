import {
  existsSync,
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
import {
  createFileDeleteTool,
  QaFileDeleteError,
} from "../src/qa-tools/file-delete.js";

/**
 * A workspace root with a sibling directory outside it, so escape attempts
 * have a real target to be refused against.
 */
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "qa-file-delete-"));
  const root = path.join(base, "ws");
  const outside = path.join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return {
    root,
    outside,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function agentWithCwd(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent;
}

/** Invoke the tool body exactly where the registry would. */
function run(
  tool: ReturnType<typeof createFileDeleteTool>,
  args: unknown,
  exec: unknown,
) {
  return tool.execute(args, exec as never) as Promise<{
    deleted: boolean;
    path: string;
  }>;
}

/** The refusal a rejected call ended with. */
async function refusal(pending: Promise<unknown>): Promise<QaFileDeleteError> {
  const error = (await pending.catch((caught: unknown) => caught)) as unknown;
  expect(error).toBeInstanceOf(QaFileDeleteError);
  return error as QaFileDeleteError;
}

describe("file_delete tool", () => {
  it("deletes a workspace-relative file and reports it relative", async () => {
    const { root, cleanup } = fixture();
    const file = path.join(root, "scratch.txt");
    writeFileSync(file, "data");
    const tool = createFileDeleteTool();
    await expect(
      run(tool, { path: "scratch.txt" }, { agent: agentWithCwd(root) }),
    ).resolves.toEqual({ deleted: true, path: "scratch.txt" });
    expect(existsSync(file)).toBe(false);
    cleanup();
  });

  it("deletes through a nested directory and normalizes separators", async () => {
    const { root, cleanup } = fixture();
    mkdirSync(path.join(root, "nested"));
    const file = path.join(root, "nested", "out.txt");
    writeFileSync(file, "data");
    const tool = createFileDeleteTool();
    await expect(
      run(tool, { path: "nested/out.txt" }, { agent: agentWithCwd(root) }),
    ).resolves.toEqual({ deleted: true, path: "nested/out.txt" });
    expect(existsSync(file)).toBe(false);
    cleanup();
  });

  it("accepts an absolute path inside the workspace and reports it relative", async () => {
    const { root, cleanup } = fixture();
    const file = path.join(root, "absolute.txt");
    writeFileSync(file, "data");
    const tool = createFileDeleteTool();
    await expect(
      run(tool, { path: file }, { agent: agentWithCwd(root) }),
    ).resolves.toEqual({ deleted: true, path: "absolute.txt" });
    cleanup();
  });

  it("refuses a ../ escape with the outside-workspace reason", async () => {
    const { root, outside, cleanup } = fixture();
    const victim = path.join(outside, "victim.txt");
    writeFileSync(victim, "keep me");
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(
        tool,
        { path: "../outside/victim.txt" },
        {
          agent: agentWithCwd(root),
        },
      ),
    );
    expect(error.code).toBe("outside-workspace");
    expect(existsSync(victim)).toBe(true);
    cleanup();
  });

  it("refuses an absolute path outside the workspace", async () => {
    const { root, outside, cleanup } = fixture();
    const victim = path.join(outside, "victim.txt");
    writeFileSync(victim, "keep me");
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(tool, { path: victim }, { agent: agentWithCwd(root) }),
    );
    expect(error.code).toBe("outside-workspace");
    expect(existsSync(victim)).toBe(true);
    cleanup();
  });

  it("refuses a directory with the not-a-file reason", async () => {
    const { root, cleanup } = fixture();
    mkdirSync(path.join(root, "a-directory"));
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(tool, { path: "a-directory" }, { agent: agentWithCwd(root) }),
    );
    expect(error.code).toBe("not-a-file");
    expect(existsSync(path.join(root, "a-directory"))).toBe(true);
    cleanup();
  });

  it("refuses a missing file with the not-found reason", async () => {
    const { root, cleanup } = fixture();
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(tool, { path: "absent.txt" }, { agent: agentWithCwd(root) }),
    );
    expect(error.code).toBe("not-found");
    cleanup();
  });

  it("refuses a symlinked file that points outside the workspace", async () => {
    const { root, outside, cleanup } = fixture();
    const victim = path.join(outside, "victim.txt");
    writeFileSync(victim, "keep me");
    const link = path.join(root, "alias.txt");
    let linked = true;
    try {
      symlinkSync(victim, link, "file");
    } catch {
      linked = false; // the platform denies symlink creation; skip cleanly
    }
    if (!linked) {
      cleanup();
      return;
    }
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(tool, { path: "alias.txt" }, { agent: agentWithCwd(root) }),
    );
    expect(error.code).toBe("symlink-escape");
    expect(existsSync(victim)).toBe(true);
    expect(existsSync(link)).toBe(true);
    cleanup();
  });

  it("refuses a path through a symlinked directory even when the target is missing", async () => {
    const { root, outside, cleanup } = fixture();
    const link = path.join(root, "leak");
    let linked = true;
    try {
      symlinkSync(outside, link, "dir");
    } catch {
      linked = false; // the platform denies symlink creation; skip cleanly
    }
    if (!linked) {
      cleanup();
      return;
    }
    const tool = createFileDeleteTool();
    const error = await refusal(
      run(tool, { path: "leak/absent.txt" }, { agent: agentWithCwd(root) }),
    );
    expect(error.code).toBe("symlink-escape");
    cleanup();
  });

  it("refuses a caller without a workspace instead of guessing one", async () => {
    const tool = createFileDeleteTool();
    const noCwd = await refusal(
      run(
        tool,
        { path: "any.txt" },
        {
          agent: { session: { header: {} } },
        },
      ),
    );
    expect(noCwd.code).toBe("workspace-unavailable");
    const noAgent = await refusal(run(tool, { path: "any.txt" }, {}));
    expect(noAgent.code).toBe("workspace-unavailable");
  });
});
