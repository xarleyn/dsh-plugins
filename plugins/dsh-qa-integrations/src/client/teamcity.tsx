import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { CredentialHelpNote } from "@yadsh/dsh-plugin-kit/client";
import { useState } from "react";
import type {
  IntegrationInstanceSummary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard } from "./provider-card.js";

export interface TeamcityRemote {
  getTeamcity(token: string): Promise<RemoteResult<IntegrationSummary>>;
  /**
   * The address this deployment dials, or null when it configured none. The
   * connect form shows it and never asks for it: the server one token is spent
   * against is stand-wide configuration, not a choice each user makes.
   */
  teamcityServer(
    token: string,
  ): Promise<RemoteResult<IntegrationInstanceSummary | null>>;
  putTeamcityCredential(
    token: string,
    input: { readonly token: string },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testTeamcity(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchTeamcityPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectTeamcity(token: string): Promise<RemoteResult<boolean>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential:
    "Проверьте access token: адрес TeamCity задаёт оператор стенда.",
  ProviderPermissionDenied:
    "TeamCity не разрешил это действие: проверьте права токена на нужные проекты.",
  ProviderUnavailable:
    "TeamCity недоступен с этого стенда. Проверьте адрес, заданный оператором, и сетевую доступность.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked: "TeamCity отклонил токен. Создайте новый и замените его.",
  ResourceNotFound: "TeamCity не нашёл ресурс или токен его не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ TeamCity слишком большой для одного запроса.",
  UpstreamTimeout: "TeamCity не ответил вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат TeamCity не принят стендом. Нужен сертификат, которому доверяет сервер.",
};

interface TeamcityExtra {
  /** undefined while the answer is on its way, null when this deployment
   * configured no address at all. */
  readonly server: IntegrationInstanceSummary | null | undefined;
  setServer(server: IntegrationInstanceSummary | null): void;
}

export function createTeamcityCard(remote: TeamcityRemote) {
  return createProviderCard<TeamcityExtra>({
    title: "TeamCity",
    portalFallback: "Сборки, тесты и причины падений вашего CI",
    accountFallback: "Пользователь TeamCity",
    errorCopy: ERROR_COPY,
    notGrantedText: "Выключено оператором стенда",
    futurePermissions: ["Запуск, отмена и комментарии к сборке"],
    useExtra: () => {
      const [server, setServer] = useState<
        IntegrationInstanceSummary | null | undefined
      >(undefined);
      return { server, setServer };
    },
    load: async ({ token, extra, accept, fail }) => {
      const address = await remote.teamcityServer(token);
      if (!address.ok) {
        fail(address.error);
        return;
      }
      extra.setServer(address.value);
      accept(await remote.getTeamcity(token));
    },
    calls: {
      save: (token, credential) =>
        remote.putTeamcityCredential(token, { token: credential }),
      test: (token) => remote.testTeamcity(token),
      patch: (token, patch) => remote.patchTeamcityPolicy(token, patch),
      disconnect: (token) => remote.disconnectTeamcity(token),
    },
    credentialSection: (state, help) => {
      const server = state.extra.server;
      const configured = server !== null && server !== undefined;
      if (!configured) return null;
      return (
        <div className="dsh-qa-integrations__section">
          <span className="dsh-qa-integrations__muted">
            Адрес TeamCity: {server.label ?? ""} — задан оператором стенда
          </span>
          <label className="dsh-qa-integrations__field">
            Access token TeamCity
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
            />
          </label>
          <CredentialHelpNote help={help} />
          <p className="dsh-qa-integrations__hint">
            Токен хранится в зашифрованном виде и после сохранения не
            отображается.
          </p>
          <div className="dsh-qa-integrations__actions">
            <button
              className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
              type="button"
              disabled={state.busy || state.credential.trim() === ""}
              onClick={state.save}
            >
              Сохранить и проверить
            </button>
            {state.connected ? (
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={state.busy}
                onClick={state.cancelCredential}
              >
                Отмена
              </button>
            ) : null}
          </div>
        </div>
      );
    },
    notConfiguredHint: (state) =>
      state.extra.server === null ? (
        <p className="dsh-qa-integrations__hint">
          Оператор не настроил адрес TeamCity, подключать нечего. Адрес стенда
          задаётся в конфигурации развёртывания — он один на всех.
        </p>
      ) : null,
  });
}
