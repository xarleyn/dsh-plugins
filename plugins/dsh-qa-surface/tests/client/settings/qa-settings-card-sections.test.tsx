// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { QaSurfaceConfig } from "../../../src/types.js";
import { QA_MAX_ACTIVE_REQUESTS_MAX } from "../../../src/config-resolvers/session.js";
import { resolveConfig } from "../../../src/resolve-config.js";
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
    expect(
      screen.getByTestId("qa-settings-branding-notice-disclaimer-hidden")
        .textContent,
    ).toMatch(/Плашка о данных скрыта/u);
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
    const field = screen.getByTestId(
      "qa-settings-interface-thinking-phrases",
    ) as HTMLTextAreaElement;
    // The hook and the label the operator reads name the same control.
    expect(
      within(section("qa-settings-interface")).getByLabelText(
        /Фразы ожидания/u,
      ),
    ).toBe(field);
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
    const field = screen.getByTestId(
      "qa-settings-interface-thinking-phrases",
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
    const field = screen.getByTestId(
      "qa-settings-interface-thinking-phrases",
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
    expect(
      screen.getByTestId("qa-settings-interface-notice-internals-visible")
        .textContent,
    ).toMatch(/становятся видны конечным/u);
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
    expect(
      screen.getByTestId("qa-settings-embedding-notice-open").textContent,
    ).toMatch(/Встраивание разрешено/u);
  });

  it("marks the overridden fields and clears them all", async () => {
    const { mutate } = await renderCard({
      snapshot: { user: { enabled: false, route: { path: "/ask" } } },
    });
    openCard();

    expect(screen.getByTestId("qa-settings-access-modified").textContent).toBe(
      "изменено",
    );
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
    const access = section("qa-settings-access");
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
    expect(screen.getByTestId("qa-settings-loading").textContent).toMatch(
      /Загружаю настройки помощника/u,
    );
    expect(screen.queryByRole("heading", { name: /^Аккаунты/u })).toBeNull();
  });

  it("commits the declared profile fields as parsed entries", async () => {
    const { mutate } = await renderCard();
    openCard();

    const fields = screen.getByTestId(
      "qa-settings-accounts-profile-identities",
    );
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

    const attachments = section("qa-settings-attachments");
    fireEvent.click(screen.getByTestId("qa-settings-attachments-text-files"));
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

  it("bounds the request ceiling by the number the Host validator enforces", async () => {
    // Every field in this card states its limits as a literal rather than
    // importing the resolver's constant, so the browser bundle stays free of the
    // Host's config surface. That is a deal, and this is its half: raise the
    // validator without raising the field, and the card silently refuses a value
    // the deployment would have honoured.
    await renderCard();
    openCard();
    const field = within(section("qa-settings-session")).getByLabelText(
      /Максимум одновременных вопросов/u,
    ) as HTMLInputElement;
    expect(field.min).toBe("0");
    expect(field.max).toBe(String(QA_MAX_ACTIVE_REQUESTS_MAX));
  });

  it("shows the extension list in effect and stores the parsed one", async () => {
    const { mutate } = await renderCard();
    openCard();

    const field = screen.getByTestId(
      "qa-settings-attachments-extensions",
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
