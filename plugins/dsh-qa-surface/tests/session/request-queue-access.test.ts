import { describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
describe("queue position authorization", () => {
  const make = () => {
    const access = vi.fn((token: string, id: string) => {
      if (token !== "owner" || id !== "owned-chat")
        throw new Error("Chat unavailable");
    });
    const status = vi.fn(() => ({
      limit: 2,
      active: 2,
      full: true,
      managed: true,
      waiting: true,
      position: 1,
    }));
    const surface = {
      getConfig: () => ({ accounts: { enabled: true } }),
      sharing: () => ({ access }),
      requestScheduler: { status },
    } as unknown as QaSurface;
    return {
      access,
      status,
      read: (token?: string, id?: string) =>
        QaSurface.prototype.queueStatus.call(surface, token, id),
    };
  };
  it("allows global counts without a chat lookup", () => {
    const f = make();
    f.read();
    expect(f.access).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenCalledWith(undefined);
  });
  it("checks the current account before returning its chat position", () => {
    const f = make();
    expect(f.read("owner", "owned-chat").position).toBe(1);
    expect(f.access).toHaveBeenCalledWith("owner", "owned-chat");
  });
  it.each([
    ["visitor", "owned-chat"],
    ["owner", "missing-chat"],
    [undefined, "owned-chat"],
  ])("does not expose a foreign or unauthenticated position", (token, id) => {
    const f = make();
    expect(() => f.read(token, id)).toThrow("Chat unavailable");
    expect(f.status).not.toHaveBeenCalled();
  });
});
