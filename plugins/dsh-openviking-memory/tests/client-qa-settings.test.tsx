// @vitest-environment jsdom
/**
 * The account-scoped page: what a signed-in user sees, and what each click
 * sends. The page never invents an identity — the token from the dialog is the
 * only credential it carries — so a refusal is surfaced rather than retried.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type { QaUserMemorySettingsView } from "../src/types.js";
import {
  createMemorySettingsSection,
  type MemoryClientRemote,
} from "../src/client/qa-settings.js";

const INHERIT: QaUserMemorySettingsView = {
  autoInject: null,
  profile: null,
  recall: null,
  effective: { startupProfile: true, stepProfile: true, recall: true },
  configured: { startupProfile: true, stepProfile: true, recall: true },
  scoped: true,
};

function ok(
  value: QaUserMemorySettingsView,
): RemoteResult<QaUserMemorySettingsView> {
  return { ok: true, value } as RemoteResult<QaUserMemorySettingsView>;
}

/**
 * Apply a patch the way the Host does: the switches narrow `configured`, and
 * the answer carries the plan that now applies.
 */
function narrow(
  base: QaUserMemorySettingsView,
  patch: {
    autoInject?: boolean | null;
    profile?: boolean | null;
    recall?: boolean | null;
  },
): QaUserMemorySettingsView {
  const next = { ...base, ...patch };
  const master = next.autoInject !== false;
  const profile = master && next.profile !== false;
  return {
    ...next,
    effective: {
      startupProfile: base.configured.startupProfile && profile,
      stepProfile: base.configured.stepProfile && profile,
      recall: base.configured.recall && master && next.recall !== false,
    },
  };
}

function remoteWith(
  overrides: Partial<MemoryClientRemote> = {},
): MemoryClientRemote {
  return {
    userMemorySettings: vi.fn(async () => ok(INHERIT)),
    setUserMemorySettings: vi.fn(async (_token, patch) =>
      ok(narrow(INHERIT, patch)),
    ),
    resetUserMemorySettings: vi.fn(async () => ok(INHERIT)),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("account-scoped memory page", () => {
  it("renders the effective switches and calls the Remote with the token", async () => {
    const remote = remoteWith();
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(remote.userMemorySettings).toHaveBeenCalledWith("token-a");
    });
    const master = await screen.findByLabelText("Автоматическая память");
    expect((master as HTMLInputElement).checked).toBe(true);
    // The status line reports what actually happens, not what was asked for.
    expect(
      screen.getByText("Сейчас: профиль, автоматический поиск."),
    ).toBeDefined();
  });

  it("keeps each row on its own switch and reports the narrowed plan", async () => {
    const masterOff: QaUserMemorySettingsView = {
      ...INHERIT,
      autoInject: false,
      effective: { startupProfile: false, stepProfile: false, recall: false },
    };
    const remote = remoteWith({
      userMemorySettings: vi.fn(async () => ok(masterOff)),
    });
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);

    // The granular rows keep the account's own value; the line below says the
    // master switch silences both of them.
    await waitFor(() => {
      expect(
        (
          screen.getByLabelText(
            "Профиль в начале разговора",
          ) as HTMLInputElement
        ).checked,
      ).toBe(true);
    });
    expect(
      (screen.getByLabelText("Автоматическая память") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      screen.getByText("Сейчас: без профиля, без автоматического поиска."),
    ).toBeDefined();
  });

  it("writes one switch without touching the others", async () => {
    const remote = remoteWith();
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);
    const search = await screen.findByLabelText(
      "Автоматический поиск по памяти",
    );
    fireEvent.click(search);

    await waitFor(() => {
      expect(remote.setUserMemorySettings).toHaveBeenCalledWith("token-a", {
        recall: false,
      });
    });
    await waitFor(() => {
      expect(
        (
          screen.getByLabelText(
            "Автоматический поиск по памяти",
          ) as HTMLInputElement
        ).checked,
      ).toBe(false);
    });
  });

  it("marks an account's own override and offers the way back", async () => {
    const overridden: QaUserMemorySettingsView = {
      ...INHERIT,
      autoInject: false,
      effective: { startupProfile: false, stepProfile: false, recall: false },
    };
    const remote = remoteWith({
      userMemorySettings: vi.fn(async () => ok(overridden)),
    });
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(screen.getByText("своя настройка")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Вернуть как в развёртывании"));
    await waitFor(() => {
      expect(remote.resetUserMemorySettings).toHaveBeenCalledWith("token-a");
    });
  });

  it("shows a refusal instead of inventing a state", async () => {
    const remote = remoteWith({
      userMemorySettings: vi.fn(async () => ({
        ok: false,
        error: { message: "Нужен вход в аккаунт QA." },
      })) as unknown as MemoryClientRemote["userMemorySettings"],
    });
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(screen.getByText("Нужен вход в аккаунт QA.")).toBeDefined();
    });
  });

  it("says so when the deployment does not separate accounts", async () => {
    const remote = remoteWith({
      userMemorySettings: vi.fn(async () => ok({ ...INHERIT, scoped: false })),
    });
    const Page = createMemorySettingsSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Разделение памяти по пользователям в этом развёртывании/,
        ),
      ).toBeDefined();
    });
  });
});
