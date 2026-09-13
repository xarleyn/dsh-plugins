// @vitest-environment jsdom
/**
 * The QA Surface settings card: the shell contract, the path-addressed writes
 * behind the controls, the paired writes the Host's cross-checks force, and
 * the state the `qaSurface/describe` Remote feeds the status view.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import type { QaSurfaceConfig } from "../src/types.js";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSettingsCard } from "../src/client/settings/card.js";

const BASE = resolveConfig({});

const EFFECTIVE = resolveConfig({
  route: { path: "/assistant" },
  accounts: { enabled: true },
});

type ScopeSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value: QaSurfaceConfig | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: "host" | "memory";
};

/** One operation as the card sends it over the scope. */
interface PathOp {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: unknown;
}

function setPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cursor = root;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    cursor[segment] =
      typeof next === "object" && next !== null
        ? next
        : ({} as Record<string, unknown>);
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1] as string] = value;
}

function unsetPath(
  root: Record<string, unknown>,
  path: readonly string[],
): void {
  let cursor: Record<string, unknown> | undefined = root;
  for (const segment of path.slice(0, -1)) {
    if (cursor === undefined) return;
    const next: unknown = cursor[segment];
    cursor =
      typeof next === "object" && next !== null
        ? (next as Record<string, unknown>)
        : undefined;
  }
  if (cursor !== undefined) delete cursor[path[path.length - 1] as string];
}

/**
 * A settings document that behaves like the Host: an accepted write lands in
 * the section and advances the revision, a write that changes nothing leaves
 * the revision alone, and a refused write (`refuse`) does neither — while the
 * promise still settles, which is exactly what the card has to survive.
 */
function makeScope(
  snapshot: Partial<ScopeSnapshot> = {},
  refuse = false,
): { scope: unknown; mutate: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>();
  const current: ScopeSnapshot = {
    status: "ready",
    value: BASE,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: "host",
    ...snapshot,
  };
  const mutate = vi.fn(async (ops: readonly PathOp[]) => {
    if (refuse) return;
    const value = structuredClone(current.value) as Record<string, unknown>;
    const user = structuredClone(current.user ?? {}) as Record<string, unknown>;
    for (const op of ops) {
      if (op.op === "set") {
        setPath(value, op.path, op.value);
        setPath(user, op.path, op.value);
      } else {
        unsetPath(value, op.path);
        unsetPath(user, op.path);
      }
    }
    const changed = JSON.stringify(value) !== JSON.stringify(current.value);
    current.value = value as QaSurfaceConfig;
    current.user = user;
    if (changed) current.revision = (current.revision ?? 0) + 1;
    for (const listener of listeners) listener();
  });
  return {
    mutate,
    scope: {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      mutate,
      set: () => Promise.resolve(),
      unset: () => Promise.resolve(),
    },
  };
}

type DescribeResult =
  { ok: true; value: typeof EFFECTIVE } | { ok: false; error: unknown };

/** The slot runtime props do not exist outside the host; only the face does. */
const Card = QaSettingsCard as unknown as (props: {
  scope: unknown;
  describe: () => Promise<DescribeResult>;
}) => ReactElement;

async function renderCard(
  options: {
    snapshot?: Partial<ScopeSnapshot>;
    refuse?: boolean;
    describe?: () => Promise<DescribeResult>;
  } = {},
) {
  const { scope, mutate } = makeScope(
    options.snapshot,
    options.refuse ?? false,
  );
  const describe =
    options.describe ?? (async () => ({ ok: true as const, value: EFFECTIVE }));
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; awaiting inside act keeps that first update
  // inside the test rather than after it.
  await act(async () => {
    result = render(<Card scope={scope} describe={describe} />);
    await Promise.resolve();
  });
  return {
    container: (result as ReturnType<typeof render>).container,
    mutate,
  };
}

function openCard(): void {
  fireEvent.click(
    screen.getByRole("button", { name: /Показать настройки: Помощник QA/u }),
  );
}

function section(title: string): HTMLElement {
  const heading = screen.getByRole("heading", {
    name: new RegExp(`^${title}`, "u"),
  });
  return heading.closest("section") as HTMLElement;
}

/** The plate a refused or failed write raises, when there is one. */
function errorPlate(): HTMLElement | null {
  return document.querySelector(".qa-card-error");
}

/** Settle a queued mutation and the render it triggers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
      "Аккаунты",
      "Источники",
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
});
