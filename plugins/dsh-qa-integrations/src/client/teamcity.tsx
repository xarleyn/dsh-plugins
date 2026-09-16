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

export function createTeamcityCard(remote: TeamcityRemote) {
  return function TeamcityCard({ token }: QaUserSettingsSectionProps) {
    const [summary, setSummary] = useState<IntegrationSummary>();
    // undefined while the answer is on its way, null when this deployment
    // configured no address at all.
    const [server, setServer] = useState<
      IntegrationInstanceSummary | null | undefined
    >(undefined);
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
        const address = await remote.teamcityServer(token);
        if (!address.ok) {
          fail(address.error);
          return;
        }
        setServer(address.value);
        accept(await remote.getTeamcity(token));
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
          await remote.putTeamcityCredential(token, { token: credential }),
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
        accept(await remote.testTeamcity(token));
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
          await remote.patchTeamcityPolicy(token, {
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
        const result = await remote.disconnectTeamcity(token);
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
      summary !== undefined && summary.status !== "not_connected";
    const showCredential = !connected || replace;
    const configured = server !== null && server !== undefined;
    return (
      <article className="dsh-qa-integrations__card">
        {error === null ? null : (
          <div className="dsh-qa-integrations__error" role="alert">
            {error}
          </div>
        )}
        <div className="dsh-qa-integrations__card-head">
          <div>
            <h3 className="dsh-qa-integrations__provider">TeamCity</h3>
            <p className="dsh-qa-integrations__portal">
              {summary?.portal ?? "Сборки, тесты и причины падений вашего CI"}
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
              {summary.externalAccountName ?? "Пользователь TeamCity"}
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
            <span className="dsh-qa-integrations__muted">
              Адрес TeamCity: {server?.label ?? ""} — задан оператором стенда
            </span>
            <label className="dsh-qa-integrations__field">
              Access token TeamCity
              <input
                className="dsh-qa-integrations__input"
                type="password"
                autoComplete="new-password"
                value={credential}
                disabled={busy}
                onChange={(event) => setCredential(event.currentTarget.value)}
              />
            </label>
            <p className="dsh-qa-integrations__hint">
              Создайте в TeamCity (Profile → Access Tokens) токен с минимальными
              правами — «Limit per project» и только на чтение. Токен хранится в
              зашифрованном виде и после сохранения не отображается.
            </p>
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
                type="button"
                disabled={busy || credential.trim() === ""}
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

        {!configured && server !== undefined ? (
          <p className="dsh-qa-integrations__hint">
            Оператор не настроил адрес TeamCity, подключать нечего. Адрес стенда
            задаётся в конфигурации развёртывания — он один на всех.
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
                  <input type="checkbox" disabled /> Запуск, отмена и
                  комментарии к сборке
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
                aria-label="Подтверждение отключения TeamCity"
              >
                Отключить TeamCity и удалить сохранённый токен?
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
