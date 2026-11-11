import type { Agent } from "@deepseek-ai/dsh-agent";
import { describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";

/**
 * The host-side half of the queue-slots chain: the ceiling one arriving turn
 * fills against is resolved at admission — the account's override, else the
 * chat's role, else the deployment's — and the queue-status read answers with
 * the caller's own chain rather than a number that was true at boot.
 */
describe("the host reads the queue chain per admission", () => {
  const agent = (sessionId: string): Agent =>
    ({
      id: sessionId,
      status: "running",
      session: { id: sessionId },
    }) as unknown as Agent;

  function surfaceWith(options: {
    readonly accountsEnabled: boolean;
    readonly owner?: string | undefined;
    readonly user?: { readonly id: string } | undefined;
  }) {
    const queueSlotsFor = vi.fn(() => 4);
    const queueSlotsForUser = vi.fn(() => 5);
    const accounts = {
      ownerIdOf: (sessionId: string) =>
        sessionId === "owned-chat" ? (options.owner ?? "user-1") : undefined,
      currentUser: (token: string) => {
        if (token !== "t-owner" || options.user === undefined) {
          throw new Error("a valid QA account token is required");
        }
        return options.user;
      },
    };
    const surface = {
      getConfig: () => ({ accounts: { enabled: options.accountsEnabled } }),
      accountRemotes: {
        resolve: () => (options.accountsEnabled ? accounts : undefined),
      },
      access: { queueSlotsFor, queueSlotsForUser },
    } as unknown as QaSurface;
    return {
      queueSlotsFor,
      queueSlotsForUser,
      override: (item: Agent) =>
        (
          QaSurface.prototype as unknown as {
            queueSlotsOverride: (item: Agent) => number | undefined;
          }
        ).queueSlotsOverride.call(surface, item),
      ceiling: (token: string, sessionId: string | undefined) =>
        (
          QaSurface.prototype as unknown as {
            queueCeiling: (
              token: string,
              sessionId: string | undefined,
            ) => number | undefined;
          }
        ).queueCeiling.call(surface, token, sessionId),
    };
  }

  it("resolves an owned chat's turn through the access chain", () => {
    const f = surfaceWith({ accountsEnabled: true });
    expect(f.override(agent("owned-chat"))).toBe(4);
    expect(f.queueSlotsFor).toHaveBeenCalledWith("owned-chat");
  });

  it("keeps unowned and account-less turns in the deployment pool", () => {
    const f = surfaceWith({ accountsEnabled: true });
    expect(f.override(agent("foreign-chat"))).toBeUndefined();
    expect(f.queueSlotsFor).not.toHaveBeenCalled();
    expect(
      surfaceWith({ accountsEnabled: false }).override(agent("owned-chat")),
    ).toBeUndefined();
  });

  it("answers a chat read with the chat's own chain", () => {
    const f = surfaceWith({ accountsEnabled: true });
    expect(f.ceiling("t-owner", "owned-chat")).toBe(4);
    expect(f.queueSlotsFor).toHaveBeenCalledWith("owned-chat");
    expect(f.queueSlotsForUser).not.toHaveBeenCalled();
  });

  it("answers the pre-send read with the caller's account chain", () => {
    const f = surfaceWith({
      accountsEnabled: true,
      user: { id: "user-1" },
    });
    expect(f.ceiling("t-owner", undefined)).toBe(5);
    expect(f.queueSlotsForUser).toHaveBeenCalledWith("user-1");
  });

  it("answers an anonymous pre-send read with the deployment default", () => {
    const f = surfaceWith({ accountsEnabled: true });
    expect(f.ceiling("", undefined)).toBeUndefined();
    expect(f.queueSlotsForUser).not.toHaveBeenCalled();
  });
});
