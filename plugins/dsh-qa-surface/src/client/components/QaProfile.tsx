import { useEffect, useState, type FormEvent } from "react";
import {
  QA_PROFILE_MAX_FULL_NAME,
  QA_PROFILE_MAX_IDENTITY_VALUE,
} from "../../profile.js";
import type {
  QaAccountIdentityField,
  QaAccountProfile,
  QaAccountProfileInput,
} from "../../types.js";
import { QaModal } from "./QaModal.js";

/** Form id the footer's submit control is bound to. */
const FORM_ID = "dsh-qa-profile-form";

export interface QaProfileModalProps {
  readonly open: boolean;
  readonly email: string;
  readonly profile: QaAccountProfile;
  /** Handle fields the deployment declares, in its configured order. */
  readonly identities: readonly QaAccountIdentityField[];
  readonly instructionsMaxLength: number;
  readonly onClose: () => void;
  /**
   * Persist the edited profile. Resolves to audience-safe refusal copy, or
   * null once the Host stored it.
   */
  readonly onSave: (input: QaAccountProfileInput) => Promise<string | null>;
}

/**
 * The signed-in user's own profile: the full name, one field per declared
 * external system, and the free-form instructions the assistant receives.
 *
 * The form is seeded from the stored profile each time it opens, so a closed
 * dialog never keeps stale edits; limits mirror the Host's, which stays the
 * authority — the browser only avoids a round trip for the obvious refusals.
 */
export function QaProfileModal(props: QaProfileModalProps) {
  const [fullName, setFullName] = useState("");
  const [handles, setHandles] = useState<Readonly<Record<string, string>>>({});
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) return;
    setFullName(props.profile.fullName);
    setHandles({ ...props.profile.identities });
    setInstructions(props.profile.instructions);
    setBusy(false);
    setError(null);
  }, [props.open, props.profile]);
  const tooLong =
    fullName.trim().length > QA_PROFILE_MAX_FULL_NAME ||
    instructions.length > props.instructionsMaxLength;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || tooLong) return;
    setBusy(true);
    setError(null);
    const input: QaAccountProfileInput = {
      fullName,
      // Only declared fields travel: the Host refuses undeclared keys, and a
      // field the deployment withdrew must not be silently re-sent.
      identities: Object.fromEntries(
        props.identities.map((field) => [field.key, handles[field.key] ?? ""]),
      ),
      instructions,
    };
    void props.onSave(input).then((refusal) => {
      setBusy(false);
      if (refusal !== null) {
        setError(refusal);
        return;
      }
      props.onClose();
    });
  };
  return (
    <QaModal
      open={props.open}
      title="Профиль"
      closeLabel="Закрыть профиль"
      onClose={props.onClose}
      // The hint lines are full sentences; the shared panel width wraps them
      // mid-sentence and leaves one word on the second line.
      wide
      footer={
        <>
          <button
            type="button"
            className="dsh-qa-profile__cancel"
            disabled={busy}
            onClick={props.onClose}
          >
            Отмена
          </button>
          <button
            type="submit"
            form={FORM_ID}
            className="dsh-qa-profile__save"
            disabled={busy || tooLong}
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </>
      }
    >
      <form id={FORM_ID} className="dsh-qa-profile" onSubmit={submit}>
        <p className="dsh-qa-profile__lead">
          Эти данные видит ассистент в ваших чатах: по указанным логинам он ищет
          ваши задачи, заявки и MR.
        </p>
        <label className="dsh-qa-profile__field">
          <span>Email</span>
          <input value={props.email} readOnly />
        </label>
        <label className="dsh-qa-profile__field">
          <span>ФИО</span>
          <input
            value={fullName}
            maxLength={QA_PROFILE_MAX_FULL_NAME}
            placeholder="Иван Иванов"
            autoComplete="name"
            onChange={(event) => setFullName(event.currentTarget.value)}
          />
        </label>
        {props.identities.map((field) => (
          <label key={field.key} className="dsh-qa-profile__field">
            <span>{field.label}</span>
            <input
              value={handles[field.key] ?? ""}
              maxLength={QA_PROFILE_MAX_IDENTITY_VALUE}
              placeholder={`Логин в ${field.label}`}
              onChange={(event) => {
                // Read the value now: React empties `currentTarget` before the
                // state updater below runs.
                const value = event.currentTarget.value;
                setHandles((current) => ({ ...current, [field.key]: value }));
              }}
            />
          </label>
        ))}
        {props.identities.length === 0 ? (
          <p className="dsh-qa-profile__hint">
            Внешние системы не настроены: доступны только ФИО и инструкции.
          </p>
        ) : null}
        <label className="dsh-qa-profile__field">
          <span>Общие инструкции для агента</span>
          <textarea
            rows={4}
            value={instructions}
            maxLength={props.instructionsMaxLength}
            placeholder="Например: отвечай кратко и всегда показывай, откуда взял данные."
            onChange={(event) => setInstructions(event.currentTarget.value)}
          />
        </label>
        <p className="dsh-qa-profile__count">
          {instructions.length} / {props.instructionsMaxLength}
        </p>
        <p className="dsh-qa-profile__hint">
          Инструкции задают стиль ответов, но не расширяют доступ к
          инструментам.
        </p>
        {error === null ? null : (
          <p className="dsh-qa-profile__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </QaModal>
  );
}
