import { describe, expect, it, vi } from "vitest";
import {
  QaAccountsController,
  accountsErrorMessage,
  accountsReasonOf,
} from "../src/client/QaAccountsController.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaAccountsApi } from "../src/client/types.js";
import type { QaAccountSession, QaWhoamiResult } from "../src/types.js";

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

function session(token: string): {
  readonly ok: true;
  readonly value: QaAccountSession;
} {
  return {
    ok: true,
    value: {
      token,
      user: {
        id: "u-1",
        email: "a@b.co",
        displayName: "a",
        role: "admin",
        createdAt: "2026-09-11T00:00:00.000Z",
        lastLoginAt: null,
        disabled: false,
      },
    },
  };
}

function remote(
  overrides: Partial<Record<keyof QaAccountsApi, unknown>> = {},
): QaAccountsApi {
  return {
    accountsWhoami: vi.fn(async () => ({
      ok: true as const,
      value: { authenticated: false } as QaWhoamiResult,
    })),
    accountsLogin: vi.fn(async () => session("t-login")),
    accountsRegister: vi.fn(async () => session("t-register")),
    accountsClaimSessions: vi.fn(async () => ({
      ok: true as const,
      value: { claimed: 0, conflicts: [] },
    })),
    accountsOwnedSessions: vi.fn(async () => ({
      ok: true as const,
      value: { ids: ["s-1"] },
    })),
    accountsListOwnership: vi.fn(async () => ({
      ok: true as const,
      value: { entries: [] },
    })),
    ...overrides,
  } as QaAccountsApi;
}

function controller(
  api: QaAccountsApi,
  options: {
    legacyChatIds?: () => readonly string[];
    forgetChat?: (id: string) => void;
    showOtherUsersChats?: boolean;
  } = {},
): QaAccountsController {
  const { showOtherUsersChats = false, ...controllerOptions } = options;
  return new QaAccountsController({
    remote: api,
    storage: storage(),
    config: () => resolveConfig({ accounts: { showOtherUsersChats } }),
    ...controllerOptions,
  });
}

const TOKEN_KEY = "dsh-qa-surface.session:v1:/qa:account-token";

