import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { CredentialHelpNote } from "@yadsh/dsh-plugin-kit/client";
import { useState } from "react";
import type {
  CredentialSource,
  IntegrationInstanceSummary,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard, serviceConnectOption } from "./provider-card.js";

export interface TestitRemote {
  testitInstances(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getTestit(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putTestitCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      readonly useServiceCredential?: boolean;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testTestit(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchTestitPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectTestit(token: string): Promise<RemoteResult<boolean>>;
  managedServiceCredentials(token: string): Promise<
    RemoteResult<{
      readonly enabled: boolean;
      readonly defaultForNewConnections: boolean;
    }>
  >;
  credentialSource(
    token: string,
    input: { readonly provider: string; readonly source: CredentialSource },
  ): Promise<RemoteResult<IntegrationSummary>>;
  serviceBoundary(
    token: string,
    input: {
      readonly provider: string;
      readonly selection: IntegrationServiceBoundary | null;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential:
    "Проверьте API-токен Test IT и выбранную инсталляцию: адрес задаёт оператор стенда.",
  ProviderPermissionDenied:
    "Test IT не разрешил это действие: у токена нет прав на эти данные.",
  ProviderUnavailable:
    "Test IT недоступен с этого стенда. Проверьте адрес, заданный оператором, и сетевую доступность.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked: "Test IT отклонил токен. Создайте новый и замените его.",
  ResourceNotFound: "Test IT не нашёл ресурс или токен его не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge:
    "Ответ Test IT слишком большой для одного запроса. Сузьте фильтр или лимит.",
  UpstreamTimeout: "Test IT не ответил вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат Test IT не принят стендом. Нужен сертификат, которому доверяет сервер.",
  ServiceCredentialUnavailable:
    "Для этой инсталляции администратор не настроил сервисный токен.",
  ServiceCredentialDisabled:
    "Сервисный токен этой инсталляции отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для выбранной инсталляции. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный токен не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный токен не даёт доступа к этому проекту. Сузьте доступ в списке или подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface TestitExtra {
  readonly instances: readonly IntegrationInstanceSummary[];
  setInstances(instances: readonly IntegrationInstanceSummary[]): void;
  readonly instanceId: string;
  setInstanceId(instanceId: string): void;
}

export function createTestitCard(remote: TestitRemote) {
  return createProviderCard<TestitExtra>({
    title: "Test IT",
    portalFallback: "Тест-кейсы, прогоны и результаты вашей Test IT",
    accountFallback: "Подключение Test IT",
    errorCopy: ERROR_COPY,
    notGrantedText: "Выключено оператором стенда",
    futurePermissions: ["Комментарии, правка тест-кейсов и запуск прогонов"],
    useExtra: () => {
      const [instances, setInstances] = useState<
        readonly IntegrationInstanceSummary[]
      >([]);
      const [instanceId, setInstanceId] = useState("");
      return { instances, setInstances, instanceId, setInstanceId };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.testitInstances(token);
      if (list.ok) {
        extra.setInstances(list.value);
        extra.setInstanceId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getTestit(token));
    },
    calls: {
      save: (token, credential, extra, options) =>
        remote.putTestitCredential(token, {
          instanceId: extra.instanceId,
          token: credential,
          useServiceCredential: options.useServiceCredential,
        }),
      test: (token) => remote.testTestit(token),
      patch: (token, patch) => remote.patchTestitPolicy(token, patch),
      disconnect: (token) => remote.disconnectTestit(token),
      setSource: (token, source) =>
        remote.credentialSource(token, { provider: "testit", source }),
      setBoundary: (token, selection) =>
        remote.serviceBoundary(token, { provider: "testit", selection }),
    },
    // Exactly the selected installation's managed credential: falling back to
    // another installation's would offer a checkbox whose connect could only
    // fail.
    serviceBinding: (extra) => {
      if (extra.instanceId === "") {
        return extra.instances.length === 1
          ? (extra.instances[0]?.service ?? null)
          : null;
      }
      return (
        extra.instances.find((instance) => instance.id === extra.instanceId)
          ?.service ?? null
      );
    },
    serviceDefault: async (token) => {
      const result = await remote.managedServiceCredentials(token);
      return result.ok
        ? result.value.enabled && result.value.defaultForNewConnections
        : false;
    },
    credentialSection: (state, help) => {
      const { instances, instanceId } = state.extra;
      const configured = instances.length > 0;
      if (!configured) return null;
      const needsChoice = instances.length > 1;
      const service = serviceConnectOption(state);
      const instancePicker = needsChoice ? (
        <label className="dsh-qa-integrations__field">
          Инсталляция Test IT
          <select
            className="dsh-qa-integrations__input"
            value={instanceId}
            disabled={state.busy}
            onChange={(event) =>
              state.extra.setInstanceId(event.currentTarget.value)
            }
          >
            <option value="">Выберите инсталляцию</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="dsh-qa-integrations__muted">
          Инсталляция: {instances[0]?.label ?? ""}
        </span>
      );
      // With a managed credential there is nothing to paste: the host spends
      // the deployment's token, so the form keeps the installation picker and
      // the checkbox and drops the secret field entirely.
      if (state.useService) {
        return (
          <div className="dsh-qa-integrations__section">
            {instancePicker}
            {service}
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={state.busy || (needsChoice && instanceId === "")}
                onClick={state.save}
              >
                Подключить сервисный токен
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
      }
      return (
        <div className="dsh-qa-integrations__section">
          {service}
          {instancePicker}
          <label className="dsh-qa-integrations__field">
            API-токен Test IT
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
              placeholder="Токен из профиля Test IT"
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
        Оператор не настроил ни одной инсталляции Test IT, подключать нечего.
      </p>
    ),
  });
}
