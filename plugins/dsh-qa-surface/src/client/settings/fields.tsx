/**
 * Shared controls of the QA Surface card body.
 *
 * Every control edits the settings namespace through the same path-addressed
 * write, and text and number drafts commit on blur or Enter rather than per
 * keystroke: a half-typed path or an emptied number is a value the Host
 * refuses, and a refusal mid-typing would clear the field the user is still
 * editing. Controls that must land together (a provider with its model, the
 * per-user sandbox with its flag) write every path in one mutation, because
 * the Host validates the section as a whole.
 */

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import {
  formatIdentityFields,
  parseIdentityFields,
  parseNumberDraft,
  type IdentityFieldDraft,
} from "./format.js";

/** One field write inside the plugin's settings namespace. */
export interface ConfigEntry {
  readonly path: readonly string[];
  readonly value: unknown;
}

/** Path-addressed write into the plugin's settings namespace. */
export type ConfigWrite = (path: readonly string[], value: unknown) => void;

/** Several path-addressed writes applied as one mutation. */
export type ConfigWriteMany = (entries: readonly ConfigEntry[]) => void;

/** Path-addressed clear, so the field re-inherits the composition layer. */
export type ConfigUnset = (path: readonly string[]) => void;

/** Whether the raw user layer carries a path. */
export type OverrideCheck = (path: readonly string[]) => boolean;

export interface SectionProps {
  readonly writable: boolean;
  readonly write: ConfigWrite;
  readonly writeMany: ConfigWriteMany;
  readonly unset: ConfigUnset;
  readonly overridden: OverrideCheck;
}

/** Section frame: title, optional modified marker, optional trailing control. */
export function Section(props: {
  title: string;
  modified: boolean;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="qa-card-section">
      <div className="qa-card-section__title">
        <h3>
          {props.title}
          {props.modified ? (
            <span className="qa-card-modified">изменено</span>
          ) : null}
        </h3>
        {props.aside ??
          (props.hint === undefined ? null : (
            <span className="qa-card-muted">{props.hint}</span>
          ))}
      </div>
      {props.children}
    </section>
  );
}

/** Small clearing control shown beside a section the user layer overrides. */
export function ResetButton(props: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="qa-card-btn link"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/** Two-state control with a label and an explanatory hint. */
export function Toggle(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="qa-card-toggle-row">
      <span className="qa-card-toggle-copy">
        <strong>{props.label}</strong>
        <span>{props.hint}</span>
      </span>
      <input
        className="qa-card-toggle"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.currentTarget.checked);
        }}
      />
    </label>
  );
}

/** Fixed-option control for the schema's string unions. */
export function SelectField(props: {
  label: string;
  value: string;
  disabled: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="qa-card-field">
      <span>{props.label}</span>
      <select
        className="qa-card-control"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint === undefined ? null : (
        <span className="qa-card-muted">{props.hint}</span>
      )}
    </label>
  );
}

/** Text control; the draft commits on blur and on Enter. */
export function TextField(props: {
  label: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const commit = () => {
    if (draft !== props.value) props.onChange(draft);
  };

  const shared = {
    className: "qa-card-control",
    value: draft,
    placeholder: props.placeholder ?? "",
    disabled: props.disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.currentTarget.value);
    },
  };

  return (
    <label className="qa-card-field">
      <span>{props.label}</span>
      {props.multiline === true ? (
        <textarea {...shared} rows={props.rows ?? 3} onBlur={commit} />
      ) : (
        <input
          {...shared}
          type="text"
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      )}
      {props.hint === undefined ? null : (
        <span className="qa-card-muted">{props.hint}</span>
      )}
    </label>
  );
}

/**
 * Whole-number control; the draft commits on blur and on Enter. A value
 * outside the range snaps into it on commit, so the field never holds a
 * number the Host would refuse outright.
 */
