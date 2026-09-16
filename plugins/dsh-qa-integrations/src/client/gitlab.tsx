import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useCallback, useEffect, useState } from "react";
import type {
  IntegrationCapability,
  IntegrationInstanceSummary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { dateTime, failureCopy } from "./copy.js";

export interface GitlabRemote {
  gitlabInstances(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationInstanceSummary[]>>;
  getGitlab(token: string): Promise<RemoteResult<IntegrationSummary>>;
  putGitlabCredential(
    token: string,
    input: { readonly instanceId: string; readonly token: string },
  ): Promise<RemoteResult<IntegrationSummary>>;
  testGitlab(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patchGitlabPolicy(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnectGitlab(token: string): Promise<RemoteResult<boolean>>;
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
};

export function createGitlabCard(remote: GitlabRemote) {
  return function GitlabCard({ token }: QaUserSettingsSectionProps) {
    const [instances, setInstances] = useState<
      readonly IntegrationInstanceSummary[]
    >([]);
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [instanceId, setInstanceId] = useState("");
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
        const list = await remote.gitlabInstances(token);
        if (list.ok) {
          setInstances(list.value);
          setInstanceId(
            list.value.length === 1 ? (list.value[0]?.id ?? "") : "",
          );
        } else {
          fail(list.error);
        }
        accept(await remote.getGitlab(token));
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
          await remote.putGitlabCredential(token, {
            instanceId,
            token: credential,
          }),
        );
        if (saved) {
          setCredential("");
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
        accept(await remote.testGitlab(token));
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
          await remote.patchGitlabPolicy(token, {
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
        const result = await remote.disconnectGitlab(token);
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
    const configured = instances.length > 0;
    const needsChoice = configured && instances.length > 1;
    return (
      <article className="dsh-qa-integrations__card">
        {error === null ? null : (
          <div className="dsh-qa-integrations__error" role="alert">
            {error}
          </div>
        )}
        <div className="dsh-qa-integrations__card-head">
          <div>
            <h3 className="dsh-qa-integrations__provider">GitLab</h3>
            <p className="dsh-qa-integrations__portal">
              {summary?.portal ?? "Issues, merge requests и CI вашего GitLab"}
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
              {summary.externalAccountName ?? "Пользователь GitLab"}
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
                Инстанс GitLab
                <select
                  className="dsh-qa-integrations__input"
                  value={instanceId}
                  disabled={busy}
                  onChange={(event) => setInstanceId(event.currentTarget.value)}
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
              Personal access token GitLab
              <input
                className="dsh-qa-integrations__input"
                type="password"
                autoComplete="new-password"
                value={credential}
                disabled={busy}
                onChange={(event) => setCredential(event.currentTarget.value)}
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
                  busy ||
                  credential.trim() === "" ||
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
            Оператор не настроил ни одного инстанса GitLab, подключать нечего.
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
                        {granted ? "Доступно" : "Нет в правах токена"}
                      </span>
                    </div>
                  );
                },
              )}
              <div className="dsh-qa-integrations__permission">
                <label>
                  <input type="checkbox" disabled /> Комментарии, задачи и MR на
                  запись
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
                aria-label="Подтверждение отключения GitLab"
              >
                Отключить GitLab и удалить сохранённый токен?
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
