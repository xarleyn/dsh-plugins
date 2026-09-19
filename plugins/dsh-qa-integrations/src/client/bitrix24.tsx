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

/**
 * Top-level remotes the shared mounts read: what `describe` reports decides
 * which provider cards render at all. The Bitrix24-specific calls live in
 * `Bitrix24Remote`.
 */
export interface IntegrationsRemote {
  describe(): Promise<
    RemoteResult<{
      readonly enabled: boolean;
      /** Ids of the providers this deployment mounted, in card order. */
      readonly providers: readonly string[];
    }>
  >;
}

export interface Bitrix24Remote {
  bitrix24Instances(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getBitrix24(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putBitrix24Credential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      readonly useServiceCredential?: boolean;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testBitrix24(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchBitrix24Policy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectBitrix24(token: string): Promise<RemoteResult<boolean>>;
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
  InvalidCredential: "Проверьте URL входящего вебхука Bitrix24.",
  ProviderPermissionDenied: "Bitrix24 не разрешил это действие.",
  ProviderUnavailable: "Bitrix24 сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия подключения истёк. Замените токен.",
  CredentialRevoked: "Подключение больше не действует. Замените токен.",
  ServiceCredentialUnavailable:
    "Для этого портала администратор не настроил сервисный токен.",
  ServiceCredentialDisabled:
    "Сервисный токен этого портала отключён администратором.",
  ServiceCredentialInvalid:
    "Сервисный токен не подходит для выбранного портала. Сообщите администратору.",
  PersonalCredentialRequired:
    "Личный вебхук не сохранён: подключите его, чтобы вернуться к личному аккаунту.",
  ServiceResourceNotAllowed:
    "Сервисный токен не работает на этом портале. Подключите личный аккаунт.",
  SensitiveReadRequiresPersonalCredential:
    "Эта операция может содержать личные или чувствительные данные. Подключите личный аккаунт, чтобы использовать её.",
  OperationNotAllowedWithServiceCredential:
    "Сервисный режим — только безопасное чтение: изменения недоступны.",
};

interface Bitrix24Extra {
  readonly instances: readonly IntegrationInstanceSummary[];
  setInstances(instances: readonly IntegrationInstanceSummary[]): void;
  readonly instanceId: string;
  setInstanceId(instanceId: string): void;
}

export function createBitrix24Card(remote: Bitrix24Remote) {
  return createProviderCard<Bitrix24Extra>({
    title: "Bitrix24",
    portalFallback: "CRM и чаты вашей компании",
    accountFallback: "Пользователь Bitrix24",
    errorCopy: ERROR_COPY,
    notGrantedText: "Нет разрешения Bitrix24",
    futurePermissions: ["Отправлять сообщения", "Изменять CRM"],
    useExtra: () => {
      const [instances, setInstances] = useState<
        readonly IntegrationInstanceSummary[]
      >([]);
      const [instanceId, setInstanceId] = useState("");
      return { instances, setInstances, instanceId, setInstanceId };
    },
    load: async ({ token, extra, accept, fail }) => {
      const list = await remote.bitrix24Instances(token);
      if (list.ok) {
        extra.setInstances(list.value);
        extra.setInstanceId(
          list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
        );
      } else {
        fail(list.error);
      }
      accept(await remote.getBitrix24(token));
    },
    calls: {
      save: (token, credential, extra, options) =>
        remote.putBitrix24Credential(token, {
          instanceId: extra.instanceId,
          token: credential,
          useServiceCredential: options.useServiceCredential,
        }),
      test: (token) => remote.testBitrix24(token),
      patch: (token, patch) => remote.patchBitrix24Policy(token, patch),
      disconnect: (token) => remote.disconnectBitrix24(token),
      setSource: (token, source) =>
        remote.credentialSource(token, { provider: "bitrix24", source }),
      setBoundary: (token, selection) =>
        remote.serviceBoundary(token, { provider: "bitrix24", selection }),
    },
    // Exactly the selected portal's managed credential: falling back to
    // another portal's would offer a checkbox whose connect could only fail.
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
          Портал Bitrix24
          <select
            className="dsh-qa-integrations__input"
            value={instanceId}
            disabled={state.busy}
            onChange={(event) =>
              state.extra.setInstanceId(event.currentTarget.value)
            }
          >
            <option value="">Выберите портал</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="dsh-qa-integrations__muted">
          Портал: {instances[0]?.label ?? ""}
        </span>
      );
      // With a managed credential there is nothing to paste: the host spends
      // the deployment's webhook, so the form keeps the portal picker and the
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
            URL входящего вебхука Bitrix24
            <input
              className="dsh-qa-integrations__input"
              type="password"
              autoComplete="new-password"
              value={state.credential}
              disabled={state.busy}
              onChange={(event) =>
                state.setCredential(event.currentTarget.value)
              }
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
    notConfiguredHint: (state) =>
      state.extra.instances.length === 0 ? (
        <p className="dsh-qa-integrations__hint">
          Оператор не настроил ни одного портала Bitrix24, подключать нечего.
        </p>
      ) : null,
  });
}
