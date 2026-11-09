import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DraftSessionLifecycle,
  type DraftSessionLifecycleOptions,
} from "../src/client/lifecycle.js";
import { DraftStore } from "../src/host/store.js";

const temporaryDirectories: string[] = [];

async function store(): Promise<DraftStore> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-draft-lifecycle-"));
  temporaryDirectories.push(directory);
  return new DraftStore({
    storagePath: join(directory, "drafts.json"),
    id: () => "draft-a",
    now: () => 1_000,
  });
}

function remote(drafts: DraftStore): DraftSessionLifecycleOptions["drafts"] {
  return {
    list: async (request) => ({ ok: true, value: await drafts.list(request) }),
    create: async (request) => ({
      ok: true,
      value: await drafts.create(request),
    }),
    update: async (request) => ({
      ok: true,
      value: await drafts.update(request),
    }),
    delete: async (request) => ({
      ok: true,
      value: { deleted: await drafts.delete(request) },
    }),
    rebind: async (request) => ({
      ok: true,
      value: await drafts.rebind(request),
    }),
  };
}

function snapshot<T>(value: T) {
  return {
    getSnapshot: () => value,
    subscribe: () => () => undefined,
  };
}

type SessionsApi = DraftSessionLifecycleOptions["sessions"];

/** Session list store cut with only the fields the lifecycle reads. */
function listStore(
  byId: Record<string, { readonly blank: boolean; readonly updatedAt: number }>,
): SessionsApi["list"] {
  return snapshot({ byId, phase: "ready" }) as never;
}

function sessions(overrides: Partial<SessionsApi> = {}): SessionsApi {
  return {
    list: listStore({}),
    refresh: async () => undefined,
    create: async () => "session-new" as never,
    ...overrides,
  };
}

function statusObserver(): {
  readonly source: NonNullable<DraftSessionLifecycleOptions["status"]>;
  emit(sessionId: string, running: boolean): void;
} {
  let listener: ((sessionId: string, running: boolean) => void) | undefined;
  const source: NonNullable<DraftSessionLifecycleOptions["status"]> = (
    next,
  ) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  };
  return {
    source,
    emit(sessionId, running) {
      listener?.(sessionId, running);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("DraftSessionLifecycle", () => {
  it("persists a Session id only after distinct Session creation succeeds", async () => {
    const drafts = await store();
    const create = vi.fn(async (request?: { workspaceId?: unknown }) => {
      expect(request).toEqual({ workspaceId: "workspace-a" });
      expect(await drafts.list()).toMatchObject([
        { sessionId: null, state: "materializing", text: "unsent" },
      ]);
      return "session-a" as never;
    });
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({ create }),
    });

    const created = await lifecycle.create({
      workspaceId: "workspace-a",
      text: "unsent",
    });

    expect(create).toHaveBeenCalledOnce();
    expect(created).toMatchObject({
      sessionId: "session-a",
      state: "ready",
      text: "unsent",
      revision: 3,
    });
    expect(await drafts.list()).toEqual([created]);
  });

  it("keeps the durable draft when Session creation is rejected", async () => {
    const drafts = await store();
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({
        create: async () => {
          throw Object.assign(new Error("workspace disappeared"), {
            rpcError: {
              code: "workspace/not-found",
              message: "workspace disappeared",
              details: {},
            },
          });
        },
      }),
    });

    await expect(
      lifecycle.create({ workspaceId: "workspace-a", text: "keep me" }),
    ).rejects.toMatchObject({
      name: "DraftLifecycleError",
      stage: "session-create",
      code: "workspace/not-found",
      draft: {
        sessionId: null,
        state: "error",
        text: "keep me",
        lastError: "workspace disappeared",
      },
    });
    expect(await drafts.list()).toMatchObject([
      { sessionId: null, state: "error", text: "keep me" },
    ]);
  });

  it("detects a missing Session shell and rebinds a replacement", async () => {
    const drafts = await store();
    const stale = await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-missing",
      text: "recover me",
    });
    const create = vi.fn(async () => "session-replacement" as never);
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({ create }),
    });

    const recovered = await lifecycle.ensureShell(stale);

    expect(create).toHaveBeenCalledOnce();
    expect(recovered).toMatchObject({
      sessionId: "session-replacement",
      state: "ready",
      text: "recover me",
      revision: 3,
    });
  });

  it("does not replace a Session shell that is still present", async () => {
    const drafts = await store();
    const current = await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-current",
    });
    const create = vi.fn();
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({
        list: listStore({
          "session-current": { blank: true, updatedAt: 1_000 },
        }),
        create,
      }),
    });

    await expect(lifecycle.ensureShell(current)).resolves.toBe(current);
    expect(create).not.toHaveBeenCalled();
  });

  it("finalizes a draft after a running status makes its Session nonblank", async () => {
    const drafts = await store();
    await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-current",
      text: "send me",
    });
    const observed = statusObserver();
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({
        list: listStore({
          "session-current": { blank: false, updatedAt: 1_001 },
        }),
      }),
      status: observed.source,
    });

    expect(lifecycle).toBeDefined();
    observed.emit("session-current", true);

    await vi.waitFor(async () => {
      expect(await drafts.list()).toHaveLength(0);
    });
  });

  it("preserves a draft while its Session is not running", async () => {
    const drafts = await store();
    const current = await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-current",
      text: "do not lose me",
    });
    const observed = statusObserver();
    const refresh = vi.fn();
    new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({ refresh }),
      status: observed.source,
    });

    observed.emit("session-current", false);
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(await drafts.list()).toEqual([current]);
  });

  it("keeps an accepted command draft while its Session remains blank", async () => {
    const drafts = await store();
    const current = await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-current",
      text: "/help",
    });
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({
        list: listStore({
          "session-current": { blank: true, updatedAt: 1_001 },
        }),
      }),
    });

    await expect(
      lifecycle.finalizeAcceptedSession("session-current"),
    ).resolves.toBe(false);
    expect(await drafts.list()).toEqual([current]);
  });

  it("finalizes an already nonblank Session during reload reconciliation", async () => {
    const drafts = await store();
    await drafts.create({
      workspaceId: "workspace-a",
      sessionId: "session-current",
    });
    const lifecycle = new DraftSessionLifecycle(new Context(), {
      drafts: remote(drafts),
      sessions: sessions({
        list: listStore({
          "session-current": { blank: false, updatedAt: 1_001 },
        }),
      }),
    });

    await expect(lifecycle.reconcileWorkspace("workspace-a")).resolves.toEqual(
      [],
    );
    expect(await drafts.list()).toEqual([]);
  });
});
