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
    expect(await screen.findByText("Что ассистент о вас знает")).toBeDefined();
    expect(screen.getByText("Ассистент отвечает по-русски.")).toBeDefined();
    expect(screen.getByText("Разборы")).toBeDefined();
    expect(screen.getByText("ftp_настройка")).toBeDefined();
    expect(screen.getByText("Настраивали FTP.")).toBeDefined();
    // The counts are the store's totals, not the rows on screen.
    expect(screen.getByText("разделов")).toBeDefined();
    expect(screen.getByText("записей")).toBeDefined();
    expect(screen.getByText("разговоров")).toBeDefined();
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

    await waitFor(() => {
      expect(screen.getByText(/содержимое памяти не показано/u)).toBeDefined();
    });
    expect(screen.getByText(/deepseek-harness/u)).toBeDefined();
    expect(screen.queryByText("Ассистент отвечает по-русски.")).toBeNull();
  });

  it("says so when the deployment does not separate accounts", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        ok({ ...OVERVIEW, scoped: false, accountApplies: false }),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Разделение памяти по пользователям в этом развёртывании/u,
        ),
      ).toBeDefined();
    });
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

    await waitFor(() => {
      expect(screen.getByText(/Память пока пуста/u)).toBeDefined();
    });
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

    await waitFor(() => {
      expect(
        screen.getByText(/Память недоступна: fetch failed/u),
      ).toBeDefined();
    });
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

    await waitFor(() => {
      expect(screen.getByText("Нужен вход в аккаунт QA.")).toBeDefined();
    });
  });

  it("re-reads the memory on demand", async () => {
    const remote = remoteWith();
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);
    await screen.findByText("Разборы");
    fireEvent.click(screen.getByText("Обновить"));

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
    expect(screen.queryByText("old account")).toBeNull();
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
    expect(await screen.findByText("new account")).toBeDefined();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
