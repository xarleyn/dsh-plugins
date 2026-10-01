// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { resolveConfig } from "../../../src/resolve-config.js";
import {
  openCard,
  renderCard,
  section,
  sectionHeading,
  settle,
} from "./qa-settings-card.helpers.js";

afterEach(async () => {
  // The status poll settles after the assertions; flush it inside act so the
  // update is not reported as an unwrapped state change.
  await settle();
  cleanup();
});

describe("QA Surface card", () => {
  it("renders the canonical shell closed, badged with the served route", async () => {
    const { container } = await renderCard();
    expect(container.querySelector("li.dsh-plugin-card")).not.toBeNull();
    // The Plugins page's configuration column supplies no list of its own, so
    // the shell's `li` keeps a list of ours (AGENTS.md, card-shell contract).
    expect(container.querySelector("ul.qa-settings-cards")).not.toBeNull();
    expect(
      container.querySelector("li.dsh-plugin-card")?.parentElement?.tagName,
    ).toBe("UL");
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(screen.getByText("Помощник QA")).toBeTruthy();
    // The badge names what the Host serves, not what the form says.
    expect(
      container.querySelector(".dsh-plugin-card__badge")?.textContent,
    ).toBe("/assistant");
    expect(container.querySelector(".dsh-plugin-card__chevron")).not.toBeNull();
  });

  it("renders no card while the row's namespace answers unavailable", async () => {
    const { container } = await renderCard({
      snapshot: { status: "unavailable", value: undefined },
    });
    // The page's own heading and configure control are the Host's and stay;
    // what the plugin holds back is the card, and with it every control.
    expect(container.querySelector("li.dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("opens into every configuration section", async () => {
    await renderCard();
    openCard();
    const sections: ReadonlyArray<readonly [string, string]> = [
      ["qa-settings-status", "Состояние"],
      ["qa-settings-access", "Доступ и маршрут"],
      ["qa-settings-branding", "Оформление"],
      ["qa-settings-session", "Сессия"],
      ["qa-settings-interface", "Интерфейс"],
      ["qa-settings-lockdown", "Блокировка"],
      ["qa-settings-slash", "Слеш-действия"],
      ["qa-settings-accounts", "Аккаунты"],
      ["qa-settings-sources", "Источники"],
      ["qa-settings-attachments", "Вложения"],
      ["qa-settings-embedding", "Встраивание"],
    ];
    for (const [testId, title] of sections) {
      expect(sectionHeading(testId, title)).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: /Скрыть настройки/u }),
    ).toBeTruthy();
  });

  it("shows the route, policy, and account gate the Host answered with", async () => {
    await renderCard();
    openCard();
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-status-route").textContent,
      ).toContain("/assistant");
    });
    const status = section("qa-settings-status");
    expect(
      screen.getByTestId("qa-settings-status-accounts").textContent,
    ).toContain("включены");
    expect(
      screen.getByTestId("qa-settings-status-lockdown").textContent,
    ).toContain("только чтение");
    expect(status.textContent).not.toContain("выключены");
  });

  it("says so when the Host has not answered yet", async () => {
    await renderCard({
      describe: async () => ({ ok: false, error: new Error("нет связи") }),
    });
    openCard();
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-status-notice-host-silent").textContent,
      ).toMatch(/Хост ещё не ответил/u);
    });
    expect(screen.getByTestId("qa-settings-host-error").textContent).toBe(
      "нет связи",
    );
  });

  it("shows the question seam and warns when its tool is not allowed", async () => {
    await renderCard({
      describe: async () => ({
        ok: true as const,
        value: resolveConfig({
          route: { path: "/assistant" },
          lockdown: { toolPolicy: { allow: ["read"] } },
          interaction: { questions: "interactive" },
        }),
      }),
    });
    openCard();
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-status-questions").textContent,
      ).toContain("формой в чате");
    });
    // The seam is on, and nothing can ever ask: the status view names the half
    // that is missing instead of leaving a toggle that does nothing.
    expect(
      screen.getByTestId("qa-settings-status-notice-tool-missing").textContent,
    ).toMatch(/не входит в список\s+разрешённых/u);
  });

  it("warns when the question tool is allowed but questions are refused", async () => {
    await renderCard({
      describe: async () => ({
        ok: true as const,
        value: resolveConfig({
          route: { path: "/assistant" },
          lockdown: { toolPolicy: { allow: ["read", "ask_user_question"] } },
          interaction: { questions: "unsupported" },
        }),
      }),
    });
    openCard();
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-status-questions").textContent,
      ).toContain("отклоняются");
    });
    expect(
      screen.getByTestId("qa-settings-status-notice-tool-refused").textContent,
    ).toMatch(/каждый\s+запрос модели/u);
  });

  it("stays quiet while the question seam and the tool policy agree", async () => {
    await renderCard({
      describe: async () => ({
        ok: true as const,
        value: resolveConfig({
          route: { path: "/assistant" },
          lockdown: { toolPolicy: { allow: ["read", "ask_user_question"] } },
          interaction: { questions: "interactive" },
        }),
      }),
    });
    openCard();
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-status-questions").textContent,
      ).toContain("формой в чате");
    });
    expect(section("qa-settings-status").textContent).not.toContain(
      "ask_user_question",
    );
  });
});
