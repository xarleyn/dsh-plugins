import { describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";

/**
 * The wire contract of `qaSurface/queueStatus` is two arguments, not two
 * optional ones: the gateway client counts declared parameters, so a browser
 * that omits them is refused with
 * `client api: qaSurface/queueStatus expected 2 argument(s), got 0` before the
 * Host ever sees the call (16/16 initial sends on the 28.10 acceptance wave).
 * An empty session id is therefore the global read: it is what every initial
 * send asks for while its draft chat has no session to name.
 */
describe("queue status wire contract", () => {
  const make = () => {
    const access = vi.fn();
    const status = vi.fn(() => ({
      limit: 2,
      active: 0,
      full: false,
      managed: true,
    }));
    // The stand-in inherits the prototype, so `queueStatus` reaches its own
    // helpers (`queueCeiling`) while every service it reads stays a fake.
    const surface = Object.assign(Object.create(QaSurface.prototype), {
      getConfig: () => ({ accounts: { enabled: true } }),
      // No accounts store on this stand-in: the ceiling read then answers the
      // deployment default, which is what these assertions measure.
      accountRemotes: { resolve: () => undefined },
      sharing: () => ({ access }),
      requestScheduler: { status },
    }) as unknown as QaSurface;
    return {
      access,
      status,
      read: (token: string, sessionId: string) =>
        QaSurface.prototype.queueStatus.call(surface, token, sessionId),
    };
  };

  it("reads the deployment counts for the empty session id without a chat lookup", () => {
    const f = make();
    f.read("", "");
    expect(f.access).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenCalledWith(undefined, undefined);
  });

  it("checks the chat's account before returning its position", () => {
    const f = make();
    f.read("owner", "owned-chat");
    expect(f.access).toHaveBeenCalledWith("owner", "owned-chat");
    expect(f.status).toHaveBeenCalledWith("owned-chat", undefined);
  });

  it("still refuses a foreign or unauthenticated chat position", () => {
    const access = vi.fn(() => {
      throw new Error("Chat unavailable");
    });
    const status = vi.fn();
    const surface = Object.assign(Object.create(QaSurface.prototype), {
      getConfig: () => ({ accounts: { enabled: true } }),
      accountRemotes: { resolve: () => undefined },
      sharing: () => ({ access }),
      requestScheduler: { status },
    }) as unknown as QaSurface;
    expect(() =>
      QaSurface.prototype.queueStatus.call(surface, "", "foreign-chat"),
    ).toThrow("Chat unavailable");
    expect(status).not.toHaveBeenCalled();
  });
});
