// @vitest-environment jsdom
/**
 * The body the Plugins page mounts for this seat.
 *
 * The row's page owns the chrome: it paints the card surface, the heading, the
 * row id and the expand control, and mounts the registrant's `page` view under
 * its configuration section. What this bundle supplies is therefore the body
 * alone — a shell of ours would draw a second frame and a second heading inside
 * the first (AGENTS.md, card-shell contract). The assertions below are the
 * renderable half of that rule; the built bundle is held to it by the package
 * gate, which reads the seat off `lib/client.js`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { resolveConfig } from "../../../src/resolve-config.js";
import {
  EFFECTIVE,
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

describe("QA Surface card body", () => {
  it("mounts the configuration as the page's body, with no shell of ours", async () => {
    const { container } = await renderCard();
    // The body is the root: no list around it, no card frame inside the page's
    // own card, and no toggle duplicating the row's expand control.
    expect(container.firstElementChild?.className).toBe("qa-card-body");
    expect(container.querySelector("ul,li,article")).toBeNull();
    expect(container.querySelector("[class*='dsh-plugin-card']")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(
      container.querySelector("[aria-expanded], [class*='chevron']"),
    ).toBeNull();
    // The heading and the badge the shell used to carry are the page's and the
    // status section's: the route the Host serves is still named, once.
    expect(screen.queryByText("Помощник QA")).toBeNull();
    expect(
      screen.getByTestId("qa-settings-status-route").textContent,
    ).toContain("/assistant");
  });

  it("opens into every configuration section without an expand step", async () => {
    await renderCard();
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
  });

  it("names why the column is empty while the namespace answers unavailable", async () => {
    const poll = vi.fn(async () => ({
      ok: true as const,
      value: EFFECTIVE,
    }));
    const { container } = await renderCard({
      snapshot: { status: "unavailable", value: undefined },
      describe: poll,
    });
    // The page's own heading and configure control are the Host's and stay; the
    // body answers with the reason, and with no control to write through.
    expect(screen.getByTestId("qa-settings-unavailable").textContent).toContain(
      "не отдаёт",
    );
    expect(container.firstElementChild?.tagName).toBe("P");
    expect(screen.queryByTestId("qa-settings-status")).toBeNull();
    expect(screen.queryByTestId("qa-settings-access")).toBeNull();
    // Nothing reads the effective configuration here, so the poll that would
    // feed it never starts.
    expect(poll).not.toHaveBeenCalled();
  });

  it("shows the route, policy, and account gate the Host answered with", async () => {
    await renderCard();
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
