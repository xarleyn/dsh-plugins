import { describe, expect, it, vi } from "vitest";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { resolveConfig } from "../../src/resolve-config.js";
import { qaStorageNamespace } from "../../src/shared/session-key.js";
import { QaChatIndex } from "../../src/client/chat-index.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import type { QaSharingApi } from "../../src/client/chat-sharing-api.js";
import { harness } from "../helpers/session-fakes.js";
import { until } from "../helpers/settle.js";

async function setup(child = false) {
  const world = child ? harness([], { subagents: ["child"] }) : harness();
  const id = child ? "child" : String(await world.serverSession());
  if (!child) world.list.set({ ...world.list.getSnapshot(), phase: "pending" });
  const config = resolveConfig({ accounts: { enabled: true } });
  new QaChatIndex(world.storage, qaStorageNamespace(config)).saveActive(id);
  let identity: string | null = "identity-a";
  const rememberAdmitted = vi.fn((value: string) => world.publishRow(value));
  const access = vi.fn<QaSharingApi["access"]>(async () => ({
    ok: true,
    value: {
      sessionId: id,
      ownerId: "owner",
      ownerName: "Demo owner",
      actorId: "owner",
      mode: "owner",
      revision: 1,
    },
  }));
  const empty = async () => ({ ok: true as const, value: [] });
  const sharingApi: QaSharingApi = {
    access,
    visible: empty,
    grants: empty,
    set: empty,
  };
  const controller = new QaSessionController({
    ...world,
    config,
    sessions: { ...world.sessions, rememberAdmitted },
    sharingApi,
    accounts: {
      token: () => identity,
      ownedIds: () => [id],
      messageAuthorOf: () => undefined,
      onSessionCreated: () => {},
      onAuthRequired: () => {},
    },
    timeoutMs: 30,
  });
  return {
    world,
    controller,
    id,
    access,
    rememberAdmitted,
    identity: (value: string | null) => {
      identity = value;
    },
  };
}

describe("authenticated chat restoration", () => {
  it("does not seed or retain a saved id whose read admission was refused", async () => {
    const h = await setup();
    h.access.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError(
        "gateway/internal",
        "Fixture admission refused",
        {},
      ),
    });
    try {
      await h.controller.ensureSession();
      expect(h.rememberAdmitted).not.toHaveBeenCalled();
      expect(h.world.retain).not.toHaveBeenCalled();
      expect(h.world.createSession).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot().phase).toBe("error");
    } finally {
      h.controller.dispose();
    }
  });

  it("restores an admitted id while the global catalog remains pending", async () => {
    const h = await setup();
    try {
      await h.controller.ensureSession();
      expect(h.world.list.getSnapshot().phase).toBe("pending");
      expect(h.controller.getSnapshot()).toMatchObject({
        phase: "ready",
        sessionId: h.id,
        canSend: true,
      });
      expect(h.rememberAdmitted).toHaveBeenCalledWith(h.id);
      expect(h.world.createSession).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
    }
  });

  it("takes no reference before the Host admits the saved chat", async () => {
    const h = await setup();
    let release!: (value: Awaited<ReturnType<QaSharingApi["access"]>>) => void;
    const gate = new Promise<Awaited<ReturnType<QaSharingApi["access"]>>>(
      (resolve) => {
        release = resolve;
      },
    );
    const accepted = await h.access("identity-a", h.id);
    h.access.mockClear();
    h.access.mockImplementationOnce(() => gate);
    try {
      const pending = h.controller.ensureSession();
      await until(() => h.access.mock.calls.length > 0);
      expect(h.world.retain).not.toHaveBeenCalled();
      expect(h.rememberAdmitted).not.toHaveBeenCalled();
      release(accepted);
      await pending;
      expect(h.controller.getSnapshot().sessionId).toBe(h.id);
    } finally {
      h.controller.dispose();
    }
  });

  it("drops admission from an identity that changed while the request was in flight", async () => {
    const h = await setup();
    const accepted = await h.access("identity-a", h.id);
    h.access.mockClear();
    h.access.mockImplementationOnce(async () => {
      h.identity("identity-b");
      return accepted;
    });
    try {
      await h.controller.ensureSession();
      expect(h.rememberAdmitted).not.toHaveBeenCalled();
      expect(h.world.retain).not.toHaveBeenCalled();
      expect(h.world.createSession).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
    }
  });

  it("keeps known delegated children out of the restored chat", async () => {
    const h = await setup(true);
    try {
      await h.controller.ensureSession();
      expect(h.access).not.toHaveBeenCalled();
      expect(h.rememberAdmitted).not.toHaveBeenCalled();
      expect(h.world.retain).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot()).toMatchObject({
        sessionId: null,
        canSend: true,
      });
    } finally {
      h.controller.dispose();
    }
  });
});
