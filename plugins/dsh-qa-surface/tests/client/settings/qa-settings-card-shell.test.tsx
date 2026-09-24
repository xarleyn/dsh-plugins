// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { resolveConfig } from "../../../src/resolve-config.js";
import {
  openCard,
  renderCard,
  section,
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
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(screen.getByText("Помощник QA")).toBeTruthy();
    // The badge names what the Host serves, not what the form says.
    expect(
      container.querySelector(".dsh-plugin-card__badge")?.textContent,
    ).toBe("/assistant");
    expect(container.querySelector(".dsh-plugin-card__chevron")).not.toBeNull();
  });

  it("renders nothing when the settings namespace is unavailable", async () => {
    const { container } = await renderCard({
      snapshot: { status: "unavailable", value: undefined },
    });
    expect(container.innerHTML).toBe("");
  });

  it("opens into every configuration section", async () => {
    await renderCard();
    openCard();
    for (const title of [
      "Состояние",
      "Доступ и маршрут",
      "Оформление",
      "Сессия",
      "Интерфейс",
      "Блокировка",
      "Слеш-действия",
      "Аккаунты",
      "Источники",
      "Вложения",
      "Встраивание",
    ]) {
      expect(section(title)).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: /Скрыть настройки/u }),
    ).toBeTruthy();
  });

  it("shows the route, policy, and account gate the Host answered with", async () => {
    await renderCard();
    openCard();
    await waitFor(() => {
      expect(within(section("Состояние")).getByText("/assistant")).toBeTruthy();
    });
    const status = section("Состояние");
    expect(within(status).getByText("включены")).toBeTruthy();
    expect(within(status).getByText("только чтение")).toBeTruthy();
    expect(within(status).queryByText("выключены")).toBeNull();
  });

  it("says so when the Host has not answered yet", async () => {
    await renderCard({
      describe: async () => ({ ok: false, error: new Error("нет связи") }),
    });
    openCard();
    await waitFor(() => {
      expect(screen.getByText(/Хост ещё не ответил/u)).toBeTruthy();
    });
    expect(screen.getByText("нет связи")).toBeTruthy();
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
        within(section("Состояние")).getByText("формой в чате"),
      ).toBeTruthy();
    });
    // The seam is on, and nothing can ever ask: the status view names the half
    // that is missing instead of leaving a toggle that does nothing.
    expect(
      within(section("Состояние")).getByText(
        /не входит в список\s+разрешённых/u,
      ),
    ).toBeTruthy();
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
        within(section("Состояние")).getByText("отклоняются"),
      ).toBeTruthy();
    });
    expect(
      within(section("Состояние")).getByText(/каждый\s+запрос модели/u),
    ).toBeTruthy();
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
        within(section("Состояние")).getByText("формой в чате"),
      ).toBeTruthy();
    });
    expect(
      within(section("Состояние")).queryByText(/ask_user_question/u),
    ).toBeNull();
  });
});
