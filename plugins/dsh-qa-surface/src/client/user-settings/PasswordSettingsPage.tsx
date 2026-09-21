import { useState, type FormEvent } from "react";
import {
  QaSettingsActions,
  QaSettingsButton,
  QaSettingsField,
  QaSettingsNotice,
} from "./fields.js";

/** The Host's own floor; repeated here so the form refuses before the round trip. */
const MIN_PASSWORD_LENGTH = 8;

export interface QaPasswordSettingsPageProps {
  /**
   * Replace the signed-in user's password; resolves to refusal copy, or to
   * null once the Host accepted it. The controller keeps this browser signed
   * in with the token that answer carries.
   */
  readonly onChange: (
    currentPassword: string,
    nextPassword: string,
  ) => Promise<string | null>;
}

/**
 * The password section of the settings dialog: current, new, repeat. The
 * repeat field is client-side only — it exists to catch a typo in the field
 * that, unlike a name, cannot be read back later.
 *
 * The consequence is stated rather than discovered: changing a password ends
 * every *other* session of this account, which is exactly the point after a
 * leak and exactly what looks like a bug when nobody said so.
 */
export function QaPasswordSettingsPage(props: QaPasswordSettingsPageProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const tooShort = next !== "" && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat !== "" && repeat !== next;
  const incomplete = current === "" || next === "" || repeat === "";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || incomplete || mismatch || tooShort) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    void props.onChange(current, next).then((refusal) => {
      setBusy(false);
      if (refusal !== null) {
        setError(refusal);
        return;
      }
      // The fields never keep a password that is no longer the account's: a
      // second submit after a success would be a change nobody asked for.
      setCurrent("");
      setNext("");
      setRepeat("");
      setSaved(true);
    });
  };
  return (
    <form className="dsh-qa-settings__page" onSubmit={submit}>
      <h3 className="dsh-qa-settings__page-title">Пароль</h3>
      <p className="dsh-qa-settings__lead">
        Смена пароля закрывает ваши сессии в других браузерах — там придётся
        войти заново. Текущая сессия сохранится.
      </p>
      <QaSettingsField label="Текущий пароль">
        <input
          type="password"
          name="current-password"
          autoComplete="current-password"
          required
          disabled={busy}
          value={current}
          onChange={(event) => setCurrent(event.currentTarget.value)}
        />
      </QaSettingsField>
      <QaSettingsField label="Новый пароль">
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={busy}
          value={next}
          onChange={(event) => setNext(event.currentTarget.value)}
        />
      </QaSettingsField>
      <QaSettingsField label="Новый пароль ещё раз">
        <input
          type="password"
          name="repeat-password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={busy}
          value={repeat}
          onChange={(event) => setRepeat(event.currentTarget.value)}
        />
      </QaSettingsField>
      {tooShort ? (
        <p className="dsh-qa-settings__field-hint">
          Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов.
        </p>
      ) : null}
      {mismatch ? (
        <p className="dsh-qa-settings__field-hint">Пароли не совпадают.</p>
      ) : null}
      {error === null ? null : (
        <QaSettingsNotice tone="error">{error}</QaSettingsNotice>
      )}
      {saved && error === null ? (
        <QaSettingsNotice tone="info">
          Пароль изменён. Другие сессии закрыты.
        </QaSettingsNotice>
      ) : null}
      <QaSettingsActions>
        <QaSettingsButton
          type="submit"
          tone="primary"
          disabled={busy || incomplete || mismatch || tooShort}
          label={busy ? "Сохранение…" : "Сменить пароль"}
        />
      </QaSettingsActions>
    </form>
  );
}
