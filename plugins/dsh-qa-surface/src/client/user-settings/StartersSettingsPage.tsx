import { useEffect, useState, type FormEvent } from "react";
import {
  QA_STARTERS_MAX_ITEMS,
  QA_STARTERS_MAX_LABEL,
  QA_STARTERS_MAX_PROMPT,
} from "../../starters.js";
import type { QaAccountStarters, QaAccountStartersInput } from "../../types.js";
import {
  QaSettingsActions,
  QaSettingsButton,
  QaSettingsNotice,
  QaSettingsToggle,
} from "./fields.js";

const FORM_ID = "dsh-qa-settings-starters-form";

/** One editable row: the label and the prompt travel together. */
interface StarterRow {
  readonly label: string;
  readonly prompt: string;
}

export interface QaStartersSettingsPageProps {
  readonly starters: QaAccountStarters;
  /** Persist the edited list; resolves to refusal copy, or null. */
  readonly onSave: (input: QaAccountStartersInput) => Promise<string | null>;
}

/**
 * The signed-in user's own starter buttons: what each button reads, what
 * pressing it sends, and whether the deployment's standard suggestions stay
 * visible next to them. Same full-replace contract as the profile form — the
 * list is seeded from the stored record whenever that record changes.
 */
export function QaStartersSettingsPage(props: QaStartersSettingsPageProps) {
  const [rows, setRows] = useState<readonly StarterRow[]>(() =>
    toRows(props.starters),
  );
  const [hideDefaults, setHideDefaults] = useState(props.starters.hideDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setRows(toRows(props.starters));
    setHideDefaults(props.starters.hideDefaults);
    setBusy(false);
    setError(null);
    setSaved(false);
  }, [props.starters]);
  const incomplete = rows.some(
    (row) => row.label.trim() === "" || row.prompt.trim() === "",
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || incomplete) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const input: QaAccountStartersInput = {
      items: rows.map((row) => ({
        label: row.label.trim(),
        prompt: row.prompt.trim(),
      })),
      hideDefaults,
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
      <p className="dsh-qa-settings__lead">
        Быстрые сообщения — кнопки над строкой ввода в пустом чате. Нажатие
        сразу отправляет промпт, не заполняя поле.
      </p>
      <QaSettingsToggle
        checked={!hideDefaults}
        label="Показывать стандартные подсказки"
        hint="Вопросы, заданные администратором стенда, остаются рядом с вашими кнопками."
        onChange={(visible) => {
          setHideDefaults(!visible);
          setSaved(false);
        }}
      />
      {rows.length === 0 ? (
        <p className="dsh-qa-settings__field-hint">
          Своих подсказок нет: в пустом чате показываются стандартные вопросы.
        </p>
      ) : (
        <div className="dsh-qa-starters__list">
          {rows.map((row, index) => (
            <div className="dsh-qa-starters__item" key={index}>
              <div className="dsh-qa-starters__item-head">
                <div className="dsh-qa-settings__field">
                  <label className="dsh-qa-settings__field-label">
                    Название
                    <input
                      value={row.label}
                      maxLength={QA_STARTERS_MAX_LABEL}
                      placeholder="Что видно на кнопке"
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRows((current) =>
                          current.map((candidate, at) =>
                            at === index
                              ? { ...candidate, label: value }
                              : candidate,
                          ),
                        );
                        setSaved(false);
                      }}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="dsh-qa-starters__remove"
                  aria-label={`Удалить «${row.label.trim() || "без названия"}»`}
                  title="Удалить"
                  onClick={() => {
                    setRows((current) =>
                      current.filter((_, at) => at !== index),
                    );
                    setSaved(false);
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8m0-8-8 8" />
                  </svg>
                </button>
              </div>
              <div className="dsh-qa-settings__field">
                <label className="dsh-qa-settings__field-label">
                  Промпт
                  <textarea
                    rows={2}
                    value={row.prompt}
                    maxLength={QA_STARTERS_MAX_PROMPT}
                    placeholder="Что уйдёт в чат при нажатии"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setRows((current) =>
                        current.map((candidate, at) =>
                          at === index
                            ? { ...candidate, prompt: value }
                            : candidate,
                        ),
                      );
                      setSaved(false);
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length >= QA_STARTERS_MAX_ITEMS ? (
        <p className="dsh-qa-settings__field-hint">
          Больше {String(QA_STARTERS_MAX_ITEMS)} подсказок не поместится.
        </p>
      ) : (
        <QaSettingsButton
          label="Добавить подсказку"
          onClick={() => {
            setRows((current) => [...current, { label: "", prompt: "" }]);
            setSaved(false);
          }}
        />
      )}
      {incomplete ? (
        <QaSettingsNotice tone="warn">
          В каждой подсказке нужны и название, и промпт — заполните или удалите
          пустые строки.
        </QaSettingsNotice>
      ) : null}
      {error === null ? null : (
        <QaSettingsNotice tone="error">{error}</QaSettingsNotice>
      )}
      {saved && error === null ? (
        <QaSettingsNotice tone="info">Подсказки сохранены.</QaSettingsNotice>
      ) : null}
      <QaSettingsActions>
        <QaSettingsButton
          type="submit"
          tone="primary"
          disabled={busy || incomplete}
          label={busy ? "Сохранение…" : "Сохранить"}
        />
      </QaSettingsActions>
    </form>
  );
}

function toRows(starters: QaAccountStarters): readonly StarterRow[] {
  return starters.items.map((item) => ({
    label: item.label,
    prompt: item.prompt,
  }));
}
