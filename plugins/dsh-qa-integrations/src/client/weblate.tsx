import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useState } from "react";
import type {
  IntegrationInstanceSummary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard } from "./provider-card.js";

export interface WeblateRemote {
  weblateInstances(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getWeblate(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putWeblateCredential(
    token: string,
    input: { readonly instanceId: string; readonly token: string },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testWeblate(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchWeblatePolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectWeblate(token: string): Promise<RemoteResult<boolean>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential: "Проверьте API-токен и выбранный инстанс Weblate.",
  ProviderPermissionDenied:
    "Weblate не разрешил это действие: у токена нет прав на проект, компонент или язык.",
  ProviderUnavailable: "Weblate сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked:
    "Weblate отклонил токен. Создайте новый и замените его здесь.",
  ResourceNotFound:
    "Weblate не нашёл ресурс, или токен его не видит, или эта версия Weblate не поддерживает операцию.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ Weblate слишком большой для одного запроса.",
  UpstreamTimeout: "Weblate не ответил вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат Weblate не принят стендом. Нужен сертификат, которому доверяет сервер.",
};

interface WeblateExtra {
  readonly instances: readonly IntegrationInstanceSummary[];
  setInstances(instances: readonly IntegrationInstanceSummary[]): void;
  readonly instanceId: string;
  setInstanceId(instanceId: string): void;
}

export function createWeblateCard(remote: WeblateRemote) {
  return createProviderCard<WeblateExtra>({
    title: "Weblate",
    portalFallback: "Переводы ваших проектов: языки, строки и проверки",
    accountFallback: "Пользователь Weblate",
    errorCopy: ERROR_COPY,
    notGrantedText: "Нет в правах токена",
    futurePermissions: [
      "Предложить перевод строки",
      "Комментировать строку",
      "Править и утверждать перевод",
      "Загружать файлы перевода и работать с репозиторием",
    ],
    useExtra: () => {
      const [instances, setInstances] = useState<
        readonly IntegrationInstanceSummary[]
      >([]);
      const [instanceId, setInstanceId] = useState("");
      return { instances, setInstances, instanceId, setInstanceId };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.weblateInstances(token);
      if (list.ok) {
        extra.setInstances(list.value);
        extra.setInstanceId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getWeblate(token));
    },
    calls: {
      save: (token, credential, extra) =>
        remote.putWeblateCredential(token, {
          instanceId: extra.instanceId,
          token: credential,
        }),
      test: (token) => remote.testWeblate(token),
      patch: (token, patch) => remote.patchWeblatePolicy(token, patch),
      disconnect: (token) => remote.disconnectWeblate(token),
    },
    credentialSection: (state) => {
      const { instances, instanceId } = state.extra;
      const configured = instances.length > 0;
      if (!configured) return null;
      const needsChoice = instances.length > 1;
      return (
        <div className="dsh-qa-integrations__section">
          {needsChoice ? (
            <label className="dsh-qa-integrations__field">
              Инстанс Weblate
              <select
                className="dsh-qa-integrations__input"
                value={instanceId}
                disabled={state.busy}
                onChange={(event) =>
                  state.extra.setInstanceId(event.currentTarget.value)
                }
              >
                <option value="">Выберите инстанс</option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="dsh-qa-integrations__muted">
              Инстанс: {instances[0]?.label ?? ""}
            </span>
          )}
          <label className="dsh-qa-integrations__field">
            API-токен Weblate
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
              placeholder="wlu_…"
            />
          </label>
          <p className="dsh-qa-integrations__hint">
            Токен хранится в зашифрованном виде и после сохранения больше не
            отображается. Для минимума прав возьмите токен проекта (
            <code>wlp_…</code>): он ограничен одним проектом. Права чтения и
            записи всё равно определяет сам Weblate.
          </p>
          <div className="dsh-qa-integrations__actions">
            <button
              className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
              type="button"
              disabled={
                state.busy ||
                state.credential.trim() === "" ||
                (needsChoice && instanceId === "")
              }
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
    notConfiguredHint: () => (
      <p className="dsh-qa-integrations__hint">
        Оператор не настроил ни одного инстанса Weblate, подключать нечего.
      </p>
    ),
  });
}