export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);

  const commit = () => {
    const next = parseNumberDraft(draft, props.min, props.max);
    if (next === null) {
      setDraft(String(props.value));
      return;
    }
    setDraft(String(next));
    if (next !== props.value) props.onChange(next);
  };

  return (
    <label className="qa-card-field">
      <span>
        {props.label}{" "}
        <span className="qa-card-muted">
          ({props.min}–{props.max})
        </span>
      </span>
      <input
        className="qa-card-control"
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={draft}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {props.hint === undefined ? null : (
        <span className="qa-card-muted">{props.hint}</span>
      )}
    </label>
  );
}

/**
 * List control for string arrays. The draft parses on commit so a separator
 * the user is still typing never becomes a stored entry.
 */
export function ListField(props: {
  label: string;
  hint?: string;
  value: readonly string[];
  disabled: boolean;
  placeholder?: string;
  rows?: number;
  parse: (text: string) => string[];
  onCommit: (values: string[]) => void;
}) {
  // The draft follows the stored text, not the array identity: a caller that
  // passes an equal but fresh list (an unset field, whose default is written
  // as a literal) would otherwise reset the control on every render and eat
  // what the user is typing.
  const stored = props.value.join("\n");
  const [draft, setDraft] = useState(stored);
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const commit = () => {
    const next = props.parse(draft);
    if (next.join("\u0000") !== props.value.join("\u0000")) {
      props.onCommit(next);
    }
  };

  return (
    <label className="qa-card-field">
      <span>{props.label}</span>
      <textarea
        className="qa-card-control"
        rows={props.rows ?? 4}
        value={draft}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
      />
      {props.hint === undefined ? null : (
        <span className="qa-card-muted">{props.hint}</span>
      )}
    </label>
  );
}

/**
 * The deployment's declared profile fields, one `key = подпись` per line. The
 * control keeps its own draft so a line still being typed is not parsed into
 * the stored array.
 */
export function IdentitiesField(props: {
  value: ReadonlyArray<{
    readonly key?: string | undefined;
    readonly label?: string | undefined;
  }>;
  disabled: boolean;
  onCommit: (fields: IdentityFieldDraft[]) => void;
}) {
  const value = formatIdentityFields(
    props.value.flatMap((field) =>
      field.key === undefined
        ? []
        : [{ key: field.key, label: field.label ?? field.key }],
    ),
  );
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = parseIdentityFields(draft);
    if (formatIdentityFields(next) !== value) props.onCommit(next);
  };

  return (
    <label className="qa-card-field">
      <span>Поля профиля пользователя</span>
      <textarea
        className="qa-card-control"
        rows={4}
        value={draft}
        placeholder={"jira = Jira\nconfluence = Confluence"}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
      />
      <span className="qa-card-muted">
        По строке на поле, формат «ключ = подпись». Ключ — латиница в нижнем
        регистре, до 8 полей. Пользователь заполняет эти поля в своём профиле, и
        они уходят в системную подсказку.
      </span>
    </label>
  );
}

/** Status chip pair: label and value with the mode's tone. */
export function Chip(props: { label: string; value: string; tone?: string }) {
  return (
    <span
      className={
        props.tone === undefined ? "qa-card-chip" : `qa-card-chip ${props.tone}`
      }
    >
      {props.label} <b>{props.value}</b>
    </span>
  );
}

/** Prose notice: informational or warning, never a control. */
export function Notice(props: { tone: "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`qa-card-notice ${props.tone}`} role="status">
      {props.children}
    </div>
  );
}

/** Fixed facts of the composed policy, shown as label/value rows. */
export function Facts(props: {
  items: ReadonlyArray<{ label: string; value: string; note?: string }>;
}) {
  return (
    <div className="qa-card-rows">
      {props.items.map((item) => (
        <div className="qa-card-row" key={item.label}>
          <span>
            <b>{item.label}</b>
            {item.note === undefined ? null : (
              <span className="qa-card-muted"> {item.note}</span>
            )}
          </span>
          <code>{item.value}</code>
        </div>
      ))}
    </div>
  );
}
