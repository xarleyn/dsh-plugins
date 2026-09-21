// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { QaSurfaceConfig } from "../src/types.js";
import { resolveConfig } from "../src/resolve-config.js";
import {
  BASE,
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
  it("warns when the data-usage notice is hidden", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...BASE,
          branding: { ...BASE.branding, disclaimer: "" },
        } as QaSurfaceConfig,
      },
    });
    openCard();
    expect(screen.getByText(/Плашка о данных скрыта/u)).toBeTruthy();
  });

  it("shows the phrases the Host runs when the namespace carries none", async () => {
    const { thinkingPhrases: _omitted, ...withoutPhrases } = BASE;
    await renderCard({
      snapshot: { value: withoutPhrases as QaSurfaceConfig },
      describe: async () => ({
        ok: true as const,
        value: resolveConfig({ thinkingPhrases: ["Точу", "Полирую"] }),
      }),
    });
    openCard();
    const field = within(section("Интерфейс")).getByLabelText(
      /Фразы ожидания/u,
    ) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(field.value).toBe("Точу\nПолирую");
    });
  });

  it("shows the built-in phrases before the Host answers", async () => {
    const { thinkingPhrases: _omitted, ...withoutPhrases } = BASE;
    await renderCard({
      snapshot: { value: withoutPhrases as QaSurfaceConfig },
      describe: async () => ({ ok: false as const, error: new Error("нет") }),
    });
    openCard();
    const field = within(section("Интерфейс")).getByLabelText(
      /Фразы ожидания/u,
    ) as HTMLTextAreaElement;
    expect(field.value.split("\n").length).toBeGreaterThan(1);
    expect(field.value).toContain("Скребу по сусекам…");
  });

  it("shows the stored phrases over the ones the Host resolved", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...BASE,
          thinkingPhrases: ["Своя фраза"],
        } as QaSurfaceConfig,
      },
      describe: async () => ({
        ok: true as const,
        value: resolveConfig({ thinkingPhrases: ["Точу", "Полирую"] }),
      }),
    });
    openCard();
    const field = within(section("Интерфейс")).getByLabelText(
      /Фразы ожидания/u,
    ) as HTMLTextAreaElement;
    expect(field.value).toBe("Своя фраза");
  });

  it("warns when reasoning and tool activity become visible", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...BASE,
          ui: { ...BASE.ui, showReasoning: true },
        } as QaSurfaceConfig,
      },
    });
    openCard();
    expect(screen.getByText(/становятся видны конечным/u)).toBeTruthy();
  });

  it("warns when embedding is open to a foreign origin", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...BASE,
          embedding: { frameAncestors: "https://portal.example" },
        } as QaSurfaceConfig,
      },
    });
    openCard();
    expect(screen.getByText(/Встраивание разрешено/u)).toBeTruthy();
  });

  it("marks the overridden fields and clears them all", async () => {
    const { mutate } = await renderCard({
      snapshot: { user: { enabled: false, route: { path: "/ask" } } },
    });
    openCard();

    expect(
      within(section("Доступ и маршрут")).getByText("изменено"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Сбросить 2 переопределения/u }),
    );
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      { op: "unset", path: ["enabled"] },
      { op: "unset", path: ["route"] },
    ]);
  });

  it("disables the controls while a remote browser cannot write", async () => {
    await renderCard({ snapshot: { writable: false } });
    openCard();
    const access = section("Доступ и маршрут");
    expect(
      (
        within(access).getByRole("checkbox", {
          name: /Страница включена/u,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a loading note until the first section arrives", async () => {
    await renderCard({ snapshot: { status: "loading", value: undefined } });
    openCard();
    expect(screen.getByText(/Загружаю настройки помощника/u)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Аккаунты/u })).toBeNull();
  });

  it("commits the declared profile fields as parsed entries", async () => {
    const { mutate } = await renderCard();
    openCard();

    const accounts = section("Аккаунты");
    const fields = within(accounts).getByLabelText(/Поля профиля/u);
    fireEvent.change(fields, { target: { value: "jira = Jira\nconfluence" } });
    fireEvent.blur(fields);
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      {
        op: "set",
        path: ["accounts", "profile", "identities"],
        value: [
          { key: "jira", label: "Jira" },
          { key: "confluence", label: "confluence" },
        ],
      },
    ]);
  });

  it("writes the attachment policy field by field", async () => {
    const { mutate } = await renderCard();
    openCard();

    const attachments = section("Вложения");
    fireEvent.click(within(attachments).getByLabelText(/Файловые вложения/u));
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      { op: "set", path: ["attachments", "textFiles"], value: false },
    ]);

    mutate.mockClear();
    const threshold = within(attachments).getByLabelText(/Переносить вставку/u);
    fireEvent.change(threshold, { target: { value: "80" } });
    fireEvent.blur(threshold);
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      { op: "set", path: ["attachments", "pastedTextLines"], value: 80 },
    ]);
  });

  it("shows the extension list in effect and stores the parsed one", async () => {
    const { mutate } = await renderCard();
    openCard();

    const field = within(section("Вложения")).getByLabelText(
      /Разрешённые расширения файлов/u,
    ) as HTMLTextAreaElement;
    // What matters is that the field shows the resolved list, not an empty
    // box for a setting that is doing something.
    expect(field.value.split("\n").length).toBeGreaterThan(5);
    fireEvent.change(field, { target: { value: "md, txt , log" } });
    fireEvent.blur(field);
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      {
        op: "set",
        path: ["attachments", "extensions"],
        value: ["md", "txt", "log"],
      },
    ]);
  });
});
