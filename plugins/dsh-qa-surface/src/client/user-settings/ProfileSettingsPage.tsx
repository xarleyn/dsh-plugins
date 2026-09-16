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
import {
  QaSettingsActions,
  QaSettingsButton,
  QaSettingsField,
  QaSettingsNotice,
} from "./fields.js";

const FORM_ID = "dsh-qa-settings-profile-form";

export interface QaProfileSettingsPageProps {
  readonly email: string;
  readonly profile: QaAccountProfile;
  /** Handle fields the deployment declares, in its configured order. */
  readonly identities: readonly QaAccountIdentityField[];
  readonly instructionsMaxLength: number;
  /** Persist the edited profile; resolves to refusal copy, or null. */
  readonly onSave: (input: QaAccountProfileInput) => Promise<string | null>;
}

/**
 * The signed-in user's profile, moved into the settings dialog unchanged: the
 * same fields, the same storage and the same limits as the modal it replaces.
 * The form is seeded from the stored profile whenever that profile changes, so
 * a reload or a write from another tab never leaves stale edits on screen.
 */
export function QaProfileSettingsPage(props: QaProfileSettingsPageProps) {
  const [fullName, setFullName] = useState(props.profile.fullName);
  const [handles, setHandles] = useState<Readonly<Record<string, string>>>(
    props.profile.identities,
  );
  const [instructions, setInstructions] = useState(props.profile.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setFullName(props.profile.fullName);
    setHandles({ ...props.profile.identities });
    setInstructions(props.profile.instructions);
    setBusy(false);
    setError(null);
    setSaved(false);
  }, [props.profile]);
  const tooLong =
    fullName.trim().length > QA_PROFILE_MAX_FULL_NAME ||
    instructions.length > props.instructionsMaxLength;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || tooLong) return;
    setBusy(true);
    setError(null);
    setSaved(false);
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
      setSaved(true);
    });
  };
  return (
    <form id={FORM_ID} className="dsh-qa-settings__page" onSubmit={submit}>
      <h3 className="dsh-qa-settings__page-title">Профиль</h3>
      <p className="dsh-qa-settings__lead">
        Эти данные видит ассистент в ваших чатах: по указанным логинам он ищет
        ваши задачи, заявки и MR.
      </p>
      <QaSettingsField label="Email">
        <input value={props.email} readOnly />
      </QaSettingsField>
      <QaSettingsField label="ФИО">
        <input
          value={fullName}
          maxLength={QA_PROFILE_MAX_FULL_NAME}
          placeholder="Иван Иванов"
          autoComplete="name"
          onChange={(event) => setFullName(event.currentTarget.value)}
        />
      </QaSettingsField>
      {props.identities.map((field) => (
        <QaSettingsField key={field.key} label={field.label}>
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
        </QaSettingsField>
      ))}
      {props.identities.length === 0 ? (
        <p className="dsh-qa-settings__field-hint">
          Внешние системы не настроены: доступны только ФИО и инструкции.
        </p>
      ) : null}
      <QaSettingsField label="Общие инструкции для агента">
        <textarea
          rows={5}
          value={instructions}
          maxLength={props.instructionsMaxLength}
          placeholder="Например: отвечай кратко и всегда показывай, откуда взял данные."
          onChange={(event) => setInstructions(event.currentTarget.value)}
        />
      </QaSettingsField>
      <p className="dsh-qa-settings__count">
        {instructions.length} / {props.instructionsMaxLength}
      </p>
      <p className="dsh-qa-settings__field-hint">
        Инструкции задают стиль ответов, но не расширяют доступ к инструментам.
      </p>
      {error === null ? null : (
        <QaSettingsNotice tone="error">{error}</QaSettingsNotice>
      )}
      {saved && error === null ? (
        <QaSettingsNotice tone="info">Профиль сохранён.</QaSettingsNotice>
      ) : null}
      <QaSettingsActions>
        <QaSettingsButton
          type="submit"
          tone="primary"
          disabled={busy || tooLong}
          label={busy ? "Сохранение…" : "Сохранить"}
        />
      </QaSettingsActions>
    </form>
  );
}
