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

export interface JiraRemote {
  jiraSites(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getJira(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putJiraCredential(
    token: string,
    input: {
      readonly siteId: string;
      readonly email: string;
      readonly token: string;
    },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testJira(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchJiraPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectJira(token: string): Promise<RemoteResult<boolean>>;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  PrincipalNotResolved: "Сессия истекла. Войдите заново.",
  InvalidCredential:
    "Проверьте API-токен, e-mail аккаунта Atlassian и выбранный сайт.",
  ProviderPermissionDenied:
    "Jira не разрешил это действие: задача, проект или поле закрыты правами вашего аккаунта.",
  ProviderUnavailable:
    "Jira недоступна с этого стенда. Проверьте адрес сайта, заданный оператором, и сетевую доступность.",
  IntegrationNotConnected: "Интеграция не подключена.",
  CredentialExpired: "Срок действия токена истёк. Создайте новый токен.",
  CredentialRevoked:
    "Jira отклонила токен. Создайте новый API-токен и замените его.",
  ResourceNotFound: "Jira не нашла ресурс или ваш аккаунт его не видит.",
  RateLimited: "Слишком много запросов к Jira. Попробуйте позже.",
  ResultTooLarge: "Ответ Jira слишком большой для одного запроса.",
  UpstreamTimeout: "Jira не ответила вовремя. Попробуйте ещё раз.",
  TlsFailure:
    "Сертификат сайта Jira не принят стендом. Нужен сертификат, которому доверяет сервер.",
};

export function createJiraCard(remote: JiraRemote) {
  return function JiraCard({ token, help }: ProviderCardProps) {
    const [sites, setSites] = useState<readonly IntegrationInstanceSummary[]>(
      [],
    );
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [siteId, setSiteId] = useState("");
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
        const list = await remote.jiraSites(token);
        if (list.ok) {
          setSites(list.value);
          setSiteId(list.value.length === 1 ? (list.value[0]?.id ?? "") : "");
        } else {
          fail(list.error);
        }
        accept(await remote.getJira(token));
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
          await remote.putJiraCredential(token, {
            siteId,
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
        accept(await remote.testJira(token));
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
          await remote.patchJiraPolicy(token, {
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
        const result = await remote.disconnectJira(token);
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
            <h3 className="dsh-qa-integrations__provider">Jira</h3>
            <p className="dsh-qa-integrations__portal">
              {summary?.portal ?? "Задачи, комментарии и вложения вашей Jira"}
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
              {summary.externalAccountName ?? "Пользователь Jira"}
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
                Сайт Jira
                <select
                  className="dsh-qa-integrations__input"
                  value={siteId}
                  disabled={busy}
                  onChange={(event) => setSiteId(event.currentTarget.value)}
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
                Сайт: {sites[0]?.label ?? ""} — задан оператором стенда
              </span>
            )}
            <label className="dsh-qa-integrations__field">
              Аккаунт Atlassian (e-mail)
              <input
                className="dsh-qa-integrations__input"
                type="email"
                autoComplete="off"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="ivan@example.com"
              />
            </label>
            <label className="dsh-qa-integrations__field">
              API-токен Jira
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
              Токен и e-mail хранятся в зашифрованном виде и после сохранения не
              отображаются.
            </p>
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={
                  busy ||
                  credential.trim() === "" ||
                  email.trim() === "" ||
                  (needsChoice && siteId === "")
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
            Оператор не настроил ни одного сайта Jira, подключать нечего. Адреса
            сайтов задаются в конфигурации развёртывания.
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
                  <input type="checkbox" disabled /> Создание и правка задач,
                  комментарии, переходы
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
                aria-label="Подтверждение отключения Jira"
              >
                Отключить Jira и удалить сохранённый токен?
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
