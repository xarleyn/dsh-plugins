import { useEffect, useState, type FormEvent } from "react";
import {
  QA_SERVICE_TOKEN_DEFAULT_SCOPES,
  QA_SERVICE_TOKEN_LABEL_MAX,
  QA_SERVICE_TOKEN_SCOPES,
  QA_SERVICE_TOKEN_TTL_DAYS_MAX,
  QA_SERVICE_TOKEN_TTL_DAYS_MIN,
} from "../../shared/integration-tokens.js";
import type {
  QaIssuedServiceToken,
  QaServiceTokenScope,
  QaServiceTokenSummary,
} from "../../types.js";
import type { QaIntegrationTokenApi } from "../types.js";
import {
  QaSettingsActions,
  QaSettingsButton,
  QaSettingsField,
  QaSettingsNotice,
  QaSettingsSection,
} from "./fields.js";

/** Scope names as the person choosing them reads them. */
const SCOPE_LABELS: Record<QaServiceTokenScope, string> = {
  ask: "Задавать вопросы",
  "sessions:read": "Читать историю чатов",
};

/** The lifetimes a token is usually asked for; the Host bounds the real range. */
const TTL_CHOICES: readonly number[] = [30, 90, 180, 365];

function scopeLabels(scopes: readonly QaServiceTokenScope[]): string {
  return scopes.length === 0
    ? "без прав"
    : scopes.map((scope) => SCOPE_LABELS[scope]).join(", ");
}

/** `2026-09-21` for a stored ISO timestamp; the empty string when unparseable. */
function day(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : "";
}

function tokenState(
  token: QaServiceTokenSummary,
  now: number,
): "active" | "revoked" | "expired" {
  if (token.revokedAt !== null) return "revoked";
  return Date.parse(token.expiresAt) <= now ? "expired" : "active";
}

/**
 * The integration tokens of the signed-in account: mint, read the secret once,
 * and revoke.
 *
 * An integration token is the credential a non-browser application presents to
 * the QA HTTP API, and it is deliberately a second, separate credential from
 * the browser session: it survives a password change, it carries its own
 * scopes and expiry, and it is revoked here rather than by signing anybody out.
 * The page therefore says what the token is *for* before it offers to mint one
 * — handing a long-lived key to a service is not a preference toggle.
 *
 * The plaintext exists in exactly one place: the answer that minted it. It is
 * shown once, with the warning that this is the only time, and the list that
 * follows carries no secret in any state — a list that could repeat a
 * credential would be a list that leaks it.
 */
