// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/resolve-config.js";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";
import { useSyncExternalStore } from "react";
import { QaAuthGate } from "../../../src/client/components/QaAuthGate.js";
import { QaAccountsController } from "../../../src/client/QaAccountsController.js";
import type { QaAccountsApi } from "../../../src/client/types.js";

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
      accountsChangePassword: vi.fn(async () => ({
        ok: false as const,
        error: new Error("unused"),
      })),
      accountsRequestPasswordReset: vi.fn(async () => ({
        ok: true as const,
        value: { accepted: true as const },
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
    // The gate stage is published by the whoami probe `start` awaits, so the
    // update lands after the render returned. Flushing it inside act is what
    // makes the projection see it; left floating, React reports the update as
    // unwrapped and the next test inherits the render.
    await act(async () => {
      await accounts.start();
    });
    await waitFor(() => {
      expect(accounts.getSnapshot().stage).toBe("gate");
    });
    return { accounts, view };
  }

  it("renders the login card and switches to registration", async () => {
    await mountedGate(accountsApi());
    expect(screen.getByRole("heading", { name: "DeepSeek QA" })).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Регистрация" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("qa-surface-auth-tab-register"));
    expect(
      screen.getByRole("button", { name: "Зарегистрироваться" }),
    ).toBeTruthy();
  });

  it("hides the registration tab when the deployment disables signup", async () => {
    await mountedGate(accountsApi(), false);
    expect(screen.queryByRole("tab", { name: "Регистрация" })).toBeNull();
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy();
  });

  it("reports coarse refusals as audience-safe copy", async () => {
    await mountedGate(accountsApi(), false);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "wrong-password-1" },
    });
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Неверный email или пароль",
      );
    });
  });

  // A click on the submit button goes through the browser's submission
  // algorithm in jsdom too, so a field `required` or `type="email"` fails to
  // reach the card until the form opts out — which is the defect, and the
  // reason the opt-out is asserted rather than only implied by the copy below.
  it("submits without handing the field to the browser's validator", async () => {
    await mountedGate(accountsApi(), false);
    const form = screen.getByTestId<HTMLFormElement>("qa-surface-auth-card");
    expect(form.noValidate).toBe(true);
    // The constraints stay declarative: they name the field for autofill and
    // assistive tech, while the card decides what an attempt means.
    expect(form.querySelector('input[type="email"]')).not.toBeNull();
    expect(
      form.querySelector<HTMLInputElement>('input[name="password"]')?.minLength,
    ).toBe(8);
  });

  it("refuses a password below the floor with its own copy, before the round trip", async () => {
    const api = accountsApi();
    await mountedGate(api, false);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Пароль должен быть не короче 8 символов.",
      );
    });
    expect(api.accountsLogin).not.toHaveBeenCalled();
    // Fixing the field takes the refusal away: it answered the attempt, not the
    // text the operator is typing now.
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "password-1" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(api.accountsLogin).toHaveBeenCalledWith("a@b.co", "password-1");
    });
  });

  it("refuses an address the Host could not accept", async () => {
    const api = accountsApi();
    await mountedGate(api, true);
    fireEvent.click(screen.getByTestId("qa-surface-auth-tab-register"));
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "not-an-address" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "password-1" },
    });
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Введите корректный email.",
      );
    });
    expect(api.accountsRegister).not.toHaveBeenCalled();
    // The registration tab is a different operation, not a different excuse.
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses an empty reset request in its own words", async () => {
    const api = accountsApi();
    await mountedGate(api, false);
    fireEvent.click(screen.getByTestId("qa-surface-auth-forgot"));
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Введите корректный email.",
      );
    });
    expect(api.accountsRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("files a forgotten-password request from the reset card", async () => {
    const api = accountsApi();
    const { accounts } = await mountedGate(api, false);
    fireEvent.click(screen.getByTestId("qa-surface-auth-forgot"));
    // The reset card asks for an address only: there is no password to type.
    expect(screen.queryByLabelText(/Пароль/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    fireEvent.click(screen.getByTestId("qa-surface-auth-submit"));
    await waitFor(() => {
      expect(api.accountsRequestPasswordReset).toHaveBeenCalledWith("a@b.co");
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Заявка отправлена",
      );
    });
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "gate",
      busy: false,
    });
    // Returning to the form drops the confirmation: it answered the request,
    // not the sign-in that follows it.
    fireEvent.click(screen.getByTestId("qa-surface-auth-forgot"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText(/Пароль/)).toBeTruthy();
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
    const chip = screen.getByTestId("qa-surface-sidebar-account");
    expect(chip.textContent).toContain("a@b.co");
    expect(chip.textContent).toContain("admin");
    fireEvent.click(screen.getByTestId("qa-surface-sidebar-account-logout"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
