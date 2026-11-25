import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contentRef } from "../../src/archive/hash.js";
import { LocalResultArchive } from "../../src/archive/local.js";
import {
  resolveJevCompactionConfig,
  type JevCompactionConfig,
} from "../../src/config/index.js";
import type { JevQuestion, SystemOneBackend } from "../../src/jev/types.js";
import { ResultShapingSubsystem } from "../../src/result-shaping/index.js";

const LOG = "progress 10% of dependency graph\n".repeat(550);
const accepted = { kind: "accept" } as const;
const disposers: Array<() => void> = [];
const roots: string[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function directory() {
  const root = await mkdtemp(join(tmpdir(), "jev-shaping-limits-"));
  roots.push(root);
  return root;
}

function answers(questions: readonly JevQuestion[]) {
  return new Map(
    questions.map((q) => [q.name, q.name.startsWith("routine_") ? 1 : 0]),
  );
}

function register(
  raw: JevCompactionConfig = {},
  score: SystemOneBackend["score"] = async (_state, questions) =>
    answers(questions),
  archive?: LocalResultArchive,
) {
  let current = {
    ...raw,
    resultShaping: {
      enabled: true,
      maxConcurrent: 1,
      requestTimeoutMs: 500,
      maxPerTurn: 8,
      maxInputCharsPerTurn: 200_000,
      ...raw.resultShaping,
    },
    archive: { enabled: false, ...raw.archive },
  };
  let config = resolveJevCompactionConfig(current);
  const owner = new Context();
  const subsystem = new ResultShapingSubsystem({
    owner,
    readConfig: () => config,
    backend: { score },
    ...(archive ? { archive } : {}),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });
  subsystem.register();
  disposers.push(() => subsystem.dispose());
  return {
    subsystem,
    update(patch: JevCompactionConfig) {
      current = {
        ...current,
        ...patch,
        resultShaping: { ...current.resultShaping, ...patch.resultShaping },
        archive: { ...current.archive, ...patch.archive },
      };
      config = resolveJevCompactionConfig(current);
      subsystem.onConfigChanged();
    },
    run(callId: string, text = LOG, signal = new AbortController().signal) {
      return owner.waterfall(
        owner as never,
        "tools/post-execute",
        {
          name: "bash",
          callId,
          signal,
          agent: { session: Session.create(SessionId(callId)) },
        } as never,
        { isError: false, content: [{ type: "text", text }] } as never,
        async () => accepted,
      );
    },
  };
}

describe("registered result shaping", () => {
  it("honours the master switch before dispatch and cancels a run when switched off", async () => {
    const start = deferred();
    const finish = deferred();
    const score = vi.fn<SystemOneBackend["score"]>(async (_state, qs) => {
      start.resolve();
      await finish.promise;
      return answers(qs);
    });
    const host = register({ enabled: false }, score);
    expect(await host.run("disabled")).toBe(accepted);
    expect(score).not.toHaveBeenCalled();
    host.update({ enabled: true });
    const pending = host.run("running");
    await start.promise;
    host.update({ enabled: false });
    expect(await pending).toBe(accepted);
    finish.resolve();
    await new Promise<void>((done) => setImmediate(done));
    host.update({ enabled: true });
    expect(await host.run("enabled")).toHaveProperty("content");
    expect(score).toHaveBeenCalledTimes(2);
  });

  it.each(["deadline", "abort", "dispose"] as const)(
    "returns the original on %s and holds capacity while an uncooperative backend is still running",
    async (reason) => {
      const start = deferred();
      const finish = deferred();
      const score = vi.fn<SystemOneBackend["score"]>(async (_state, qs) => {
        start.resolve();
        await finish.promise;
        return answers(qs);
      });
      const host = register({}, score);
      const caller = new AbortController();
      const first = host.run("first", LOG, caller.signal);
      await start.promise;
      expect(await host.run("concurrent")).toBe(accepted);
      if (reason === "abort") caller.abort();
      if (reason === "dispose") host.subsystem.dispose();
      expect(await first).toBe(accepted);
      expect(
        host.subsystem.stats().counters["resultShaping.timeouts"] ?? 0,
      ).toBe(reason === "deadline" ? 1 : 0);
      expect(await host.run("still-running")).toBe(accepted);
      expect(score).toHaveBeenCalledTimes(1);
      finish.resolve();
      await new Promise<void>((done) => setImmediate(done));
      if (reason !== "dispose")
        expect(await host.run("available")).toHaveProperty("content");
    },
  );

  it("collects expired originals after writing, follows up overlapping writes and fixes the root for the mount", async () => {
    const root = await directory();
    const nextRoot = await directory();
    const archive = new LocalResultArchive(root);
    const content = [{ type: "text", text: "old result" }];
    const old = await archive.put({
      version: 1,
      createdAt: new Date().toISOString(),
      callId: "old",
      toolName: "bash",
      content,
      contentHash: contentRef(content),
      charCount: 10,
    });
    const [file] = await archive.list();
    await utimes(file!.path, new Date(0), new Date(0));
    const started = deferred();
    const unblock = deferred();
    const list = LocalResultArchive.prototype.list;
    const scans = vi
      .spyOn(LocalResultArchive.prototype, "list")
      .mockImplementationOnce(async function (
        this: LocalResultArchive,
        signal,
      ) {
        const snapshot = await list.call(this, signal);
        started.resolve();
        await unblock.promise;
        return snapshot;
      });
    const host = register({
      archive: {
        enabled: true,
        rootPath: root,
        maxBytes: 25_000,
        retentionDays: 1,
      },
    });
    expect(await host.run("first")).toHaveProperty("content");
    await started.promise;
    host.update({ archive: { rootPath: nextRoot } });
    expect(await host.run("second", LOG + "end")).toHaveProperty("content");
    expect(scans).toHaveBeenCalledTimes(1);
    expect(await readdir(nextRoot)).toHaveLength(0);
    unblock.resolve();
    await vi.waitFor(async () => {
      expect(scans).toHaveBeenCalledTimes(2);
      expect(await archive.get(old)).toBeNull();
      expect(await readdir(root)).toHaveLength(1);
    });
    const fresh = register({ archive: { enabled: true, rootPath: nextRoot } });
    expect(await fresh.run("after-remount")).toHaveProperty("content");
    await fresh.subsystem.collectArchive();
    expect(await readdir(nextRoot)).toHaveLength(1);
  });

  it("stops a pending retention pass at disposal without removing its captured files", async () => {
    const root = await directory();
    const archive = new LocalResultArchive(root);
    const scanned = deferred();
    const resume = deferred();
    const list = archive.list.bind(archive);
    const scans = vi
      .spyOn(archive, "list")
      .mockImplementationOnce(async (signal) => {
        const snapshot = await list(signal);
        scanned.resolve();
        await resume.promise;
        return snapshot;
      });
    const host = register(
      { archive: { enabled: true, maxBytes: 25_000 } },
      undefined,
      archive,
    );
    await host.run("first");
    await scanned.promise;
    await host.run("second", LOG + "second");
    const collection = host.subsystem.collectArchive();
    host.subsystem.dispose();
    resume.resolve();
    await collection;
    expect(scans).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toHaveLength(2);
  });

  it("keeps an original that cannot fit even alone in the archive", async () => {
    const root = await directory();
    const host = register({
      archive: { enabled: true, rootPath: root, maxBytes: 1 },
    });
    expect(await host.run("too-large")).toBe(accepted);
    expect(await readdir(root)).toHaveLength(0);
  });

  it("applies new retention limits to existing files and stops an obsolete pass", async () => {
    const archive = new LocalResultArchive(await directory());
    const content = [{ type: "text", text: "retained" }];
    const ref = await archive.put({
      version: 1,
      createdAt: new Date(0).toISOString(),
      callId: "old",
      toolName: "bash",
      content,
      contentHash: contentRef(content),
      charCount: 8,
    });
    const [file] = await archive.list();
    await utimes(file!.path, new Date(0), new Date(0));
    const scanned = deferred();
    const resume = deferred();
    const list = archive.list.bind(archive);
    vi.spyOn(archive, "list").mockImplementationOnce(async (signal) => {
      const snapshot = await list(signal);
      scanned.resolve();
      await resume.promise;
      return snapshot;
    });
    const host = register(
      { archive: { enabled: true, retentionDays: 0, maxBytes: 0 } },
      undefined,
      archive,
    );
    host.update({ archive: { retentionDays: 1 } });
    await scanned.promise;
    host.update({ archive: { retentionDays: 0 } });
    resume.resolve();
    await host.subsystem.collectArchive();
    expect(await archive.get(ref)).not.toBeNull();
    host.update({ archive: { maxBytes: 1 } });
    await vi.waitFor(async () => expect(await archive.get(ref)).toBeNull());
  });
});