export function QaIntegrationTokensPage(props: {
  readonly api: QaIntegrationTokenApi;
}) {
  const [tokens, setTokens] = useState<readonly QaServiceTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(TTL_CHOICES[1] ?? 90);
  const [scopes, setScopes] = useState<readonly QaServiceTokenScope[]>(
    QA_SERVICE_TOKEN_DEFAULT_SCOPES,
  );
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<QaIssuedServiceToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void props.api.list().then((result) => {
      if (!live) return;
      setLoading(false);
      if (result.ok) {
        setTokens(result.value);
        return;
      }
      setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [props.api]);
  // Revocation is not undoable and a token may be in production: the row asks
  // twice, and the second click is the one that acts.
  const reload = async (): Promise<void> => {
    const result = await props.api.list();
    if (result.ok) {
      setTokens(result.value);
      setError(null);
      return;
    }
    setError(result.error);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    void props.api
      .create({
        label: label.trim(),
        scopes: [...scopes],
        ttlDays: days,
      })
      .then(async (result) => {
        setBusy(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setIssued(result.value);
        setLabel("");
        await reload();
      });
  };
  const toggleScope = (scope: QaServiceTokenScope, checked: boolean) => {
    setScopes((current) =>
      checked
        ? QA_SERVICE_TOKEN_SCOPES.filter(
            (candidate) => candidate === scope || current.includes(candidate),
          )
        : current.filter((candidate) => candidate !== scope),
    );
  };
  const revoke = (tokenId: string) => {
    if (revoking !== null) return;
    setRevoking(tokenId);
    setError(null);
    void props.api.revoke(tokenId).then(async (result) => {
      setRevoking(null);
      setPendingRevoke(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await reload();
    });
  };
  const copySecret = (secret: string) => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(secret).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  const now = Date.now();
  return (
    <div className="dsh-qa-settings__page">
      <h3 className="dsh-qa-settings__page-title">Интеграционные токены</h3>
      <p className="dsh-qa-settings__lead">
        Токен — это ключ для другой программы: она задаёт вопросы от имени
        вашей учётной записи, не открывая браузер. Выдавайте отдельный токен
        каждой интеграции и отзывайте его, когда она больше не нужна. Токен
        переживает смену вашего пароля, поэтому отзывается отдельно.
      </p>
      {issued === null ? null : (
        <QaSettingsSection title="Токен создан">
          <QaSettingsNotice tone="warn">
            Скопируйте значение сейчас и передайте его интеграции. Показать его
            повторно нельзя: на стенде хранится только отпечаток.
          </QaSettingsNotice>
          <QaSettingsField
            label="Значение токена"
            hint="Передавайте его как заголовок Authorization: Bearer …"
          >
            <input
              className="dsh-qa-settings__code"
              value={issued.token}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </QaSettingsField>
          <QaSettingsActions>
            <QaSettingsButton
              label={copied ? "Скопировано" : "Скопировать"}
              onClick={() => copySecret(issued.token)}
            />
            <QaSettingsButton
              tone="primary"
              label="Я сохранил токен"
              onClick={() => {
                setIssued(null);
                setCopied(false);
              }}
            />
          </QaSettingsActions>
        </QaSettingsSection>
      )}
      <QaSettingsSection title="Новый токен">
        {props.api.canCreate ? (
          <form className="dsh-qa-settings__page" onSubmit={submit}>
            <QaSettingsField
              label="Название"
              hint="По нему вы отличите токены в списке: например, «мост заявок»."
            >
              <input
                value={label}
                maxLength={QA_SERVICE_TOKEN_LABEL_MAX}
                placeholder="мост заявок"
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </QaSettingsField>
            {QA_SERVICE_TOKEN_SCOPES.map((scope) => (
              <div key={scope} className="dsh-qa-settings__toggle-row">
                <label className="dsh-qa-settings__toggle">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      toggleScope(scope, event.currentTarget.checked)
                    }
                  />
                  <span className="dsh-qa-settings__toggle-label">
                    {SCOPE_LABELS[scope]}
                  </span>
                </label>
              </div>
            ))}
            <p className="dsh-qa-settings__field-hint">
              Права ограничивают токен, но не расширяют доступ вашей учётной
              записи: токен не может больше того, что можете вы.
            </p>
            <QaSettingsField
              label="Срок, дней"
              hint={`От ${String(QA_SERVICE_TOKEN_TTL_DAYS_MIN)} до ${String(QA_SERVICE_TOKEN_TTL_DAYS_MAX)}; по умолчанию — срок вашей сессии.`}
            >
              <select
                value={days}
                onChange={(event) =>
                  setDays(Number(event.currentTarget.value))
                }
              >
                {TTL_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </QaSettingsField>
            <QaSettingsActions>
              <QaSettingsButton
                type="submit"
                tone="primary"
                disabled={busy}
                label={busy ? "Создание…" : "Создать токен"}
              />
            </QaSettingsActions>
          </form>
        ) : (
          <QaSettingsNotice tone="info">
            Интеграционный API выключен на этом стенде, поэтому создавать токены
            пока не для чего. Выданные ранее токены остаются в списке ниже — их
            можно отозвать.
          </QaSettingsNotice>
        )}
      </QaSettingsSection>
      <QaSettingsSection title="Выданные токены">
        {error === null ? null : (
          <QaSettingsNotice tone="error">{error}</QaSettingsNotice>
        )}
        {loading ? (
          <p className="dsh-qa-settings__field-hint">Загрузка…</p>
        ) : tokens.length === 0 ? (
          <p className="dsh-qa-settings__field-hint">
            У вас пока нет интеграционных токенов.
          </p>
        ) : (
          <ul className="dsh-qa-settings__rows">
            {tokens.map((token) => {
              const state = tokenState(token, now);
              const confirming = pendingRevoke === token.id;
              return (
                <li key={token.id} className="dsh-qa-settings__row">
                  <div className="dsh-qa-settings__row-button">
                    <span className="dsh-qa-settings__row-title">
                      {token.label}
                    </span>
                    <span className="dsh-qa-settings__row-description">
                      {scopeLabels(token.scopes)}
                    </span>
                    <span className="dsh-qa-settings__row-meta">
                      создан {day(token.createdAt)} · до {day(token.expiresAt)} ·
                      использований: {token.useCount}
                      {token.lastUsedAt === null
                        ? ""
                        : ` · последний раз ${day(token.lastUsedAt)}`}
                    </span>
                    {state === "active" ? null : (
                      <span
                        className={
                          state === "revoked"
                            ? "dsh-qa-settings__row-meta"
                            : "dsh-qa-settings__row-warning"
                        }
                      >
                        {state === "revoked"
                          ? "отозван"
                          : "истёк — интеграция больше не может им пользоваться"}
                      </span>
                    )}
                    {state === "active" ? (
                      <QaSettingsActions>
                        {confirming ? (
                          <>
                            <QaSettingsButton
                              label="Отмена"
                              onClick={() => setPendingRevoke(null)}
                            />
                            <QaSettingsButton
                              tone="danger"
                              disabled={revoking === token.id}
                              label={
                                revoking === token.id
                                  ? "Отзываем…"
                                  : "Отозвать окончательно"
                              }
                              onClick={() => revoke(token.id)}
                            />
                          </>
                        ) : (
                          <QaSettingsButton
                            tone="danger"
                            label="Отозвать"
                            title={`Отозвать токен «${token.label}»`}
                            onClick={() => setPendingRevoke(token.id)}
                          />
                        )}
                      </QaSettingsActions>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QaSettingsSection>
    </div>
  );
}
