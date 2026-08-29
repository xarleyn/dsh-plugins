import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DraftStoreError } from "../src/host/errors.js";
import { DraftStore } from "../src/host/store.js";

const temporaryDirectories: string[] = [];

async function storageFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-draft-sessions-"));
  temporaryDirectories.push(directory);
  return join(directory, "drafts.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("DraftStore", () => {
  it("persists independent drafts and filters them by workspace", async () => {
    const path = await storageFile();
    let sequence = 0;
    const store = new DraftStore({
      storagePath: path,
      id: () => `draft-${++sequence}`,
      now: () => 1_000 + sequence,
    });

    const first = await store.create({
      workspaceId: "workspace-a",
      sessionId: "session-a",
      text: "AAA",
    });
    const second = await store.create({
      workspaceId: "workspace-a",
      sessionId: "session-b",
      text: "BBB",
    });
    await store.create({ workspaceId: "workspace-b", text: "CCC" });

    expect(await store.list({ workspaceId: "workspace-a" })).toMatchObject([
      { id: first.id, text: "AAA", sessionId: "session-a", order: 0 },
      { id: second.id, text: "BBB", sessionId: "session-b", order: 1 },
    ]);

    const reloaded = new DraftStore({ storagePath: path });
    expect(await reloaded.list()).toHaveLength(3);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
    });
  });

  it("rejects a stale concurrent update instead of mixing text", async () => {
    const path = await storageFile();
    const store = new DraftStore({ storagePath: path, id: () => "draft-a" });
    const draft = await store.create({ workspaceId: "workspace-a" });

    const results = await Promise.allSettled([
      store.update({ id: draft.id, expectedRevision: 1, text: "AAA" }),
      store.update({ id: draft.id, expectedRevision: 1, text: "BBB" }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(DraftStoreError);
    expect((rejected?.reason as DraftStoreError).code).toBe(
      "DRAFT_STALE_REVISION",
    );
    const [stored] = await store.list();
    expect(stored?.revision).toBe(2);
    expect(["AAA", "BBB"]).toContain(stored?.text);
  });

  it("rebinds a lost session shell without changing draft text", async () => {
    const path = await storageFile();
    const store = new DraftStore({ storagePath: path, id: () => "draft-a" });
    const draft = await store.create({
      workspaceId: "workspace-a",
      sessionId: "dead-session",
      text: "keep me",
    });

    const detached = await store.rebind({
      id: draft.id,
      expectedRevision: draft.revision,
      sessionId: null,
    });
    const recovered = await store.rebind({
      id: draft.id,
      expectedRevision: detached.revision,
      sessionId: "new-session",
    });

    expect(detached).toMatchObject({
      sessionId: null,
      state: "draft",
      text: "keep me",
    });
    expect(recovered).toMatchObject({
      sessionId: "new-session",
      state: "ready",
      text: "keep me",
      revision: 3,
    });
  });

  it("clears a materialization error after a successful rebind", async () => {
    const path = await storageFile();
    const store = new DraftStore({ storagePath: path, id: () => "draft-a" });
    const created = await store.create({ workspaceId: "workspace-a" });
    const failed = await store.update({
      id: created.id,
      expectedRevision: created.revision,
      state: "error",
      lastError: "temporary failure",
    });

    const recovered = await store.rebind({
      id: failed.id,
      expectedRevision: failed.revision,
      sessionId: "session-new",
    });

    expect(recovered).toMatchObject({
      state: "ready",
      sessionId: "session-new",
    });
    expect(recovered.lastError).toBeUndefined();
  });

  it("supports explicit title removal and deletion guards", async () => {
    const path = await storageFile();
    const store = new DraftStore({ storagePath: path, id: () => "draft-a" });
    const created = await store.create({
      workspaceId: "workspace-a",
      title: "Manual title",
    });
    const updated = await store.update({
      id: created.id,
      expectedRevision: created.revision,
      title: null,
      pinned: true,
    });
    expect(updated.title).toBeUndefined();
    expect(updated.pinned).toBe(true);

    await expect(
      store.delete({ id: created.id, expectedRevision: 1 }),
    ).rejects.toMatchObject({
      code: "DRAFT_STALE_REVISION",
    });
    await expect(
      store.delete({ id: created.id, expectedRevision: 2 }),
    ).resolves.toBe(true);
    await expect(store.delete({ id: created.id })).resolves.toBe(false);
  });

  it("enforces the per-workspace limit", async () => {
    const path = await storageFile();
    let sequence = 0;
    const store = new DraftStore({
      storagePath: path,
      maxDraftsPerWorkspace: 2,
      id: () => `draft-${++sequence}`,
    });
    await store.create({ workspaceId: "workspace-a" });
    await store.create({ workspaceId: "workspace-a" });
    await expect(
      store.create({ workspaceId: "workspace-a" }),
    ).rejects.toMatchObject({
      code: "DRAFT_LIMIT_REACHED",
    });
    await expect(
      store.create({ workspaceId: "workspace-b" }),
    ).resolves.toBeDefined();
  });

  it("fails loudly on corrupt durable state", async () => {
    const path = await storageFile();
    await writeFile(path, '{"version":1,"drafts":[{"id":"broken"}]}', "utf8");
    const store = new DraftStore({ storagePath: path });
    await expect(store.list()).rejects.toMatchObject({
      code: "DRAFT_STORAGE_INVALID",
    });
  });
});
