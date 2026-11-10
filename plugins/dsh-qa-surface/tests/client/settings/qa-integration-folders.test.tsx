// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaIntegrationTokensPage } from "../../../src/client/user-settings/IntegrationTokensPage.js";
import type { QaIntegrationTokenApi } from "../../../src/client/types.js";
import type { QaServiceTokenSummary } from "../../../src/types.js";

const key = "demo:history:account";
const folder = { id: "folder-api", name: "Запросы API", collapsed: false };
const token: QaServiceTokenSummary = {
  id: "token-demo",
  label: "Демо API",
  scopes: ["ask"],
  createdAt: "2026-11-09T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
  useCount: 0,
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(key, JSON.stringify({ folders: [folder] }));
});
afterEach(cleanup);
function api() {
  let summary = token;
  const create = vi.fn<QaIntegrationTokenApi["create"]>(async () => ({
    ok: false,
    error: "Демо отказ",
  }));
  const setFolder = vi.fn<NonNullable<QaIntegrationTokenApi["setFolder"]>>(
    async (_id, target) => {
      summary = { ...summary, historyFolder: target };
      return { ok: true, value: null };
    },
  );
  const result: QaIntegrationTokenApi = {
    canCreate: true,
    historyStorageKey: key,
    list: async () => ({ ok: true, value: [summary] }),
    create,
    revoke: async () => ({ ok: true, value: null }),
    setFolder,
  };
  return { result, create, setFolder };
}

describe("integration folder setting", () => {
  it("sends the selected destination when creating a token", async () => {
    const { result, create } = api();
    render(<QaIntegrationTokensPage api={result} />);
    const select = await screen.findByRole("combobox", {
      name: "Папка для новых чатов",
    });
    fireEvent.change(select, { target: { value: folder.id } });
    fireEvent.click(screen.getByRole("button", { name: "Создать токен" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          historyFolder: { id: folder.id, name: folder.name },
        }),
      ),
    );
  });
  it("updates and clears an existing token without replacing its credential", async () => {
    const { result, create, setFolder } = api();
    render(<QaIntegrationTokensPage api={result} />);
    const select = await screen.findByRole("combobox", {
      name: "Папка для новых чатов: Демо API",
    });
    fireEvent.change(select, { target: { value: folder.id } });
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe(folder.id),
    );
    expect(setFolder).toHaveBeenLastCalledWith(token.id, {
      id: folder.id,
      name: folder.name,
    });
    await waitFor(() =>
      expect((select as HTMLSelectElement).disabled).toBe(false),
    );
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() =>
      expect(setFolder).toHaveBeenLastCalledWith(token.id, null),
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("shows a server destination from another browser and retains it if saving fails", async () => {
    const { result, setFolder } = api();
    result.list = async () => ({
      ok: true,
      value: [
        { ...token, historyFolder: { id: "remote", name: "Серверная папка" } },
      ],
    });
    setFolder.mockResolvedValue({ ok: false, error: "Не удалось сохранить" });
    render(<QaIntegrationTokensPage api={result} />);
    const select = (await screen.findByRole("combobox", {
      name: "Папка для новых чатов: Демо API",
    })) as HTMLSelectElement;
    expect(select.value).toBe("remote");
    fireEvent.change(select, { target: { value: "" } });
    expect(await screen.findByText("Не удалось сохранить")).toBeTruthy();
    expect(select.value).toBe("remote");
  });
});
