/** Fail-closed session/repository resolution (SPEC §5). */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GitToolError } from "../src/errors.js";
import {
  canonicalizeCommit,
  requireSessionCwd,
  resolveRepositoryRoot,
  resolveToolRepository,
} from "../src/git/repo.js";
import { runGit } from "../src/git/runner.js";
import {
  createTempRepo,
  makeExec,
  normalizePath,
  type TempRepo,
} from "./fixtures/git.js";

let repo: TempRepo;
let plainDir: string;

beforeAll(async () => {
  repo = await createTempRepo();
  await repo.commit("hello.txt", "hello\n", "init");
  plainDir = await mkdtemp(join(tmpdir(), "dsh-git-readonly-plain-"));
});

afterAll(async () => {
  await repo.dispose();
  await rm(plainDir, { recursive: true, force: true });
});

/** Await a resolution that must be refused, and hand the refusal back. */
async function refusal(promise: Promise<unknown>): Promise<GitToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitToolError) return error;
    throw error;
  }
  throw new Error("expected the repository resolution to be refused");
}

describe("requireSessionCwd", () => {
  it("fails closed without an agent session", () => {
    expect(() => requireSessionCwd({})).toThrowError(GitToolError);
    expect(() => requireSessionCwd({ agent: undefined })).toThrowError(
      GitToolError,
    );
  });

  it("fails closed when the session header has no cwd", () => {
    expect(() => requireSessionCwd(makeExec(undefined))).toThrowError(
      GitToolError,
    );
    expect(() => requireSessionCwd(makeExec(""))).toThrowError(GitToolError);
  });

  it("returns the pinned cwd", () => {
    expect(requireSessionCwd(makeExec(repo.dir))).toBe(repo.dir);
  });
});

describe("resolveRepositoryRoot", () => {
  it("resolves the work-tree root from the session directory", async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, {
      timeoutMs: 10_000,
    });
    expect(normalizePath(root)).toBe(normalizePath(repo.dir));
  });

  it("fails closed outside a repository", async () => {
    await expect(
      resolveRepositoryRoot(runGit, plainDir, { timeoutMs: 10_000 }),
    ).rejects.toThrowError(GitToolError);
  });
});

describe("resolveToolRepository", () => {
  it("falls back to the only configured root when the session is not a repository", async () => {
    const root = await resolveToolRepository(
      runGit,
      makeExec(plainDir),
      undefined,
      {
        timeoutMs: 10_000,
        repositoryRoots: [repo.dir],
      },
    );
    expect(normalizePath(root)).toBe(normalizePath(repo.dir));
  });

  it("requires an explicit choice when multiple roots are configured", async () => {
    await expect(
      resolveToolRepository(runGit, makeExec(plainDir), undefined, {
        timeoutMs: 10_000,
        repositoryRoots: [repo.dir, plainDir],
      }),
    ).rejects.toThrow(/select one configured repository root/u);
  });

  it("reads a selection of the session directory itself as the default", async () => {
    // What a model echoing its own working directory sends, absolute or as
    // ".": it names no repository, so it means the same as omitting it.
    for (const requested of [plainDir, "."]) {
      const root = await resolveToolRepository(
        runGit,
        makeExec(plainDir),
        requested,
        { timeoutMs: 10_000, repositoryRoots: [repo.dir] },
      );
      expect(normalizePath(root)).toBe(normalizePath(repo.dir));
    }
  });

  it("refuses a selection of the session directory when no root is configured", async () => {
    const error = await refusal(
      resolveToolRepository(runGit, makeExec(plainDir), plainDir, {
        timeoutMs: 10_000,
        repositoryRoots: [],
      }),
    );
    expect(error.code).toBe("not-a-git-repository");
    expect(error.message).toContain("exposes no repository roots");
  });

  it("refuses instead of looping when the only root is the session directory", async () => {
    const error = await refusal(
      resolveToolRepository(runGit, makeExec(plainDir), plainDir, {
        timeoutMs: 10_000,
        repositoryRoots: [plainDir],
      }),
    );
    expect(error.code).toBe("not-a-git-repository");
    expect(error.message).toContain(plainDir);
  });

  it("names the configured roots when an explicit selection is not a repository", async () => {
    const nested = join(plainDir, "nested");
    await mkdir(nested);
    const error = await refusal(
      resolveToolRepository(runGit, makeExec(plainDir), nested, {
        timeoutMs: 10_000,
        repositoryRoots: [repo.dir],
      }),
    );
    expect(error.code).toBe("not-a-git-repository");
    expect(error.message).toContain(nested);
    expect(error.message).toContain(`configured repository roots: ${repo.dir}`);
  });

  it("selects an operator-approved repository outside the session directory", async () => {
    const root = await resolveToolRepository(
      runGit,
      makeExec(plainDir),
      repo.dir,
      {
        timeoutMs: 10_000,
        repositoryRoots: [repo.dir],
      },
    );
    expect(normalizePath(root)).toBe(normalizePath(repo.dir));
  });

  it("rejects an explicit repository outside every allowed root", async () => {
    await expect(
      resolveToolRepository(runGit, makeExec(plainDir), repo.dir, {
        timeoutMs: 10_000,
        repositoryRoots: [],
      }),
    ).rejects.toMatchObject({ code: "repository-not-allowed" });
  });

  it("rejects a nested selector when git resolves above its allowed root", async () => {
    const nested = join(repo.dir, "nested");
    await mkdir(nested);
    await expect(
      resolveToolRepository(runGit, makeExec(plainDir), nested, {
        timeoutMs: 10_000,
        repositoryRoots: [nested],
      }),
    ).rejects.toMatchObject({ code: "repository-not-allowed" });
  });

  it("rejects empty and missing repository directories with typed errors", async () => {
    await expect(
      resolveToolRepository(runGit, makeExec(plainDir), " ", {
        timeoutMs: 10_000,
        repositoryRoots: [],
      }),
    ).rejects.toMatchObject({ code: "invalid-repository" });
    await expect(
      resolveToolRepository(
        runGit,
        makeExec(plainDir),
        join(plainDir, "missing"),
        {
          timeoutMs: 10_000,
          repositoryRoots: [],
        },
      ),
    ).rejects.toMatchObject({ code: "invalid-repository" });
  });
});

describe("canonicalizeCommit", () => {
  it("canonicalizes an abbreviated id to the full commit oid", async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, {
      timeoutMs: 10_000,
    });
    const full = (await repo.run(["rev-parse", "HEAD"])).trim();
    const canonical = await canonicalizeCommit(runGit, root, full.slice(0, 8), {
      timeoutMs: 10_000,
    });
    expect(canonical).toBe(full);
  });

  it("rejects well-formed hexadecimal ids that do not exist", async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, {
      timeoutMs: 10_000,
    });
    await expect(
      canonicalizeCommit(runGit, root, "deadbee", { timeoutMs: 10_000 }),
    ).rejects.toThrowError(GitToolError);
  });
});
