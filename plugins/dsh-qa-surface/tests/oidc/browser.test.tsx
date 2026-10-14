// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQaOidcBrowser } from "../../src/client/oidc-browser.js";
import { QaAccountsController } from "../../src/client/QaAccountsController.js";
import { QaAuthGate } from "../../src/client/components/QaAuthGate.js";
import { QaRouteController } from "../../src/client/QaRouteController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  remote,
  session,
  storage,
} from "../accounts/accounts-controller.helpers.js";

const config = resolveConfig({
  accounts: {
    enabled: true,
    localLogin: false,
    oidc: {
      enabled: true,
      issuer: "https://id.example.corp/realms/demo",
      clientId: "qa-surface",
      redirectUri: "https://qa.example.corp/qa/oidc/callback",
    },
  },
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

describe("QA OIDC browser lifecycle", () => {
  it("stores proof before redirect and refuses insecure destinations", () => {
    const assign = vi.fn();
    const browser = createQaOidcBrowser(
      {
        location: { assign } as unknown as Location,
        history: window.history,
        sessionStorage: window.sessionStorage,
      },
      () => config,
    );
    browser.begin({
      authorizationUrl: "https://id.example.corp/auth",
      completionKey: "synthetic-proof",
    });
    expect(assign).toHaveBeenCalledWith("https://id.example.corp/auth");
    expect(window.sessionStorage.length).toBe(1);
    expect(() =>
      browser.begin({
        authorizationUrl: "http://id.example.corp/auth",
        completionKey: "other",
      }),
    ).toThrow();
  });

  it("keeps the handoff across Host navigation restoration and scrubs it before remote work", () => {
    window.history.replaceState(
      null,
      "",
      "/?__dsh_qa_route=%2Fqa#qa-oidc=synthetic-handoff",
    );
    const routes = new QaRouteController(window);
    routes.configure(config);
    expect(window.location.hash).toBe("#qa-oidc=synthetic-handoff");
    const browser = createQaOidcBrowser(window, () => config);
    const result = browser.takeHandoff();
    expect(result).toEqual({ handoff: "synthetic-handoff", completionKey: "" });
    expect(window.location.hash).toBe("");
    expect(browser.takeHandoff()).toBeNull();
    routes.dispose();
  });

  it("completes corporate sign-in through the normal account lifecycle", async () => {
    const api = remote({
      accountsOidcComplete: vi.fn(async () => session("oidc-session")),
    });
    const browser = {
      begin: vi.fn(),
      logout: vi.fn(),
      takeHandoff: vi.fn(() => ({
        handoff: "synthetic-handoff",
        completionKey: "synthetic-proof",
      })),
    };
    const accounts = new QaAccountsController({
      remote: api,
      storage: storage(),
      config: () => config,
      oidcBrowser: browser,
    });
    await accounts.start();
    expect(api.accountsOidcComplete).toHaveBeenCalledWith(
      "synthetic-handoff",
      "synthetic-proof",
    );
    expect(accounts.getSnapshot().stage).toBe("authed");
    expect(api.accountsWhoami).not.toHaveBeenCalled();
    accounts.dispose();
  });

  it("scrubs the handoff and fails closed when tab storage is unavailable", () => {
    window.history.replaceState(null, "", "/qa#qa-oidc=synthetic-handoff");
    const browser = createQaOidcBrowser(
      {
        location: window.location,
        history: window.history,
        sessionStorage: {
          getItem() {
            throw new Error("Storage restricted");
          },
        } as unknown as Storage,
      },
      () => config,
    );
    expect(browser.takeHandoff()).toEqual({
      handoff: "synthetic-handoff",
      completionKey: "",
    });
    expect(window.location.hash).toBe("");
  });

  it("shows corporate sign-in alone when local login is disabled", async () => {
    const api = remote({
      accountsOidcStart: vi.fn(async () => ({
        ok: true as const,
        value: {
          authorizationUrl: "https://id.example.corp/auth",
          completionKey: "synthetic-proof",
        },
      })),
    });
    const browser = {
      begin: vi.fn(),
      logout: vi.fn(),
      takeHandoff: () => null,
    };
    const accounts = new QaAccountsController({
      remote: api,
      storage: storage(),
      config: () => config,
      oidcBrowser: browser,
    });
    await accounts.start();
    render(
      <QaAuthGate
        accounts={accounts}
        snapshot={accounts.getSnapshot()}
        title="QA"
        logoUrl={null}
        allowRegistration={true}
        localLogin={false}
        oidcLabel="Войти корпоративной учётной записью"
      />,
    );
    expect(screen.queryByTestId("qa-surface-auth-email")).toBeNull();
    expect(screen.queryByTestId("qa-surface-auth-password")).toBeNull();
    expect(screen.queryByTestId("qa-surface-auth-forgot")).toBeNull();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", {
          name: "Войти корпоративной учётной записью",
        }),
      ),
    );
    expect(browser.begin).toHaveBeenCalledOnce();
    accounts.dispose();
  });

  it("returns to a usable gate on provider failure", async () => {
    const accounts = new QaAccountsController({
      remote: remote({
        accountsOidcStart: vi.fn(async () => ({
          ok: false as const,
          error: new Error("synthetic-provider-failure"),
        })),
      }),
      storage: storage(),
      config: () => config,
    });
    await accounts.start();
    await accounts.loginOidc();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "gate",
      busy: false,
      error: expect.any(String),
    });
    accounts.dispose();
  });

  it("does not redirect a newly signed-in account after a late logout response", async () => {
    let finish: (value: { ok: true; value: string }) => void = () => {};
    const api = remote({
      accountsOidcLogout: vi.fn(
        () =>
          new Promise<{ ok: true; value: string }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const browser = {
      begin: vi.fn(),
      logout: vi.fn(),
      takeHandoff: () => null,
    };
    const accounts = new QaAccountsController({
      remote: api,
      storage: storage(),
      config: () => config,
      oidcBrowser: browser,
    });
    await accounts.start();
    await accounts.login("reader@example.com", "synthetic-password");
    accounts.signOut();
    await accounts.login("other@example.com", "synthetic-password");
    finish({ ok: true, value: "https://id.example.corp/logout" });
    await Promise.resolve();
    expect(browser.logout).not.toHaveBeenCalled();
    accounts.dispose();
  });
});
