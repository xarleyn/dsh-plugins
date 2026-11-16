import { useState } from "react";
import type { QaAdminUserRow } from "../../types.js";
import { QaModal } from "../components/QaModal.js";
import { pluralRu } from "../settings/format.js";
import type { QaAdminApi } from "../types.js";
import { adminErrorMessage } from "./shared.js";

export function DeleteUserDialog(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly user: QaAdminUserRow;
  readonly onClose: () => void;
  readonly onDeleted: (notice: string) => void;
}) {
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { user } = props;
  const name = user.fullName || user.displayName;
  const close = () => {
    if (!busy) props.onClose();
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.api.deleteUser(
        props.token,
        user.id,
        purge,
        user.conversations,
      );
      if (!result.ok) throw result.error;
      const scope =
        result.value === 0
          ? ""
          : ` ${purge ? "Удалено" : "Сохранено"} разговоров — ${String(result.value)}.`;
      props.onDeleted(`Аккаунт «${name}» удалён.${scope}`);
    } catch (reason) {
      setError(adminErrorMessage(reason));
      setBusy(false);
    }
  };
  return (
    <QaModal
      open
      title="Удалить аккаунт?"
      closeLabel="Закрыть окно удаления"
      onClose={close}
      footer={
        <>
          <button type="button" disabled={busy} onClick={close}>
            Отмена
          </button>
          <button
            type="button"
            className="dsh-qa-admin__confirm-delete"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy
              ? "Удаляю…"
              : purge
                ? `Удалить аккаунт и ${pluralRu(user.conversations, ["разговор", "разговора", "разговоров"])}`
                : "Удалить аккаунт"}
          </button>
        </>
      }
    >
      <div className="dsh-qa-admin__delete-user">
        <div className="dsh-qa-admin__delete-person">
          <span aria-hidden="true">
            {name
              .split(/\s+/u)
              .slice(0, 2)
              .map((part) => part.slice(0, 1))
              .join("")
              .toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <p>
          Пользователь потеряет доступ сразу. Восстановить аккаунт после
          удаления нельзя.
        </p>
        {user.conversations > 0 ? (
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={purge}
              aria-describedby="qa-delete-user-hint"
              onChange={(e) => setPurge(e.currentTarget.checked)}
            />
            <span>
              <strong>Удалить также разговоры ({user.conversations})</strong>
              <small id="qa-delete-user-hint" aria-live="polite">
                {purge
                  ? "Переписка и оценки этих разговоров будут удалены безвозвратно."
                  : "Переписка и оценки сохранятся в разделе «Разговоры»."}
              </small>
            </span>
          </label>
        ) : (
          <p>У пользователя нет разговоров.</p>
        )}
        {error && (
          <p role="alert" className="dsh-qa-admin__error">
            {error}
          </p>
        )}
      </div>
    </QaModal>
  );
}
