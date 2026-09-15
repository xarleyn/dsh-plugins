import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useCallback, useEffect, useState } from "react";
import { BITRIX_CAPABILITIES } from "../catalog.js";
import type {
  IntegrationCapability,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";

export interface IntegrationsRemote {
  describe(): Promise<RemoteResult<{ readonly enabled: boolean }>>;
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

function failureCopy(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message: unknown }).message)
      : String(error ?? "");
  const reason = /\(reason: ([A-Za-z]+)\)/u.exec(message)?.[1];
  return reason === undefined
    ? "Не удалось выполнить действие. Попробуйте ещё раз."
    : (ERROR_COPY[reason] ??
        "Не удалось выполнить действие. Попробуйте ещё раз.");
}

function dateTime(value: string | null): string {
  return value === null
    ? "ещё не проверялось"
    : new Date(value).toLocaleString("ru-RU");
}

export function createIntegrationsPage(remote: IntegrationsRemote) {
  return function IntegrationsPage({ token }: QaUserSettingsSectionProps) {
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [credential, setCredential] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [replace, setReplace] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    const accept = useCallback((result: RemoteResult<IntegrationSummary>) => {
      if (result.ok) {
        setSummary(result.value);
        setError(null);
        return true;
      }
      setError(failureCopy(result.error));
      return false;
    }, []);

    const load = useCallback(async () => {
      try {
        accept(await remote.getBitrix24(token));
      } catch (cause) {
        setError(failureCopy(cause));
      }
    }, [accept, token]);

    useEffect(() => {
      void load();
    }, [load]);

    const save = async () => {
      setBusy(true);
      try {
        const saved = accept(
          await remote.putBitrix24Credential(token, { token: credential }),
        );
        if (saved) {
          setCredential("");
          setReplace(false);
        }
      } catch (cause) {
        setError(failureCopy(cause));
      } finally {
        setBusy(false);
      }
    };

    const test = async () => {
      setBusy(true);
      try {
        accept(await remote.testBitrix24(token));
      } catch (cause) {
        setError(failureCopy(cause));
      } finally {
        setBusy(false);
      }
    };

    const patch = async (
      operation: IntegrationCapability,
      allowed: boolean,
    ) => {
      setBusy(true);
      try {
        accept(
          await remote.patchBitrix24Policy(token, {
            operation,
            mode: allowed ? "allow" : "deny",
          }),
        );
      } catch (cause) {
        setError(failureCopy(cause));
      } finally {
        setBusy(false);
      }
    };

    const disconnect = async () => {
      setBusy(true);
      try {
        const result = await remote.disconnectBitrix24(token);
        if (result.ok) {
          setSummary(undefined);
          setConfirmDisconnect(false);
          await load();
        } else {
          setError(failureCopy(result.error));
        }
      } catch (cause) {
        setError(failureCopy(cause));
      } finally {
        setBusy(false);
      }
    };

    const connected =
      summary?.status !== "not_connected" && summary !== undefined;
    const showCredential = !connected || replace;
    return (
      <section
        className="dsh-qa-integrations"
        aria-labelledby="qa-integrations-title"
      >
        <div>
          <h2
            id="qa-integrations-title"
            className="dsh-qa-integrations__heading"
          >
            Интеграции
          </h2>
          <p className="dsh-qa-integrations__lead">
            Подключите свои рабочие сервисы. Каждое подключение доступно только
            вашему аккаунту.
          </p>
        </div>
        {error === null ? null : (
          <div className="dsh-qa-integrations__error" role="alert">
            {error}
          </div>
        )}
        <article className="dsh-qa-integrations__card">
          <div className="dsh-qa-integrations__card-head">
            <div>
              <h3 className="dsh-qa-integrations__provider">Bitrix24</h3>
              <p className="dsh-qa-integrations__portal">
                {summary?.portal ?? "CRM и чаты вашей компании"}
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
                {summary.externalAccountName ?? "Пользователь Bitrix24"}
              </strong>
              <span className="dsh-qa-integrations__muted">
                Последняя успешная проверка: {dateTime(summary.lastValidatedAt)}
              </span>
              <span className="dsh-qa-integrations__muted">
                Токен настроен · обновлён{" "}
                {dateTime(summary.credentialUpdatedAt)}
              </span>
            </div>
          ) : null}

          {showCredential ? (
            <div className="dsh-qa-integrations__section">
              <label className="dsh-qa-integrations__field">
                URL входящего вебхука Bitrix24
                <input
                  className="dsh-qa-integrations__input"
                  type="password"
                  autoComplete="new-password"
                  value={credential}
                  disabled={busy}
                  onChange={(event) => setCredential(event.currentTarget.value)}
                  placeholder="https://company.bitrix24.ru/rest/…"
                />
              </label>
              <p className="dsh-qa-integrations__hint">
                Токен хранится в зашифрованном виде и после сохранения больше не
                отображается.
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

          {connected && !showCredential ? (
            <>
              <div className="dsh-qa-integrations__section">
                <h4>Доступ агента</h4>
                {BITRIX_CAPABILITIES.map(({ capability, label, hint }) => {
                  const granted = summary.capabilities.includes(capability);
                  return (
                    <div
                      className="dsh-qa-integrations__permission"
                      key={capability}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={summary.policy[capability] === "allow"}
                          disabled={busy || !granted}
                          onChange={(event) =>
                            void patch(capability, event.currentTarget.checked)
                          }
                        />
                        {label}
                      </label>
                      <span className="dsh-qa-integrations__muted" title={hint}>
                        {granted ? "Доступно" : "Нет разрешения Bitrix24"}
                      </span>
                    </div>
                  );
                })}
                <div className="dsh-qa-integrations__permission">
                  <label>
                    <input type="checkbox" disabled /> Отправлять сообщения
                  </label>
                  <span className="dsh-qa-integrations__muted">
                    Появится позже
                  </span>
                </div>
                <div className="dsh-qa-integrations__permission">
                  <label>
                    <input type="checkbox" disabled /> Изменять CRM
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
                  aria-label="Подтверждение отключения Bitrix24"
                >
                  Отключить Bitrix24 и удалить сохранённый токен?
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
        <p className="dsh-qa-integrations__notice">
          Данные, которые агент читает через интеграцию, могут передаваться
          настроенному для этого чата LLM-провайдеру для выполнения запроса.
          Секрет подключения в модель не передаётся.
        </p>
      </section>
    );
  };
}
