// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import type { QaSurfaceConfig } from "../src/types.js";
import {
  BASE,
  errorPlate,
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
  it("writes a path-addressed mutation when a control changes", async () => {
    const { mutate } = await renderCard();
    openCard();

    const access = section("Доступ и маршрут");
    fireEvent.click(
      within(access).getByRole("checkbox", { name: /Страница включена/u }),
    );
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      { op: "set", path: ["enabled"], value: false },
    ]);
    expect(errorPlate()).toBeNull();
  });

  it("surfaces a refusal the scope settles silently", async () => {
    await renderCard({ refuse: true });
    openCard();

    const access = section("Доступ и маршрут");
    fireEvent.click(
      within(access).getByRole("checkbox", { name: /Страница включена/u }),
    );
    await settle();
    // A Host-rejected write settles the scope's promise instead of rejecting
    // it, so noticing that the section did not move is the card's own job.
    expect(errorPlate()?.textContent).toMatch(/Хост отклонил изменение/u);
    expect(
      (
        within(access).getByRole("checkbox", {
          name: /Страница включена/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    // A healthy status poll must not wipe the refusal: the value is still
    // unsaved, and a message that flashes and vanishes hides that.
    fireEvent.click(screen.getByRole("button", { name: /Обновить/u }));
    await settle();
    expect(errorPlate()?.textContent).toMatch(/Хост отклонил изменение/u);
  });

  it("treats a write that changed nothing as the no-op it is", async () => {
    await renderCard();
    openCard();

    const enabled = within(section("Доступ и маршрут")).getByRole("checkbox", {
      name: /Страница включена/u,
    });
    fireEvent.click(enabled);
    await settle();
    fireEvent.click(enabled);
    await settle();
    expect(errorPlate()).toBeNull();
  });

  it("writes a provider and its model in one mutation", async () => {
    const { mutate } = await renderCard();
    openCard();

    const session = section("Сессия");
    const model = within(session).getByLabelText(/Модель/u);
    fireEvent.change(model, { target: { value: "deepseek-chat" } });
    fireEvent.blur(model);
    await settle();
    expect(mutate).toHaveBeenCalledWith([
      { op: "set", path: ["session", "provider"], value: "" },
      { op: "set", path: ["session", "model"], value: "deepseek-chat" },
    ]);
  });

  it("turns per-user workspaces on together with their sandbox mode", async () => {
    const { mutate } = await renderCard({
      snapshot: {
        value: {
          ...BASE,
          accounts: { ...BASE.accounts, enabled: true },
        } as QaSurfaceConfig,
      },
    });
    openCard();

    const accounts = section("Аккаунты");
    fireEvent.click(
      within(accounts).getByRole("checkbox", {
        name: /Отдельное рабочее пространство/u,
      }),
    );
    await settle();
    // The Host refuses either half alone, so the card never writes one.
    expect(mutate).toHaveBeenCalledWith([
      { op: "set", path: ["accounts", "perUserWorkspace"], value: true },
      {
        op: "set",
        path: ["lockdown", "sandboxMode"],
        value: "workspace-write",
      },
    ]);
  });

  it("lists what per-user workspaces still need", async () => {
    await renderCard();
    openCard();
    expect(
      within(section("Аккаунты")).getByText(/Для персональных рабочих/u),
    ).toBeTruthy();
  });

  it("refuses the reset button the lockdown cross-check would reject", async () => {
    await renderCard();
    openCard();
    const ui = section("Интерфейс");
    const showReset = within(ui).getByRole("checkbox", {
      name: /Кнопка нового чата/u,
    });
    expect((showReset as HTMLInputElement).disabled).toBe(true);
    expect(within(ui).getByText(/Разрешить сброс сессии/u)).toBeTruthy();
  });

  it("warns while the lockdown is switched off", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...BASE,
          lockdown: { ...BASE.lockdown, enabled: false },
        } as QaSurfaceConfig,
      },
    });
    openCard();
    expect(screen.getByText(/Блокировка выключена/u)).toBeTruthy();
  });
});
