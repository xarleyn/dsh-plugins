import { useEffect, useState } from "react";
import { QaModal } from "./QaModal.js";
import type { QaSharingApi } from "../chat-sharing-api.js";
import type {
  QaChatAccess,
  QaChatGrant,
  QaChatMode,
} from "../../chat-sharing/types.js";

export const qaChatModeLabel = (mode: QaChatAccess["mode"]): string =>
  mode === "owner"
    ? "Владелец"
    : mode === "read"
      ? "Только чтение"
      : "Совместная работа";

export function QaChatSharing(props: {
  access: QaChatAccess;
  token: string;
  api: QaSharingApi;
  open: boolean;
  onClose: () => void;
}) {
  const open = props.open;
  const [grants, setGrants] = useState<readonly QaChatGrant[]>([]);
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<QaChatMode>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || props.access.mode !== "owner") return;
    let active = true;
    setBusy(true);
    setError(null);
    void props.api
      .grants(props.token, props.access.sessionId)
      .then((result) => {
        if (!active) return;
        if (result.ok) setGrants(result.value);
        else setError("Не удалось прочитать права доступа.");
      })
      .catch(() => {
        if (active) setError("Не удалось прочитать права доступа.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open, props.api, props.token, props.access.sessionId, props.access.mode]);
  const update = async (address: string, next: QaChatMode | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await props.api.set(
        props.token,
        props.access.sessionId,
        address,
        next,
      );
      if (result.ok) {
        setGrants(result.value);
        setEmail("");
      } else
        setError(
          "Не удалось изменить доступ. Проверьте адрес существующего аккаунта.",
        );
    } catch {
      setError("Не удалось изменить доступ. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };
  if (props.access.mode !== "owner") return null;
  return (
    <QaModal
      open={open}
      title="Доступ к чату"
      closeLabel="Закрыть доступ к чату"
      onClose={props.onClose}
    >
      <div className="dsh-qa-sharing__body">
        <p className="dsh-qa-sharing__intro">
          Доступ для выбранных аккаунтов: история, ответы и материалы этого
          чата.
        </p>
        <details className="dsh-qa-sharing__details">
          <summary>Как работает совместный доступ</summary>
          <p>
            Помощник использует модель и учётные данные владельца. В ходе
            соавтора действуют только общие для него и чата права; личные
            интеграции владельца недоступны. Инструменты, которым требуется
            доступ к ресурсам владельца, сможет запустить владелец. Согласование
            документов и управление чатом остаются у владельца. Рабочая папка
            целиком участникам не доступна.
          </p>
        </details>
        <form
          className="dsh-qa-sharing__form"
          onSubmit={(event) => {
            event.preventDefault();
            void update(email.trim(), mode);
          }}
        >
          <label>
            Адрес аккаунта
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <label>
            Режим доступа
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as QaChatMode)}
              disabled={busy}
            >
              <option value="read">Только чтение</option>
              <option value="collaborate">Совместная работа</option>
            </select>
          </label>
          <button
            className="dsh-qa-btn"
            type="submit"
            disabled={busy || email.trim() === ""}
          >
            Предоставить доступ
          </button>
        </form>
        {error === null ? null : <p role="alert">{error}</p>}
        <ul className="dsh-qa-sharing__people">
          {grants.map((grant) => (
            <li key={grant.userId}>
              <span>
                {grant.displayName}
                <small>{grant.email}</small>
              </span>
              <select
                aria-label={`Режим доступа: ${grant.displayName}`}
                value={grant.mode}
                disabled={busy}
                onChange={(event) => {
                  void update(grant.email, event.target.value as QaChatMode);
                }}
              >
                <option value="read">Только чтение</option>
                <option value="collaborate">Совместная работа</option>
              </select>
              <button
                type="button"
                className="dsh-qa-btn dsh-qa-btn--ghost"
                disabled={busy}
                onClick={() => {
                  void update(grant.email, null);
                }}
              >
                Отозвать доступ
              </button>
            </li>
          ))}
        </ul>
        {!busy && grants.length === 0 ? <p>Чат доступен только вам.</p> : null}
      </div>
    </QaModal>
  );
}

export const QA_SHARING_STYLES = `
.dsh-qa-sharing__body{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-sharing__intro{margin:0 0 8px;line-height:1.5}
.dsh-qa-sharing__details{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dsh-qa-sharing__details summary{cursor:pointer}
.dsh-qa-sharing__body .dsh-qa-btn{appearance:none;cursor:pointer;min-height:36px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 12px}
.dsh-qa-sharing__body .dsh-qa-btn:hover{background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-sharing__body .dsh-qa-btn:disabled{cursor:default;opacity:.55}
.dsh-qa-sharing__body .dsh-qa-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dsh-qa-sharing__form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,160px);gap:12px;margin:20px 0}
.dsh-qa-sharing__form>.dsh-qa-btn{grid-column:1/-1;justify-self:start}
.dsh-qa-sharing__body label{display:flex;flex-direction:column;gap:6px}
.dsh-qa-sharing__body input,.dsh-qa-sharing__body select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;min-width:0;max-width:100%}
.dsh-qa-sharing__people{list-style:none;padding:0;margin:16px 0}
.dsh-qa-sharing__people li{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-sharing__people span{flex:1;min-width:140px;overflow-wrap:anywhere}
.dsh-qa-sharing__people small{display:block;color:var(--dsw-alias-label-tertiary)}
@media(max-width:480px){.dsh-qa-sharing__form{grid-template-columns:minmax(0,1fr)}}
`;
