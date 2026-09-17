import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { CredentialHelpNote } from "@yadsh/dsh-plugin-kit/client";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createProviderCard } from "./provider-card.js";

export interface IntegrationsRemote {
  describe(): Promise<
    RemoteResult<{
      readonly enabled: boolean;
      /** Ids of the providers this deployment mounted, in card order. */
      readonly providers: readonly string[];
    }>
  >;
  getBitrix24(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putBitrix24Credential(
    token: string,
    input: { readonly token: string },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testBitrix24(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchBitrix24Policy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectBitrix24(token: string): Promise<RemoteResult<boolean>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential: "Проверьте URL входящего вебхука Bitrix24.",
  ProviderPermissionDenied: "Bitrix24 не разрешил это действие.",
  ProviderUnavailable: "Bitrix24 сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия подключения истёк. Замените токен.",
  CredentialRevoked: "Подключение больше не действует. Замените токен.",
};

export function createBitrix24Card(remote: IntegrationsRemote) {
  return createProviderCard({
    title: "Bitrix24",
    portalFallback: "CRM и чаты вашей компании",
    accountFallback: "Пользователь Bitrix24",
    errorCopy: ERROR_COPY,
    notGrantedText: "Нет разрешения Bitrix24",
    futurePermissions: ["Отправлять сообщения", "Изменять CRM"],
    useExtra: () => undefined,
    load: async ({ token, accept }) => {
      accept(await remote.getBitrix24(token));
    },
    calls: {
      save: (token, credential) =>
        remote.putBitrix24Credential(token, { token: credential }),
      test: (token) => remote.testBitrix24(token),
      patch: (token, patch) => remote.patchBitrix24Policy(token, patch),
      disconnect: (token) => remote.disconnectBitrix24(token),
    },
    credentialSection: (state, help) => (
      <div className="dsh-qa-integrations__section">
        <label className="dsh-qa-integrations__field">
          URL входящего вебхука Bitrix24
          <input
            className="dsh-qa-integrations__input"
            type="password"
            autoComplete="new-password"
            value={state.credential}
            disabled={state.busy}
            onChange={(event) => state.setCredential(event.currentTarget.value)}
            placeholder="https://company.bitrix24.ru/rest/…"
          />
        </label>
        <CredentialHelpNote help={help} />
        <p className="dsh-qa-integrations__hint">
          Токен хранится в зашифрованном виде и после сохранения больше не
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
    ),
  });
}
