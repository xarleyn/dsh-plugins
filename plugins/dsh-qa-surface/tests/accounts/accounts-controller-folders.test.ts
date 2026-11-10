import { describe, expect, it, vi } from "vitest";
import { controller, remote, session } from "./accounts-controller.helpers.js";
import type { QaOwnedSessionsResult } from "../../src/types.js";
const folder = { id: "api-folder", name: "Запросы API" };
describe("account integration folder transport", () => {
  it("publishes routing hints on login and refresh even when session ids stay the same", async () => {
    let integrationFolders = { "s-1": folder };
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true,
        value: { ids: ["s-1"], integrationFolders },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("account@example.test", "password-one");
    expect(accounts.getSnapshot()).toMatchObject({ integrationFolders });
    integrationFolders = { "s-1": { id: "new-folder", name: "Обработка" } };
    await accounts.refreshOwned();
    expect(accounts.getSnapshot()).toMatchObject({ integrationFolders });
    accounts.dispose();
  });
  it("discards a refresh that finishes after sign-out and another login", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("account@example.test", "password-one");
    let release!: (result: { ok: true; value: QaOwnedSessionsResult }) => void;
    vi.mocked(api.accountsOwnedSessions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = accounts.refreshOwned();
    accounts.signOut();
    // A different bearer is a different principal, even if a test user id is reused.
    vi.mocked(api.accountsLogin).mockResolvedValueOnce({
      ok: true,
      value: {
        token: "new-account-token",
        user: {
          ...session("new-account-token").value.user,
          id: "other-user",
        },
      },
    });
    await accounts.login("other@example.test", "password-two");
    release({
      ok: true,
      value: {
        ids: ["old-session"],
        integrationFolders: { "old-session": folder },
      },
    });
    await pending;
    expect(accounts.getSnapshot()).toMatchObject({ ownedIds: ["s-1"] });
    expect(accounts.getSnapshot()).not.toHaveProperty("integrationFolders");
    accounts.dispose();
  });
});
