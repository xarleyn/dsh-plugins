import { afterEach, describe, expect, it } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { QaIntegrationService } from "../../src/integration/service.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { normalizeHistoryFolder } from "../../src/shared/history-folder.js";
import { store } from "../accounts/accounts.helpers.js";

const FOLDER = { id: "folder-api", name: "Запросы API" };
const SECOND = { id: "folder-other", name: "Обработка" };
const stores: QaAccounts[] = [];
afterEach(() => {
  for (const accounts of stores.splice(0)) accounts.close();
});
const openStore = () => {
  const accounts = store();
  stores.push(accounts);
  return accounts;
};

describe("integration virtual folder routing", () => {
  it("persists the token destination and session snapshot, and scopes hints to the owner", () => {
    let accounts = openStore();
    const owner = accounts.register("owner@example.test", "password-one");
    const other = accounts.register("other@example.test", "password-two");
    const token = accounts.mintServiceToken(owner.token, {
      historyFolder: FOLDER,
    });
    accounts.claimSessions(owner.token, ["session-api"]);
    accounts.recordIntegrationSessionFolder(
      owner.user.id,
      "session-api",
      FOLDER,
    );
    accounts.recordIntegrationSessionFolder(
      other.user.id,
      "session-api",
      SECOND,
    );
    expect(
      accounts.ownedSessionsWithFolders(other.token).integrationFolders,
    ).toBeUndefined();
    expect(
      accounts.setServiceTokenHistoryFolder(other.token, token.id, SECOND),
    ).toBe(false);
    expect(accounts.verifyServiceToken(token.token)?.historyFolder).toEqual(
      FOLDER,
    );
    expect(
      accounts.setServiceTokenHistoryFolder(owner.token, token.id, SECOND),
    ).toBe(true);
    const file = accounts.filePath;
    accounts.close();
    stores.splice(stores.indexOf(accounts), 1);
    accounts = new QaAccounts(file, {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
    stores.push(accounts);
    expect(accounts.listServiceTokens(owner.token)[0]?.historyFolder).toEqual(
      SECOND,
    );
    expect(
      accounts.ownedSessionsWithFolders(owner.token).integrationFolders,
    ).toEqual({ "session-api": FOLDER });
    expect(
      accounts.setServiceTokenHistoryFolder(owner.token, token.id, null),
    ).toBe(true);
    expect(
      accounts.verifyServiceToken(token.token)?.historyFolder,
    ).toBeUndefined();
    accounts.revokeServiceToken(owner.token, token.id);
    expect(
      accounts.setServiceTokenHistoryFolder(owner.token, token.id, FOLDER),
    ).toBe(false);
  });

  it("routes a new API conversation before its answer, while continuations retain the original destination", async () => {
    const accounts = openStore();
    const owner = accounts.register("api-owner@example.test", "password-one");
    const token = accounts.mintServiceToken(owner.token, {
      historyFolder: FOLDER,
    });
    let sequence = 0;
    const service = new QaIntegrationService({
      getConfig: () =>
        resolveConfig({
          accounts: { enabled: true },
          integration: { enabled: true },
        }),
      accounts: () => accounts,
      version: "0.20.0",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
      runner: {
        models: async () => [],
        transcript: async () => ({
          chatId: "session-api",
          messages: [],
          lastSeq: 0,
          truncated: false,
        }),
        run: async (input) => {
          const id = input.chatId ?? `session-${++sequence}`;
          accounts.claimSessions(owner.token, [id]);
          input.onChat?.(id);
          expect(
            accounts.ownedSessionsWithFolders(owner.token).integrationFolders?.[
              id
            ],
          ).toBeDefined();
          return {
            chatId: id,
            answer: "Готово",
            sources: [],
            interrupted: false,
          };
        },
      },
    });
    const request = {
      message: "Подготовить документ",
      version: null,
      sessionId: null,
      context: { ticketKey: null, reporter: null, reporterName: null },
      attachments: [],
    };
    const first = await service.ask(
      `Bearer ${token.token}`,
      request,
      new AbortController().signal,
    );
    accounts.setServiceTokenHistoryFolder(owner.token, token.id, SECOND);
    await service.ask(
      `Bearer ${token.token}`,
      { ...request, sessionId: first.chatId },
      new AbortController().signal,
    );
    const second = await service.ask(
      `Bearer ${token.token}`,
      request,
      new AbortController().signal,
    );
    expect(
      accounts.ownedSessionsWithFolders(owner.token).integrationFolders,
    ).toEqual({ [first.chatId]: FOLDER, [second.chatId]: SECOND });
  });

  it("accepts a cleared destination and rejects malformed metadata", () => {
    expect(normalizeHistoryFolder(null)).toBeNull();
    expect(
      normalizeHistoryFolder({ id: "folder-api", name: "  Запросы API  " }),
    ).toEqual(FOLDER);
    for (const folder of [
      { id: "../workspace", name: "Папка" },
      { id: "api", name: "" },
      { id: "api", name: "x".repeat(81) },
      { id: "api", name: "line\nname" },
    ]) {
      expect(() => normalizeHistoryFolder(folder)).toThrow(TypeError);
    }
  });
});
