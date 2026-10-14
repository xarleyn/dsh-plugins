import { describe, expect, it, vi } from "vitest";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import type { QaSharingApi } from "../../src/client/chat-sharing-api.js";
import type { QaChatAccess } from "../../src/chat-sharing/types.js";
import { harness } from "../helpers/session-fakes.js";

function fixture() {
  const world = harness(["chat-a", "child-a"]);
  const access = vi.fn<QaSharingApi["access"]>(async (_token, id) =>
    id === "chat-a"
      ? {
          ok: true,
          value: {
            sessionId: id,
            ownerId: "owner-a",
            ownerName: "Demo owner",
            actorId: "owner-a",
            mode: "owner",
            revision: 0,
          },
        }
      : {
          ok: false,
          error: new RemoteError("gateway/internal", "Unavailable", {}),
        },
  );
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig(),
    accounts: {
      token: () => "demo-token",
      ownedIds: () => ["chat-a"],
      messageAuthorOf: () => undefined,
      onSessionCreated: vi.fn(),
      onAuthRequired: vi.fn(),
    },
    sharingApi: {
      access,
      visible: vi.fn(),
      grants: vi.fn(),
      set: vi.fn(),
    },
  });
  return { world, access, controller };
}

describe("account access while watching a delegated session", () => {
  it("keeps the child open through access polls and returns to its owned chat", async () => {
    vi.useFakeTimers();
    const { world, access, controller } = fixture();
    try {
      await controller.switchTo("chat-a");
      const admitted = world.secureSession.mock.calls.length;
      await controller.viewSubagent("child-a", "Demo investigation");
      await vi.advanceTimersByTimeAsync(2100);
      expect(access.mock.calls).toEqual([
        ["demo-token", "chat-a"],
        ["demo-token", "chat-a"],
      ]);
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        sessionId: "child-a",
        viewingSubagent: { id: "child-a" },
        canSend: false,
        error: null,
      });
      expect(world.secureSession).toHaveBeenCalledTimes(admitted);
      expect(world.faces.get("child-a")?.prompt).not.toHaveBeenCalled();
      await controller.closeSubagent();
      expect(controller.getSnapshot()).toMatchObject({
        sessionId: "chat-a",
        viewingSubagent: null,
        canSend: true,
      });
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["revoked", "read", "collaborate"] as const)(
    "closes a delegated view when root ownership becomes %s",
    async (mode) => {
      vi.useFakeTimers();
      const { access, controller } = fixture();
      try {
        await controller.switchTo("chat-a");
        await controller.viewSubagent("child-a", "Demo investigation");
        await vi.advanceTimersByTimeAsync(1000);
        expect(controller.getSnapshot()).toMatchObject({
          sessionId: "child-a",
          error: null,
        });
        access.mockResolvedValue(
          mode === "revoked"
            ? {
                ok: false,
                error: new RemoteError("gateway/internal", "Unavailable", {}),
              }
            : {
                ok: true,
                value: {
                  sessionId: "chat-a",
                  ownerId: "other-owner",
                  ownerName: "Demo owner",
                  actorId: "owner-a",
                  mode,
                  revision: 1,
                } satisfies QaChatAccess,
              },
        );
        await vi.advanceTimersByTimeAsync(1000);
        expect(controller.getSnapshot()).toMatchObject({
          sessionId: null,
          canSend: false,
          error: "Доступ к чату отозван или аккаунт недоступен.",
        });
      } finally {
        controller.dispose();
        vi.useRealTimers();
      }
    },
  );
});
