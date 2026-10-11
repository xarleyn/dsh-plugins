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

import type { QaMemoryFailure, QaUserMemoryOverview } from "../src/types.js";
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
  failure: null,
};

/**
 * What the Host's transport actually answers when the deployment does not let
 * this browser session reach the memory service: an RPC name, an endpoint and a
 * status, none of which the reader of the page can do anything with.
 */
const TRANSPORT_REFUSAL =
  "client api: openvikingMemory/userMemoryOverview failed: " +
  "transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 403";

function refused(
  message: string,
  code = "gateway/internal",
): RemoteResult<QaUserMemoryOverview> {
  return {
    ok: false,
    error: { code, message },
  } as unknown as RemoteResult<QaUserMemoryOverview>;
}

function unavailable(
  failure: QaMemoryFailure,
): RemoteResult<QaUserMemoryOverview> {
  return ok({
    ...OVERVIEW,
    connected: false,
    profile: null,
    groups: [],
    sessions: [],
    totals: { sections: 0, memories: 0, sessions: 0 },
    failure,
  });
}

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

  it("answers a store that cannot be read in the reader's own words", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () => unavailable("unreachable")),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const unavailableRow = await screen.findByTestId(
      "openviking-memory-unavailable",
    );
    expect(unavailableRow.textContent).toMatch(
      /Память недоступна: сервер памяти не отвечает/u,
    );
    // Capture keeps working while the store is away, and the page says so.
    expect(unavailableRow.textContent).toMatch(/не теряются/u);
  });

  it("names the operator where the store refuses this deployment", async () => {
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () => unavailable("refused")),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const unavailableRow = await screen.findByTestId(
      "openviking-memory-unavailable",
    );
    expect(unavailableRow.textContent).toMatch(/отклоняет запросы/u);
    expect(unavailableRow.textContent).toMatch(/оператор/u);
    // A store that answers 403 records nothing either, so the page may not
    // promise that the conversations are kept.
    expect(unavailableRow.textContent).not.toMatch(/не теряются/u);
  });

  it("shows its own sentence for a refused call and keeps the wire in the console", async () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () => refused(TRANSPORT_REFUSAL)),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const error = await screen.findByTestId("openviking-memory-error");
    expect(error.textContent).toMatch(
      /сервер не разрешает запрос этой сессии/u,
    );
    expect(error.textContent).toMatch(/оператор развёртывания/u);
    // The transport string is not the output path: no method, no endpoint and
    // no status may be read off the page.
    for (const internal of [
      "HTTP 403",
      "openvikingMemory",
      "/api/",
      "transport failure",
      "client api",
    ]) {
      expect(error.textContent).not.toContain(internal);
    }
    expect(screen.queryByTestId("openviking-memory-loading")).toBeNull();
    // The detail is not lost, only moved: it is what an operator greps with.
    expect(debug).toHaveBeenCalledWith(
      "dsh-openviking-memory: userMemoryOverview failed",
      expect.objectContaining({
        code: "gateway/internal",
        failure: "refused",
        detail: TRANSPORT_REFUSAL,
      }),
    );
    debug.mockRestore();
  });

  it("tells a stand that does not answer apart from one that refuses", async () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const cases: readonly {
      readonly wire: string;
      readonly copy: RegExp;
      /** What the console line is expected to name the same failure as. */
      readonly failure: string;
    }[] = [
      {
        wire: "client api: openvikingMemory/userMemoryOverview failed: transport failure for /api/openvikingMemory/userMemoryOverview: This operation was aborted",
        copy: /сервер развёртывания не отвечает/u,
        failure: "silent",
      },
      {
        wire: "client api: openvikingMemory/userMemoryOverview failed: transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 503",
        copy: /сервер развёртывания не отвечает/u,
        failure: "silent",
      },
      {
        wire: "client api: openvikingMemory/userMemoryOverview failed: transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 404",
        copy: /сервис памяти не запущен/u,
        failure: "absent",
      },
      {
        wire: "client api: openvikingMemory/userMemoryOverview failed: transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 401",
        copy: /Войдите заново/u,
        failure: "expired",
      },
    ];
    for (const { wire, copy, failure } of cases) {
      const remote = remoteWith({
        userMemoryOverview: vi.fn(async () => refused(wire)),
      });
      const Page = createMemoryOverviewSection(remote);
      const rendered = render(<Page token="token-a" />);

      const error = await screen.findByTestId("openviking-memory-error");
      expect(error.textContent).toMatch(copy);
      expect(error.textContent).not.toContain("client api");
      expect(debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ failure }),
      );
      rendered.unmount();
    }
    debug.mockRestore();
  });

  it("keeps an answer it cannot classify out of the page too", async () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () =>
        refused("The OpenViking Memory page needs a signed-in QA account."),
      ),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const error = await screen.findByTestId("openviking-memory-error");
    expect(error.textContent).toMatch(/не удалось прочитать/u);
    expect(error.textContent).not.toContain("signed-in QA account");
    expect(debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        detail: "The OpenViking Memory page needs a signed-in QA account.",
      }),
    );
    debug.mockRestore();
  });

  it("reads a call the gateway throws instead of answers as a stand that says nothing", async () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    // A browser left without its connection gets a throw, not a result
    // (`@deepseek-ai/dsh-api-gateway` `lib/types/client/index.js:276`).
    const thrown =
      "client api: openvikingMemory/userMemoryOverview has no active Connection";
    const remote = remoteWith({
      userMemoryOverview: vi.fn(async () => {
        throw new Error(thrown);
      }),
    });
    const Page = createMemoryOverviewSection(remote);

    render(<Page token="token-a" />);

    const error = await screen.findByTestId("openviking-memory-error");
    expect(error.textContent).toMatch(/сервер развёртывания не отвечает/u);
    expect(error.textContent).not.toContain("client api");
    expect(debug).toHaveBeenCalledWith(
      "dsh-openviking-memory: userMemoryOverview threw",
      expect.objectContaining({ detail: thrown }),
    );
    debug.mockRestore();
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
