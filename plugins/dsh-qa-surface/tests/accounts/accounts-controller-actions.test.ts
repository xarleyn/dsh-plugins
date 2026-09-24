import { describe, expect, it, vi } from "vitest";
import {
  accountsErrorMessage,
  accountsReasonOf,
} from "../../src/client/QaAccountsController.js";
import { controller, remote } from "./accounts-controller.helpers.js";

describe("QA accounts controller", () => {
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

  it("claims freshly created chats and lists them at once", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    // The owned list is what the sidebar shows, so a chat opened after login
    // enters it here rather than waiting for the next login.
    expect(accounts.ownedIds()).toEqual(["s-1"]);
    await accounts.claimNewSession("s-new");
    expect(api.accountsClaimSessions).toHaveBeenLastCalledWith("t-login", [
      "s-new",
    ]);
    expect(accounts.ownedIds()).toEqual(["s-1", "s-new"]);
  });

  it("claims idempotently without repeating an id the list already holds", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    await accounts.claimNewSession("s-1");
    expect(accounts.ownedIds()).toEqual(["s-1"]);
  });

  it("keeps a chat another account claimed out of the owned list", async () => {
    const api = remote({
      accountsClaimSessions: vi.fn(async () => ({
        ok: true as const,
        value: { claimed: 0, conflicts: ["s-foreign"] },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    await accounts.claimNewSession("s-foreign");
    expect(accounts.ownedIds()).toEqual(["s-1"]);
  });

  it("lists a chat whose claim never reached the host", async () => {
    const api = remote({
      accountsClaimSessions: vi.fn(
        async (_token: string, ids: readonly string[]) => {
          if (ids.includes("s-new")) throw new Error("host unreachable");
          return { ok: true as const, value: { claimed: 0, conflicts: [] } };
        },
      ),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    await accounts.claimNewSession("s-new");
    // The page holds the binding through the attendance boundary, which claims
    // an unowned chat and refuses another account's: the chat is this
    // account's either way, so a failed call must not hide it.
    expect(accounts.ownedIds()).toEqual(["s-1", "s-new"]);
    warn.mockRestore();
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
    expect(accountsErrorMessage("invalid-profile")).toContain("профиля");
    expect(accountsErrorMessage("profile-disabled")).toContain("отключён");
    expect(accountsErrorMessage(null)).toContain("Не удалось");
  });

  it("stores the signed-in user's profile and reports refusals inline", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    const refusal = await accounts.updateProfile({
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "Отвечай кратко.",
    });
    expect(refusal).toBeNull();
    expect(api.accountsUpdateProfile).toHaveBeenCalledWith("t-login", {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "Отвечай кратко.",
    });
    // The snapshot carries the stored profile, so the sidebar name updates.
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      user: {
        profile: { fullName: "Иван Иванов", identities: { jira: "i.ivanov" } },
      },
    });

    const refused = controller(
      remote({
        accountsUpdateProfile: vi.fn(async () => ({
          ok: false as const,
          error: new Error("nope (reason: invalid-profile)"),
        })),
      }),
    );
    await refused.start();
    await refused.login("a@b.co", "password-1");
    expect(
      await refused.updateProfile({
        fullName: "",
        identities: {},
        instructions: "",
      }),
    ).toContain("профиля");
  });

  it("refuses a profile write while anonymous", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await expect(
      accounts.updateProfile({
        fullName: "x",
        identities: {},
        instructions: "",
      }),
    ).resolves.toContain("Не удалось");
    expect(api.accountsUpdateProfile).not.toHaveBeenCalled();
  });

  it("stores the signed-in user's starters and reports refusals inline", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    const input = {
      items: [{ label: "Мои задачи", prompt: "Найди мои задачи в Jira" }],
      hideDefaults: true,
    };
    expect(await accounts.updateStarters(input)).toBeNull();
    expect(api.accountsUpdateStarters).toHaveBeenCalledWith("t-login", input);
    // The snapshot carries the stored starters, so the composer updates.
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      user: { starters: input },
    });

    const refused = controller(
      remote({
        accountsUpdateStarters: vi.fn(async () => ({
          ok: false as const,
          error: new Error("nope (reason: invalid-starters)"),
        })),
      }),
    );
    await refused.start();
    await refused.login("a@b.co", "password-1");
    expect(await refused.updateStarters(input)).toContain("подсказки");
  });

  it("refuses a starters write while anonymous", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await expect(
      accounts.updateStarters({ items: [], hideDefaults: false }),
    ).resolves.toContain("Не удалось");
    expect(api.accountsUpdateStarters).not.toHaveBeenCalled();
  });

  it("changes the password and keeps the session on the token it gets back", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(
      await accounts.changePassword("password-1", "password-2"),
    ).toBeNull();
    expect(api.accountsChangePassword).toHaveBeenCalledWith(
      "t-login",
      "password-1",
      "password-2",
    );
    // The change bumped the version the old token was minted under, so the
    // browser keeps its session only by adopting the token from the answer.
    expect(accounts.token()).toBe("t-changed");
    expect(accounts.getSnapshot()).toMatchObject({ stage: "authed" });
  });

  it("reports a wrong current password as refusal copy", async () => {
    const api = remote({
      accountsChangePassword: vi.fn(async () => ({
        ok: false as const,
        error: new Error("nope (reason: invalid-current-password)"),
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(await accounts.changePassword("password-9", "password-2")).toContain(
      "Текущий пароль",
    );
    // The stored token is untouched by a refusal.
    expect(accounts.token()).toBe("t-login");
  });

  it("refuses a password change while anonymous", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await expect(
      accounts.changePassword("password-1", "password-2"),
    ).resolves.toContain("Не удалось");
    expect(api.accountsChangePassword).not.toHaveBeenCalled();
  });

  it("files a reset request and answers it the same way for every address", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.requestPasswordReset("ghost@b.co");
    expect(api.accountsRequestPasswordReset).toHaveBeenCalledWith("ghost@b.co");
    const snapshot = accounts.getSnapshot();
    expect(snapshot).toMatchObject({
      stage: "gate",
      mode: "login",
      busy: false,
    });
    expect(snapshot.stage === "gate" ? snapshot.notice : null).toContain(
      "Заявка отправлена",
    );
  });

  it("reads, mints and revokes integration tokens through the bound token", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");

    expect(await accounts.serviceTokens()).toEqual({ ok: true, value: [] });
    expect(api.accountsListServiceTokens).toHaveBeenCalledWith("t-login");

    const input = { label: "мост заявок", scopes: ["ask"], ttlDays: 30 };
    const created = await accounts.createServiceToken(input);
    expect(api.accountsCreateServiceToken).toHaveBeenCalledWith(
      "t-login",
      input,
    );
    expect(created).toMatchObject({
      ok: true,
      value: { token: "qsat.token-1.secret", label: "мост заявок" },
    });

    expect(await accounts.revokeServiceToken("token-1")).toEqual({
      ok: true,
      value: null,
    });
    expect(api.accountsRevokeServiceToken).toHaveBeenCalledWith(
      "t-login",
      "token-1",
    );
  });

  it("turns a token refusal into the copy the page shows", async () => {
    const off = controller(
      remote({
        accountsCreateServiceToken: vi.fn(async () => ({
          ok: false as const,
          error: new Error("nope (reason: integration-disabled)"),
        })),
      }),
    );
    await off.start();
    await off.login("a@b.co", "password-1");
    expect(await off.createServiceToken({})).toEqual({
      ok: false,
      error: expect.stringContaining("Интеграционный API выключен"),
    });

    const foreign = controller(
      remote({
        accountsRevokeServiceToken: vi.fn(async () => ({
          ok: false as const,
          error: new Error("nope (reason: forbidden)"),
        })),
      }),
    );
    await foreign.start();
    await foreign.login("a@b.co", "password-1");
    expect(await foreign.revokeServiceToken("token-2")).toEqual({
      ok: false,
      error: expect.stringContaining("другой учётной записи"),
    });
  });

  it("refuses to touch tokens while anonymous", async () => {
    const api = remote();
    const accounts = controller(api);
    await accounts.start();
    expect(await accounts.serviceTokens()).toMatchObject({ ok: false });
    expect(await accounts.createServiceToken({})).toMatchObject({ ok: false });
    expect(await accounts.revokeServiceToken("token-1")).toMatchObject({
      ok: false,
    });
    expect(api.accountsListServiceTokens).not.toHaveBeenCalled();
  });
});
