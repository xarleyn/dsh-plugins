import { useState } from "react";
import type { QaSubrole } from "../../types.js";
import { QaModal } from "../components/QaModal.js";

export interface QaRoleSelectorProps {
  readonly roles: readonly QaSubrole[];
  readonly selected: string;
  readonly conversationStarted: boolean;
  readonly disabled?: boolean;
  readonly onSelect: (subroleId: string) => void;
}

/** Visible only when the account can actually choose between profiles. */
export function QaRoleSelector(props: QaRoleSelectorProps) {
  const [pending, setPending] = useState<QaSubrole>();
  if (props.roles.length <= 1) return null;
  const select = (id: string) => {
    if (id === props.selected) return;
    const role = props.roles.find((candidate) => candidate.id === id);
    if (role === undefined) return;
    if (props.conversationStarted) {
      setPending(role);
    } else {
      props.onSelect(role.id);
    }
  };
  return (
    <>
      <label className="dsh-qa-role-selector" data-testid="qa-role-selector">
        <span className="dsh-qa-sr-only">Роль ассистента</span>
        <select
          data-testid="qa-role-selector-input"
          value={props.selected}
          disabled={props.disabled}
          aria-label="Роль ассистента"
          onChange={(event) => select(event.currentTarget.value)}
        >
          {props.roles.map((role) => (
            <option
              key={role.id}
              value={role.id}
              data-testid="qa-role-selector-option"
            >
              {role.name}
            </option>
          ))}
        </select>
      </label>
      <QaModal
        open={pending !== undefined}
        title="Начать новый чат?"
        closeLabel="Отменить смену роли"
        onClose={() => setPending(undefined)}
        footer={
          <>
            <button
              type="button"
              data-testid="qa-role-change-cancel"
              onClick={() => setPending(undefined)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="dsh-qa-modal__primary"
              data-testid="qa-role-change-confirm"
              onClick={() => {
                if (pending !== undefined) props.onSelect(pending.id);
                setPending(undefined);
              }}
            >
              Начать новый чат как {pending?.name ?? ""}
            </button>
          </>
        }
      >
        <p
          className="dsh-qa-role-selector__notice"
          data-testid="qa-role-change-notice"
        >
          Смена роли начинает новый разговор: доступные ассистенту инструменты и
          навыки изменятся. Текущий чат останется в истории без изменений.
        </p>
      </QaModal>
    </>
  );
}

/**
 * The banner that keeps a preview from being mistaken for an ordinary chat.
 *
 * It carries the way out as well: while previewing, the header's role selector
 * is hidden — the previewed profile need not be one the account holds — so
 * without a control here the only exit was the browser's Back button, and a new
 * chat meanwhile ran as the previewed profile instead of the account's default.
 *
 * Leaving is a new chat, so the way out waits for the same moments the header's
 * "Новый чат" and the role selector wait for: while a chat is still being
 * created, this click would take the screen from the question on its way in.
 * @param props - the previewed role's name, how to leave the preview, and whether
 * that way is currently blocked by a chat being created.
 */
export function QaAdminPreviewBanner(props: {
  readonly role: string;
  readonly onExit?: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <div
      className="dsh-qa-admin-preview"
      data-testid="qa-admin-preview"
      role="status"
    >
      <span data-testid="qa-admin-preview-role">
        ПРОСМОТР АДМИНИСТРАТОРА: {props.role}
      </span>
      {props.onExit === undefined ? null : (
        <button
          type="button"
          className="dsh-qa-admin-preview__exit"
          data-testid="qa-admin-preview-exit"
          onClick={props.onExit}
          disabled={props.disabled === true}
          title="Вернуться к своему профилю по умолчанию: просмотр закончится, следующий чат начнётся заново"
        >
          Выйти из просмотра
        </button>
      )}
    </div>
  );
}
