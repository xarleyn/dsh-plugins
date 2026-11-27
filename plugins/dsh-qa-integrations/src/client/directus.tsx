import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useMemo } from "react";
import { DIRECTUS_PROVIDER_PREFIX } from "../providers/directus/identity.js";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createProviderCard, type ProviderCardProps } from "./provider-card.js";

export interface DirectusRemote {
  getDirectus(
    token: string,
    provider: string,
  ): Promise<RemoteResult<IntegrationSummary>>;
  putDirectusCredential(
    token: string,
    input: {
      readonly provider: string;
      readonly token: string;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testDirectus(
    token: string,
    provider: string,
  ): Promise<RemoteResult<IntegrationSummary>>;
  patchDirectusPolicy(
    token: string,
    input: {
      readonly provider: string;
      readonly patch: PolicyPatch;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectDirectus(
    token: string,
    provider: string,
  ): Promise<RemoteResult<boolean>>;
}

export function DirectusCard({
  provider,
  remote,
  token,
}: ProviderCardProps & {
  readonly provider: string;
  readonly remote: DirectusRemote;
}) {
  const Card = useMemo(
    () =>
      createProviderCard<undefined>({
        provider,
        title: `Directus · ${provider.slice(DIRECTUS_PROVIDER_PREFIX.length)}`,
        portalFallback: "Чтение записей и связанных документов",
        accountFallback: "Пользователь Directus",
        errorCopy: {
          InvalidCredential: "Введите токен доступа Directus.",
          ProviderPermissionDenied:
            "Directus отказал в доступе. Проверьте права учётной записи.",
          CredentialRevoked:
            "Directus отклонил токен. Проверьте подключение и замените токен.",
        },
        notGrantedText: "Недоступно на этом сервере",
        futurePermissions: [],
        useExtra: () => undefined,
        load: async ({ token, accept }) => {
          accept(await remote.getDirectus(token, provider));
        },
        calls: {
          save: (token, credential) =>
            remote.putDirectusCredential(token, {
              provider,
              token: credential,
            }),
          test: (token) => remote.testDirectus(token, provider),
          patch: (token, patch) =>
            remote.patchDirectusPolicy(token, { provider, patch }),
          disconnect: (token) => remote.disconnectDirectus(token, provider),
        },
        credentialSection: (state) => (
          <div className="dsh-qa-integrations__section">
            <label className="dsh-qa-integrations__field">
              Токен учётной записи с правами чтения
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
      }),
    [provider, remote],
  );
  return <Card token={token} />;
}
