// @vitest-environment jsdom
/**
 * The account-scoped page: what a signed-in user sees about their own memory.
 * The page never invents an identity — the token from the dialog is the only
 * credential it carries — it only reads, and it says out loud when the store
 * turns out to be shared.
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

import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type { QaUserMemoryOverview } from "../src/types.js";
import {
  createMemoryOverviewSection,
  type MemoryOverviewRemote,
} from "../src/client/qa-settings.js";

const OVERVIEW: QaUserMemoryOverview = {
  connected: true,
  scoped: true,
  accountApplies: true,
  serverIdentity: "account-a",
  profile: {
    name: "identity.md",
    text: "Ассистент отвечает по-русски.",
    truncated: false,
  },
  groups: [
    {
      name: "cases",
      title: "Разборы",
      summary: "Разобранные случаи.",
      items: [{ name: "ftp_настройка", summary: "", folder: false }],
      total: 1,
    },
  ],
  sessions: [
    {
      id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
      summary: "Настраивали FTP.",
      updatedAt: "2026-09-22T06:29:01.000Z",
    },
  ],
  totals: { sections: 1, memories: 1, sessions: 1 },
  truncated: { memories: false, sessions: false },
  error: null,
};

function ok(value: QaUserMemoryOverview): RemoteResult<QaUserMemoryOverview> {
  return { ok: true, value } as RemoteResult<QaUserMemoryOverview>;
}

function remoteWith(
  overrides: Partial<MemoryOverviewRemote> = {},
): MemoryOverviewRemote {
  return {
    userMemoryOverview: vi.fn(async () => ok(OVERVIEW)),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("account-scoped memory page", () => {
  it("reads the account's memory with the token and shows what it holds", async () => {
    const remote = remoteWith();
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(remote.userMemoryOverview).toHaveBeenCalledWith("token-a");
    });
    const profile = await screen.findByTestId("openviking-memory-profile");
    expect(
      within(profile).getByRole("heading", {
        name: "Что ассистент о вас знает",
      }),
    ).toBeDefined();
    expect(
      screen.getByTestId("openviking-memory-profile-text").textContent,
    ).toBe("Ассистент отвечает по-русски.");
    const group = screen.getByTestId("openviking-memory-group");
    expect(
      within(group).getByTestId("openviking-memory-group-title").textContent,
    ).toBe("Разборы");
    expect(
      within(group).getByTestId("openviking-memory-item-name").textContent,
    ).toBe("ftp_настройка");
    expect(
      screen.getByTestId("openviking-memory-session-summary").textContent,
    ).toBe("Настраивали FTP.");
    // The counts are the store's totals, not the rows on screen.
    const totals = screen.getByTestId("openviking-memory-totals");
    expect(
      within(totals).getByTestId("openviking-memory-total-sections")
        .textContent,
    ).toBe("1разделов");
    expect(
      within(totals).getByTestId("openviking-memory-total-memories")
        .textContent,
    ).toBe("1записей");
    expect(
      within(totals).getByTestId("openviking-memory-total-sessions")
        .textContent,
    ).toBe("1разговоров");
    // Read-only page: nothing here writes to the store.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says the memory is shared when the server ignores the account", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        ok({
          ...OVERVIEW,
          accountApplies: false,
          serverIdentity: "deepseek-harness",
        }),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const refusal = await screen.findByTestId(
      "openviking-memory-identity-refused",
    );
    expect(refusal.textContent).toMatch(/содержимое памяти не показано/u);
    expect(refusal.textContent).toContain("deepseek-harness");
    expect(screen.queryByTestId("openviking-memory-profile-text")).toBeNull();
  });

  it("says so when the deployment does not separate accounts", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        ok({ ...OVERVIEW, scoped: false, accountApplies: false }),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const notice = await screen.findByTestId(
      "openviking-memory-notice-scoping-off",
    );
    expect(notice.textContent).toMatch(
      /Разделение памяти по пользователям в этом развёртывании/u,
    );
  });

  it("tells an empty memory apart from a broken one", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        ok({
          ...OVERVIEW,
          profile: null,
          groups: [],
          sessions: [],
          totals: { sections: 0, memories: 0, sessions: 0 },
        }),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const empty = await screen.findByTestId("openviking-memory-empty");
    expect(empty.textContent).toMatch(/Память пока пуста/u);
    expect(screen.queryByTestId("openviking-memory-unavailable")).toBeNull();
  });

  it("reports why the store could not be read", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        ok({
          ...OVERVIEW,
          connected: false,
          profile: null,
          groups: [],
          sessions: [],
          totals: { sections: 0, memories: 0, sessions: 0 },
          error: "fetch failed",
        }),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const unavailable = await screen.findByTestId(
      "openviking-memory-unavailable",
    );
    expect(unavailable.textContent).toMatch(/Память недоступна: fetch failed/u);
  });

  it("shows a refusal instead of inventing a state", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () => ({
        ok: false,
        error: { message: "Нужен вход в аккаунт QA." },
      })) as unknown as MemoryOverviewRemote["userMemoryOverview"],
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const error = await screen.findByTestId("openviking-memory-error");
    expect(error.textContent).toBe("Нужен вход в аккаунт QA.");
  });

  it("re-reads the memory on demand", async () => {
    const remote = remoteWith();
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);
    await screen.findByTestId("openviking-memory-group");
    const refresh = screen.getByTestId("openviking-memory-refresh");
    // The id is the handle; the caption a reader presses is still "Обновить".
    expect(screen.getByRole("button", { name: "Обновить" })).toBe(refresh);
    fireEvent.click(refresh);

    await waitFor(() => {
      expect(remote.userMemoryOverview).toHaveBeenCalledTimes(2);
    });
  });

  it("ignores an old token response and keeps the newer request busy", async () => {
    let resolveOld: (value: RemoteResult<QaUserMemoryOverview>) => void = () =>
      undefined;
    let resolveNew: (value: RemoteResult<QaUserMemoryOverview>) => void = () =>
      undefined;
    const oldResponse = new Promise<RemoteResult<QaUserMemoryOverview>>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    const newResponse = new Promise<RemoteResult<QaUserMemoryOverview>>(
      (resolve) => {
        resolveNew = resolve;
      },
    );
    const remote = remoteWith({
      userMemoryOverview: vi.fn((token: string) =>
        token === "token-old" ? oldResponse : newResponse,
      ),
    });
    const Page = createMemoryOverviewSection(remote);
    const rendered = render(<Page token="token-old" />);

    await waitFor(() => {
      expect(remote.userMemoryOverview).toHaveBeenCalledWith("token-old");
    });
    expect(screen.getByTestId("openviking-memory-loading").textContent).toBe(
      "Читаю память…",
    );
    rendered.rerender(<Page token="token-new" />);
    await waitFor(() => {
      expect(remote.userMemoryOverview).toHaveBeenCalledWith("token-new");
    });

    await act(async () => {
      resolveOld(
        ok({
          ...OVERVIEW,
          profile: { ...OVERVIEW.profile!, text: "old account" },
        }),
      );
    });
    expect(
      screen.queryByTestId("openviking-memory-profile-text")?.textContent,
    ).not.toBe("old account");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      resolveNew(
        ok({
          ...OVERVIEW,
          profile: { ...OVERVIEW.profile!, text: "new account" },
        }),
      );
    });
    expect(
      (await screen.findByTestId("openviking-memory-profile-text")).textContent,
    ).toBe("new account");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
