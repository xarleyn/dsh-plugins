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
import { useCopyAction } from "../clipboard.js";
import { CopyHint } from "../components/copy-hint.js";
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
  const {
    copied,
    impossible: copyImpossible,
    refused: copyRefused,
    copy: copySecret,
  } = useCopyAction(issued?.token ?? "");
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
  const now = Date.now();
  return (
    <div className="dsh-qa-settings__page" data-testid="qa-settings-tokens">
      <h3
        className="dsh-qa-settings__page-title"
        data-testid="qa-settings-tokens-title"
      >
        Интеграционные токены
      </h3>
      <p
        className="dsh-qa-settings__lead"
        data-testid="qa-settings-tokens-lead"
      >
        Токен — это ключ для другой программы: она задаёт вопросы от имени вашей
        учётной записи, не открывая браузер. Выдавайте отдельный токен каждой
        интеграции и отзывайте его, когда она больше не нужна. Токен переживает
        смену вашего пароля, поэтому отзывается отдельно.
      </p>
      {issued === null ? null : (
        <QaSettingsSection
          testId="qa-settings-tokens-issued"
          title="Токен создан"
        >
          <QaSettingsNotice
            tone="warn"
            testId="qa-settings-tokens-issued-notice"
          >
            Скопируйте значение сейчас и передайте его интеграции. Показать его
            повторно нельзя: на стенде хранится только отпечаток.
          </QaSettingsNotice>
          <QaSettingsField
            testId="qa-settings-tokens-secret"
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
            {copyImpossible ? (
              <CopyHint testId="qa-settings-tokens-copy-hint" />
            ) : (
              <>
                <QaSettingsButton
                  testId="qa-settings-tokens-copy"
                  label={copied ? "Скопировано" : "Скопировать"}
                  onClick={copySecret}
                />
                {copyRefused ? (
                  <CopyHint testId="qa-settings-tokens-copy-hint" />
                ) : null}
              </>
            )}
            <QaSettingsButton
              testId="qa-settings-tokens-ack"
              tone="primary"
              label="Я сохранил токен"
              onClick={() => setIssued(null)}
            />
          </QaSettingsActions>
        </QaSettingsSection>
      )}
      <QaSettingsSection testId="qa-settings-tokens-new" title="Новый токен">
        {props.api.canCreate ? (
          <form
            className="dsh-qa-settings__page"
            data-testid="qa-settings-tokens-create-form"
            onSubmit={submit}
          >
            <QaSettingsField
              testId="qa-settings-tokens-label"
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
              <div
                key={scope}
                className="dsh-qa-settings__toggle-row"
                data-testid="qa-settings-tokens-scope"
              >
                <label className="dsh-qa-settings__toggle">
                  <input
                    type="checkbox"
                    data-testid="qa-settings-tokens-scope-input"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      toggleScope(scope, event.currentTarget.checked)
                    }
                  />
                  <span
                    className="dsh-qa-settings__toggle-label"
                    data-testid="qa-settings-tokens-scope-label"
                  >
                    {SCOPE_LABELS[scope]}
                  </span>
                </label>
              </div>
            ))}
            <p
              className="dsh-qa-settings__field-hint"
              data-testid="qa-settings-tokens-scopes-hint"
            >
              Права ограничивают токен, но не расширяют доступ вашей учётной
              записи: токен не может больше того, что можете вы.
            </p>
            <QaSettingsField
              testId="qa-settings-tokens-ttl"
              label="Срок, дней"
              hint={`От ${String(QA_SERVICE_TOKEN_TTL_DAYS_MIN)} до ${String(QA_SERVICE_TOKEN_TTL_DAYS_MAX)}; по умолчанию — срок вашей сессии.`}
            >
              <select
                value={days}
                onChange={(event) => setDays(Number(event.currentTarget.value))}
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
                testId="qa-settings-tokens-create"
                type="submit"
                tone="primary"
                disabled={busy}
                label={busy ? "Создание…" : "Создать токен"}
              />
            </QaSettingsActions>
          </form>
        ) : (
          <QaSettingsNotice tone="info" testId="qa-settings-tokens-api-off">
            Интеграционный API выключен на этом стенде, поэтому создавать токены
            пока не для чего. Выданные ранее токены остаются в списке ниже — их
            можно отозвать.
          </QaSettingsNotice>
        )}
      </QaSettingsSection>
      <QaSettingsSection
        testId="qa-settings-tokens-list"
        title="Выданные токены"
      >
        {error === null ? null : (
          <QaSettingsNotice tone="error" testId="qa-settings-tokens-error">
            {error}
          </QaSettingsNotice>
        )}
        {loading ? (
          <p
            className="dsh-qa-settings__field-hint"
            data-testid="qa-settings-tokens-loading"
          >
            Загрузка…
          </p>
        ) : tokens.length === 0 ? (
          <p
            className="dsh-qa-settings__field-hint"
            data-testid="qa-settings-tokens-empty"
          >
            У вас пока нет интеграционных токенов.
          </p>
        ) : (
          <ul
            className="dsh-qa-settings__rows"
            data-testid="qa-settings-tokens-rows"
          >
            {tokens.map((token) => {
              const state = tokenState(token, now);
              const confirming = pendingRevoke === token.id;
              return (
                <li
                  key={token.id}
                  className="dsh-qa-settings__row"
                  data-testid="qa-settings-tokens-row"
                >
                  <div
                    className="dsh-qa-settings__row-button"
                    data-testid="qa-settings-tokens-row-body"
                  >
                    <span
                      className="dsh-qa-settings__row-title"
                      data-testid="qa-settings-tokens-row-title"
                    >
                      {token.label}
                    </span>
                    <span
                      className="dsh-qa-settings__row-description"
                      data-testid="qa-settings-tokens-row-scopes"
                    >
                      {scopeLabels(token.scopes)}
                    </span>
                    <span
                      className="dsh-qa-settings__row-meta"
                      data-testid="qa-settings-tokens-row-meta"
                    >
                      создан {day(token.createdAt)} · до {day(token.expiresAt)}{" "}
                      · использований: {token.useCount}
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
                        data-testid="qa-settings-tokens-row-state"
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
                              testId="qa-settings-tokens-revoke-cancel"
                              label="Отмена"
                              onClick={() => setPendingRevoke(null)}
                            />
                            <QaSettingsButton
                              testId="qa-settings-tokens-revoke-confirm"
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
                            testId="qa-settings-tokens-revoke"
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
