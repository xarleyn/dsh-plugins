import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { useState } from "react";
import type {
  CredentialSource,
  IntegrationInstanceSummary,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { createProviderCard, serviceConnectOption } from "./provider-card.js";

export interface GitlabRemote {
  gitlabInstances(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getGitlab(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putGitlabCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      readonly useServiceCredential?: boolean;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testGitlab(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchGitlabPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectGitlab(token: string): Promise<RemoteResult<boolean>>;
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
  InvalidCredential: "Проверьте personal access token и выбранный инстанс.",
  ProviderPermissionDenied:
    "GitLab не разрешил это действие: проверьте права токена.",
  ProviderUnavailable: "GitLab сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked: "GitLab отклонил токен. Создайте новый и замените его.",
  ResourceNotFound: "GitLab не нашёл ресурс или токен его не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ GitLab слишком большой для одного запроса.",
  UpstreamTimeout: "GitLab не ответил вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат GitLab не принят стендом. Нужен сертификат, которому доверяет сервер.",
  ServiceCredentialUnavailable:
    "Для этого инстанса администратор не настроил сервисный токен.",
  ServiceCredentialDisabled:
    "Сервисный токен этого инстанса отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для выбранного инстанса. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный токен не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный токен не даёт доступа к этому проекту. Сузьте доступ в списке или подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface GitlabExtra {
  readonly instances: readonly IntegrationInstanceSummary[];
  setInstances(instances: readonly IntegrationInstanceSummary[]): void;
  readonly instanceId: string;
  setInstanceId(instanceId: string): void;
}

export function createGitlabCard(remote: GitlabRemote) {
  return createProviderCard<GitlabExtra>({
    title: "GitLab",
    portalFallback: "Issues, merge requests и CI вашего GitLab",
    accountFallback: "Пользователь GitLab",
    errorCopy: ERROR_COPY,
    notGrantedText: "Нет в правах токена",
    futurePermissions: ["Комментарии, задачи и MR на запись"],
    useExtra: () => {
      const [instances, setInstances] = useState<
        readonly IntegrationInstanceSummary[]
      >([]);
      const [instanceId, setInstanceId] = useState("");
      return { instances, setInstances, instanceId, setInstanceId };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.gitlabInstances(token);
      if (list.ok) {
        extra.setInstances(list.value);
        extra.setInstanceId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getGitlab(token));
    },
    calls: {
      save: (token, credential, extra, options) =>
        remote.putGitlabCredential(token, {
          instanceId: extra.instanceId,
          token: credential,
          useServiceCredential: options.useServiceCredential,
        }),
      test: (token) => remote.testGitlab(token),
      patch: (token, patch) => remote.patchGitlabPolicy(token, patch),
      disconnect: (token) => remote.disconnectGitlab(token),
      setSource: (token, source) =>
        remote.credentialSource(token, { provider: "gitlab", source }),
      setBoundary: (token, selection) =>
        remote.serviceBoundary(token, { provider: "gitlab", selection }),
    },
    // Exactly the selected instance's managed credential: falling back to
    // another instance's would offer a checkbox whose connect could only fail.
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
    credentialSection: (state) => {
      const { instances, instanceId } = state.extra;
      const configured = instances.length > 0;
      if (!configured) return null;
      const needsChoice = instances.length > 1;
      const service = serviceConnectOption(state);
      const instancePicker = needsChoice ? (
        <label className="dsh-qa-integrations__field">
          Инстанс GitLab
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
      );
      // With a managed credential there is nothing to paste: the host spends the
      // deployment's token, so the form keeps the instance picker and the
      // checkbox and drops the secret field entirely.
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
            Personal access token GitLab
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
              placeholder="glpat-…"
            />
          </label>
          <p className="dsh-qa-integrations__hint">
            Токен хранится в зашифрованном виде и после сохранения больше не
            отображается. Хватит read-scope: <code>read_api</code> (или{" "}
            <code>read_user</code> для профиля и <code>read_repository</code>{" "}
            для кода).
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
        Оператор не настроил ни одного инстанса GitLab, подключать нечего.
      </p>
    ),
  });
}
