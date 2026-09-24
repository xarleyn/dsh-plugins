import { describe, expect, it, vi } from "vitest";
import { controller, remote } from "./accounts-controller.helpers.js";

const OWNED = vi.fn(async () => ({
  ok: true as const,
  value: { ids: ["s-1", "s-2"] },
}));

describe("QA accounts controller rating harvest", () => {
  it("replays the ratings this browser holds for the account's own chats", async () => {
    const harvestRatings = vi.fn(async () => undefined);
    const api = remote({ accountsOwnedSessions: OWNED });
    const accounts = controller(api, { harvestRatings });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(harvestRatings).toHaveBeenCalledWith({
      token: "t-login",
      accountId: "u-1",
      ownedIds: ["s-1", "s-2"],
    });
  });

  it("waits for an ownership list that actually arrived", async () => {
    const harvestRatings = vi.fn(async () => undefined);
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: false as const,
        error: new Error("offline"),
      })),
    });
    const accounts = controller(api, { harvestRatings });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(harvestRatings).not.toHaveBeenCalled();
    expect(accounts.getSnapshot()).toMatchObject({ stage: "authed" });
  });

  it("opens the session even when the replay fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harvestRatings = vi.fn(async () => {
      throw new Error("host refused the batch");
    });
    const accounts = controller(remote({ accountsOwnedSessions: OWNED }), {
      harvestRatings,
    });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(accounts.getSnapshot()).toMatchObject({ stage: "authed" });
    expect(warn).toHaveBeenCalledWith(
      "dsh-qa-surface: rating harvest failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