describe("QA accounts controller", () => {
  it("starts anonymous without a stored token and stays in the gate", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "gate",
      mode: "login",
    });
    expect(accounts.token()).toBeNull();
    expect(api.accountsWhoami).not.toHaveBeenCalled();
  });

  it("restores a persisted token into the authed stage on boot", async () => {
    const store = storage();
    const boot = remote();
    const first = new QaAccountsController({
      remote: boot,
      storage: store,
      config: () => resolveConfig(),
    });
    await first.start();
    await first.login("a@b.co", "password-1");
    expect(first.getSnapshot().stage).toBe("authed");
    expect(store.getItem(TOKEN_KEY)).toBe("t-login");

    const restored = remote({
      accountsWhoami: vi.fn(async () => ({
        ok: true as const,
        value: {
          authenticated: true,
          user: session("x").value.user,
        } as QaWhoamiResult,
      })),
      accountsClaimSessions: vi.fn(async () => ({
        ok: true as const,
        value: { claimed: 0, conflicts: [] },
      })),
    });
    const second = new QaAccountsController({
      remote: restored,
      storage: store,
      config: () => resolveConfig(),
    });
    await second.start();
    expect(second.getSnapshot()).toMatchObject({
      stage: "authed",
      user: { email: "a@b.co" },
      ownedIds: ["s-1"],
    });
    expect(second.token()).toBe("t-login");
  });

  it("keeps the checking stage while the probe fails and recovers later", async () => {
    const store = storage();
    const signedIn = remote();
    const first = new QaAccountsController({
      remote: signedIn,
      storage: store,
      config: () => resolveConfig(),
    });
    await first.start();
    await first.login("a@b.co", "password-1");

    let fail = true;
    const flaky = remote({
      accountsWhoami: vi.fn(async () => {
        if (fail) throw new Error("connection down");
        return {
          ok: true as const,
          value: { authenticated: false } as QaWhoamiResult,
        };
      }),
    });
    const second = new QaAccountsController({
      remote: flaky,
      storage: store,
      config: () => resolveConfig(),
    });
    await second.start();
    // A failed probe must not wipe the token nor land in the gate.
    expect(second.getSnapshot().stage).toBe("checking");
    expect(second.token()).toBe("t-login");
    fail = false;
    await second.start();
    expect(second.getSnapshot().stage).toBe("gate");
  });

  it("migrates the legacy chat index at login and drops foreign conflicts", async () => {
    const forgotten: string[] = [];
    const api = remote({
      accountsLogin: vi.fn(async () => session("t-login")),
      accountsClaimSessions: vi.fn(async () => ({
        ok: true as const,
        value: { claimed: 2, conflicts: ["s-foreign"] },
      })),
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
    });
    const accounts = controller(api, {
      legacyChatIds: () => ["s-1", "s-2", "s-foreign"],
      forgetChat: (id) => forgotten.push(id),
    });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsClaimSessions).toHaveBeenCalledWith("t-login", [
      "s-1",
      "s-2",
      "s-foreign",
    ]);
    expect(forgotten).toEqual(["s-foreign"]);
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-mine"],
    });
  });

  it("merges the admin ownership view into the visible chat ids", async () => {
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
      accountsListOwnership: vi.fn(async () => ({
        ok: true as const,
        value: {
          entries: [
            {
              sessionId: "s-mine",
              userId: "u-1",
              displayName: "a",
              claimedAt: "2026-09-11T00:00:00.000Z",
            },
            {
              sessionId: "s-foreign",
              userId: "u-2",
              displayName: "Борис",
              claimedAt: "2026-09-11T00:01:00.000Z",
            },
          ],
        },
      })),
    });
    const accounts = controller(api, { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).toHaveBeenCalledWith("t-login");
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-mine", "s-foreign"],
    });
    expect(accounts.ownerNames().get("s-foreign")).toBe("Борис");
    // Author labels: foreign chats only.
    expect(accounts.messageAuthorOf("s-foreign")).toBe("Борис");
    expect(accounts.messageAuthorOf("s-mine")).toBeUndefined();
  });

  it("does not request or show other users' chats by default", async () => {
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
      accountsListOwnership: vi.fn(async () => ({
        ok: true as const,
        value: {
          entries: [
            {
              sessionId: "s-foreign",
              userId: "u-2",
              displayName: "Boris",
              claimedAt: "2026-09-11T00:01:00.000Z",
            },
          ],
        },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).not.toHaveBeenCalled();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-mine"],
      ownership: [],
    });
    expect(accounts.ownerNames().size).toBe(0);
    expect(accounts.messageAuthorOf("s-foreign")).toBeUndefined();
  });

  it("keeps ordinary accounts out of the ownership view", async () => {
    const api = remote({
      accountsLogin: vi.fn(async () => ({
        ok: true as const,
        value: {
          token: "t-user",
          user: {
            ...session("t-user").value.user,
            id: "u-9",
            role: "user" as const,
          },
        },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).not.toHaveBeenCalled();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-1"],
      ownership: [],
    });
    expect(accounts.ownerNames().size).toBe(0);
    expect(accounts.messageAuthorOf("s-1")).toBeUndefined();
  });

  it("degrades gracefully when the ownership listing is refused", async () => {
    const api = remote({
      accountsListOwnership: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: admin-required)"),
      })),
    });
    const accounts = controller(api, { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-1"],
      ownership: [],
    });
    expect(accounts.messageAuthorOf("s-1")).toBeUndefined();
  });

  it("maps coarse refusal codes to the audience copy", async () => {
    const api = remote({
      accountsLogin: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "wrong-password-1");
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "gate",
      busy: false,
      error: "Не удалось войти. Попробуйте ещё раз.",
    });
  });

  it("signs out and forgets the stored token", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    accounts.signOut();
    expect(accounts.getSnapshot()).toMatchObject({ stage: "gate" });
    expect(accounts.token()).toBeNull();
  });

  it("claims freshly created chats", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    await accounts.claimNewSession("s-new");
    expect(api.accountsClaimSessions).toHaveBeenLastCalledWith("t-login", [
      "s-new",
    ]);
  });

  it("maps wire reasons and unknown failures to copy", () => {
    expect(accountsReasonOf({ message: "boom (reason: email-taken)" })).toBe(
      "email-taken",
    );
    expect(accountsReasonOf({ message: "boom (reason: admin-required)" })).toBe(
      "admin-required",
    );
    expect(accountsReasonOf(new Error("plain"))).toBeNull();
    expect(accountsReasonOf(undefined)).toBeNull();
    expect(accountsErrorMessage("email-taken")).toContain("зарегистрирован");
    expect(accountsErrorMessage("admin-required")).toContain("администратору");
    expect(accountsErrorMessage(null)).toContain("Не удалось");
  });
});
