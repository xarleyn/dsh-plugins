// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CredentialHelp } from "../src/credential-help.js";
import {
  CredentialHelpNote,
  credentialHelpView,
} from "../src/client/credential-help.js";

const GITHUB: CredentialHelp = {
  kind: "personal-access-token",
  label: "GitHub personal access token",
  obtain: {
    url: "https://github.com/settings/personal-access-tokens",
    label: "Создать токен",
  },
  docs: { url: "https://docs.github.com/en/authentication" },
  instructions:
    "Откройте настройки токенов GitHub.\nСоздайте fine-grained token.\nСкопируйте токен и вставьте его здесь.",
  scopes: ["Contents: Read and write", "Pull requests: Read and write"],
  notes: ["Токен действует от вашего имени."],
};

describe("CredentialHelpNote", () => {
  it("renders nothing at all when the integration declares no metadata", () => {
    const { container } = render(<CredentialHelpNote help={null} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("a")).toBeNull();
  });

  it("says how a personal access token is obtained and what it needs", () => {
    render(<CredentialHelpNote help={GITHUB} />);
    const trigger = screen.getByRole("button", { name: /Создать токен/u });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("GitHub personal access token")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByText(
      "GitHub personal access token",
    ).parentElement;
    expect(panel?.textContent).toContain("Откройте настройки токенов GitHub.");
    expect(panel?.textContent).toContain("Требуемые права");
    expect(panel?.textContent).toContain("Contents: Read and write");
    expect(panel?.textContent).toContain("Токен действует от вашего имени.");
    const links = [...(panel?.querySelectorAll("a") ?? [])].map((link) => ({
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
      text: link.textContent,
    }));
    expect(links).toEqual([
      {
        href: "https://github.com/settings/personal-access-tokens",
        target: "_blank",
        rel: "noopener noreferrer",
        text: "Создать токен",
      },
      {
        href: "https://docs.github.com/en/authentication",
        target: "_blank",
        rel: "noopener noreferrer",
        text: "Документация",
      },
    ]);

    fireEvent.click(trigger);
    expect(screen.queryByText("GitHub personal access token")).toBeNull();
  });

  it("words each credential mechanism in its own terms", () => {
    for (const [kind, action] of [
      ["api-key", "Создать API-ключ"],
      ["oauth", "Войти и авторизовать"],
      ["service-account", "Создать сервисный аккаунт"],
      ["app-password", "Создать пароль приложения"],
      ["custom", "Как получить доступ"],
    ] as const) {
      const { unmount } = render(
        <CredentialHelpNote
          help={{ kind, obtain: { url: "https://example.com/tokens" } }}
        />,
      );
      expect(screen.getByRole("link", { name: action })).toBeDefined();
      unmount();
    }
  });

  it("stands alone as a link when there is nothing else to explain", () => {
    const { container } = render(
      <CredentialHelpNote
        help={{
          kind: "api-key",
          obtain: {
            url: "https://example.com/keys",
            label: "Создать API-ключ",
          },
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "Создать API-ключ" });
    expect(link.getAttribute("href")).toBe("https://example.com/keys");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("Создать API-ключ");
  });

  it("describes a sign-in that has no token to create", () => {
    render(
      <CredentialHelpNote
        help={{
          kind: "oauth",
          docs: {
            url: "https://example.com/docs/oauth",
            label: "Об авторизации",
          },
          notes: ["Интеграция использует ваши существующие учётные данные."],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Об авторизации/u }));
    expect(
      screen.getByText(
        "Интеграция использует ваши существующие учётные данные.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Об авторизации" })).toBeDefined();
  });

  it("prefers the deployment wording and address over the declared ones", () => {
    render(
      <CredentialHelpNote
        help={{
          ...GITHUB,
          obtain: {
            url: "https://gitlab.example.internal/-/user_settings/tokens",
            label: "Выпустить токен",
          },
          selfHosted: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Выпустить токен/u }));
    expect(
      screen
        .getByRole("link", { name: "Выпустить токен" })
        .getAttribute("href"),
    ).toBe("https://gitlab.example.internal/-/user_settings/tokens");
  });

  it("never renders an address that could execute in the page", () => {
    const { container } = render(
      <CredentialHelpNote
        help={{
          kind: "custom",
          label: "Токен",
          obtain: { url: "javascript:alert(document.cookie)" },
          docs: { url: "data:text/html,<script>alert(1)</script>" },
          notes: ["Спросите у администратора."],
        }}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("data:text/html");
    fireEvent.click(screen.getByRole("button", { name: /Как это настроить/u }));
    expect(screen.getByText("Спросите у администратора.")).toBeDefined();
  });

  it("keeps a plain-http address only for a deployment that declared one", () => {
    const { unmount } = render(
      <CredentialHelpNote
        help={{
          kind: "api-key",
          selfHosted: true,
          obtain: { url: "http://gitlab.example.internal/tokens" },
        }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "http://gitlab.example.internal/tokens",
    );
    unmount();

    render(
      <CredentialHelpNote
        help={{
          kind: "api-key",
          obtain: { url: "http://gitlab.example.com/tokens" },
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("translates the instructions when the application knows the key", () => {
    const help: CredentialHelp = {
      kind: "api-key",
      obtain: { url: "https://example.com/keys" },
      instructions: "Declared English instructions.",
      instructionsLocaleKey: "integration.example.credentials.instructions",
      scopes: ["read"],
    };
    const view = credentialHelpView(help, (key) =>
      key === "integration.example.credentials.instructions"
        ? "Переведённая инструкция."
        : undefined,
    );
    expect(view?.steps).toEqual(["Переведённая инструкция."]);

    render(<CredentialHelpNote help={help} />);
    fireEvent.click(screen.getByRole("button", { name: /Создать API-ключ/u }));
    expect(screen.getByText("Declared English instructions.")).toBeDefined();
  });

  it("renders in a provider-card slot that only knows the metadata", () => {
    // The same component is reused wherever a card asks for a credential, the
    // Models page included: it takes metadata and renders links, nothing else.
    const { container } = render(
      <ul>
        <li className="dsh-plugin-card">
          <div className="dsh-plugin-card__body">
            <label>
              Z.AI API Key
              <input type="password" />
            </label>
            <CredentialHelpNote
              help={{
                kind: "api-key",
                obtain: {
                  url: "https://z.ai/manage-apikey/apikey-list",
                  label: "Создать API-ключ",
                },
                docs: { url: "https://docs.z.ai/api-reference" },
              }}
            />
          </div>
        </li>
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Создать API-ключ/u }));
    const hrefs = [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "https://z.ai/manage-apikey/apikey-list",
      "https://docs.z.ai/api-reference",
    ]);
    // The note renders metadata only: it never asks for, or echoes, a secret.
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });
});
