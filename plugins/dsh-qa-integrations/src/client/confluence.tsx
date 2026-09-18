import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { CredentialHelpNote } from "@yadsh/dsh-plugin-kit/client";
import { useCallback, useEffect, useState } from "react";
import type {
  IntegrationCapability,
  IntegrationInstanceSummary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { dateTime, failureCopy } from "./copy.js";
import type { ProviderCardProps } from "./provider-card.js";

export interface ConfluenceRemote {
  confluenceSites(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getConfluence(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putConfluenceCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly email: string;
      readonly token: string;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testConfluence(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchConfluencePolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectConfluence(token: string): Promise<RemoteResult<boolean>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential:
    "Проверьте адрес почты Atlassian, API token и выбранный сайт Confluence.",
  ProviderPermissionDenied:
    "Confluence не разрешил это действие: у аккаунта нет прав на страницу.",
  ProviderUnavailable: "Confluence сейчас недоступен. Попробуйте позже.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialRevoked:
    "Confluence отклонил почту или токен. Выпустите новый токен и замените его.",
  ResourceNotFound: "Confluence не нашёл страницу или аккаунт её не видит.",
  RateLimited: "Слишком много запросов. Попробуйте позже.",
  ResultTooLarge: "Ответ Confluence слишком большой для одного запроса.",
  OperationDeniedByPolicy:
    "Пространство вне списка, разрешённого оператором стенда.",
};

export function createConfluenceCard(remote: ConfluenceRemote) {
  return function ConfluenceCard({ token, help }: ProviderCardProps) {
    const [sites, setSites] = useState<readonly IntegrationInstanceSummary[]>(
      [],
    );
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [instanceId, setInstanceId] = useState("");
    const [email, setEmail] = useState("");
    const [credential, setCredential] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [replace, setReplace] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    const fail = useCallback((cause: unknown) => {
      setError(failureCopy(ERROR_COPY, cause));
    }, []);

    const accept = useCallback(
      (result: RemoteResult<IntegrationSummary>) => {
        if (result.ok) {
          setSummary(result.value);
          setError(null);
          return true;
        }
        fail(result.error);
        return false;
      },
      [fail],
    );

    const load = useCallback(async () => {
      try {
        const list = await remote.confluenceSites(token);
        if (list.ok) {
          setSites(list.value);
          setInstanceId(
            list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
          );
        } else {
          fail(list.error);
        }
        accept(await remote.getConfluence(token));
      } catch (cause) {
        fail(cause);
      }
    }, [accept, fail, token]);

    useEffect(() => {
      void load();
    }, [load]);

    const save = async () => {
      setBusy(true);
      try {
        const saved = accept(
          await remote.putConfluenceCredential(token, {
            instanceId,
            email,
            token: credential,
          }),
        );
        if (saved) {
          setCredential("");
          setEmail("");
          setReplace(false);
        }
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const test = async () => {
      setBusy(true);
      try {
        accept(await remote.testConfluence(token));
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const patch = async (
      capability: IntegrationCapability,
      allowed: boolean,
    ) => {
      setBusy(true);
      try {
        accept(
          await remote.patchConfluencePolicy(token, {
            operation: capability,
            mode: allowed ? "allow" : "deny",
          }),
        );
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const disconnect = async () => {
      setBusy(true);
      try {
        const result = await remote.disconnectConfluence(token);
        if (result.ok) {
          setSummary(undefined);
          setConfirmDisconnect(false);
          await load();
        } else {
          fail(result.error);
        }
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const connected =
      summary?.status !== "not_connected" && summary !== undefined;
    const showCredential = !connected || replace;
    const configured = sites.length > 0;
    const needsChoice = configured && sites.length > 1;
    return (
      <article className="dsh-qa-integrations__card">
        {error === null ? null : (
          <div className="dsh-qa-integrations__error" role="alert">
            {error}
          </div>
        )}
        <div className="dsh-qa-integrations__card-head">
          <div>
            <h3 className="dsh-qa-integrations__provider">Confluence</h3>
            <p className="dsh-qa-integrations__portal">
              {summary?.portal ?? "База знаний и документация вашей команды"}
            </p>
          </div>
          <span
            className={`dsh-qa-integrations__status${summary?.status === "connected" ? " dsh-qa-integrations__status--ok" : ""}`}
          >
            {summary?.status === "connected"
              ? "Подключено"
              : summary?.status === "error"
                ? "Нужна проверка"
                : "Не подключено"}
          </span>
        </div>

        {connected ? (
          <div className="dsh-qa-integrations__section">
            <strong>
              {summary.externalAccountName ?? "Пользователь Atlassian"}
            </strong>
            <span className="dsh-qa-integrations__muted">
              Последняя успешная проверка: {dateTime(summary.lastValidatedAt)}
            </span>
            <span className="dsh-qa-integrations__muted">
              Токен настроен · обновлён {dateTime(summary.credentialUpdatedAt)}
            </span>
          </div>
        ) : null}

        {showCredential && configured ? (
          <div className="dsh-qa-integrations__section">
            {needsChoice ? (
              <label className="dsh-qa-integrations__field">
                Сайт Confluence
                <select
                  className="dsh-qa-integrations__input"
                  value={instanceId}
                  disabled={busy}
                  onChange={(event) => setInstanceId(event.currentTarget.value)}
                >
                  <option value="">Выберите сайт</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="dsh-qa-integrations__muted">
                Сайт: {sites[0]?.label ?? ""}
              </span>
            )}
            <label className="dsh-qa-integrations__field">
              Почта аккаунта Atlassian
              <input
                className="dsh-qa-integrations__input"
                type="email"
                autoComplete="off"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="dsh-qa-integrations__field">
              Atlassian API token
              <input
                className="dsh-qa-integrations__input"
                type="password"
                autoComplete="new-password"
                value={credential}
                disabled={busy}
                onChange={(event) => setCredential(event.currentTarget.value)}
                placeholder="ATATT…"
              />
            </label>
            <CredentialHelpNote help={help} />
            <p className="dsh-qa-integrations__hint">
              Почта и токен хранятся в зашифрованном виде и после сохранения
              больше не отображаются.
            </p>
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={
                  busy ||
                  credential.trim() === "" ||
                  email.trim() === "" ||
                  (needsChoice && instanceId === "")
                }
                onClick={() => void save()}
              >
                Сохранить и проверить
              </button>
              {connected ? (
                <button
                  className="dsh-qa-integrations__button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCredential("");
                    setEmail("");
                    setReplace(false);
                  }}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!configured ? (
          <p className="dsh-qa-integrations__hint">
            Оператор не настроил ни одного сайта Confluence, подключать нечего.
          </p>
        ) : null}

        {connected && !showCredential ? (
          <>
            <div className="dsh-qa-integrations__section">
              <h4>Доступ агента</h4>
              {Object.entries(summary.capabilityInfo).map(
                ([capability, info]) => {
                  const granted = summary.capabilities.includes(capability);
                  const mode = summary.policy.find(
                    (entry) => entry.capability === capability,
                  )?.mode;
                  return (
                    <div
                      className="dsh-qa-integrations__permission"
                      key={capability}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={mode === "allow"}
                          disabled={busy || !granted}
                          onChange={(event) =>
                            void patch(capability, event.currentTarget.checked)
                          }
                        />
                        {info.label}
                      </label>
                      <span
                        className="dsh-qa-integrations__muted"
                        title={info.hint}
                      >
                        {granted ? "Доступно" : "Выключено оператором стенда"}
                      </span>
                    </div>
                  );
                },
              )}
              <div className="dsh-qa-integrations__permission">
                <label>
                  <input type="checkbox" disabled /> Создание и правка страниц,
                  комментарии на запись
                </label>
                <span className="dsh-qa-integrations__muted">
                  Появится позже
                </span>
              </div>
            </div>
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={busy}
                onClick={() => void test()}
              >
                Проверить
              </button>
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={busy}
                onClick={() => setReplace(true)}
              >
                Заменить токен
              </button>
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--danger"
                type="button"
                disabled={busy}
                onClick={() => setConfirmDisconnect(true)}
              >
                Отключить
              </button>
            </div>
            {confirmDisconnect ? (
              <div
                className="dsh-qa-integrations__notice"
                role="alertdialog"
                aria-label="Подтверждение отключения Confluence"
              >
                Отключить Confluence и удалить сохранённый токен?
                <div className="dsh-qa-integrations__actions">
                  <button
                    className="dsh-qa-integrations__button dsh-qa-integrations__button--danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void disconnect()}
                  >
                    Да, отключить
                  </button>
                  <button
                    className="dsh-qa-integrations__button"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDisconnect(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </article>
    );
  };
}
