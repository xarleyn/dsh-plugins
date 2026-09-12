// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSidebar } from "../src/client/components/QaSidebar.js";
import { useSyncExternalStore } from "react";
import { QaAuthGate } from "../src/client/components/QaAuthGate.js";
import { QaAccountsController } from "../src/client/QaAccountsController.js";
import type { QaAccountsApi } from "../src/client/types.js";

describe("QA auth gate", () => {
  function accountsApi(
    overrides: Partial<Record<keyof QaAccountsApi, unknown>> = {},
  ): QaAccountsApi {
    return {
      accountsWhoami: vi.fn(async () => ({
        ok: true as const,
        value: { authenticated: false } as never,
      })),
      accountsLogin: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: invalid-credentials)"),
      })),
      accountsRegister: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: email-taken)"),
      })),
      accountsClaimSessions: vi.fn(async () => ({
        ok: true as const,
        value: { claimed: 0, conflicts: [] },
      })),
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: [] },
      })),
      ...overrides,
    } as QaAccountsApi;
  }

  function gate(api: QaAccountsApi) {
    const accounts = new QaAccountsController({
      remote: api,
      storage: window.localStorage,
      config: () => resolveConfig(),
    });
    return accounts;
  }

  function GateView({
    accounts,
    allowRegistration,
  }: {
    readonly accounts: QaAccountsController;
    readonly allowRegistration: boolean;
  }) {
    // Mirror the surface: project the controller through a live subscription.
    const snapshot = useSyncExternalStore(
      accounts.subscribe,
      accounts.getSnapshot,
      accounts.getSnapshot,
    );
    return (
      <QaAuthGate
        accounts={accounts}
        snapshot={snapshot}
        title="DeepSeek QA"
        logoUrl={null}
        allowRegistration={allowRegistration}
      />
    );
  }

  async function mountedGate(api: QaAccountsApi, allowRegistration = true) {
    const accounts = gate(api);
    const view = render(
      <GateView accounts={accounts} allowRegistration={allowRegistration} />,
    );
    void accounts.start();
    await waitFor(() => {
      expect(accounts.getSnapshot().stage).toBe("gate");
    });
    return { accounts, view };
  }

  it("renders the login card and switches to registration", async () => {
    await mountedGate(accountsApi());
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByText("Регистрация")).toBeTruthy();
    fireEvent.click(screen.getByText("Регистрация"));
    expect(screen.getByText("Зарегистрироваться")).toBeTruthy();
  });

  it("hides the registration tab when the deployment disables signup", async () => {
    await mountedGate(accountsApi(), false);
    expect(screen.queryByText("Регистрация")).toBeNull();
    expect(screen.getByText("Войти")).toBeTruthy();
  });

  it("reports coarse refusals as audience-safe copy", async () => {
    await mountedGate(accountsApi(), false);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "wrong-password-1" },
    });
    fireEvent.click(screen.getByText("Войти"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Неверный email или пароль",
      );
    });
  });

  it("renders the account chip with a logout action in the sidebar", () => {
    const onLogout = vi.fn();
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
        account={{ email: "a@b.co", role: "admin", onLogout }}
      />,
    );
    const chip = document.querySelector(".dsh-qa-sidebar__account");
    expect(chip?.textContent).toContain("a@b.co");
    expect(chip?.textContent).toContain("admin");
    fireEvent.click(
      document.querySelector(".dsh-qa-sidebar__account-exit") as HTMLElement,
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
