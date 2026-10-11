/**
 * Shared controls of the Safety Gate card body.
 *
 * Every control edits the settings namespace through the same path-addressed
 * write, and text and number drafts commit on blur or Enter rather than per
 * keystroke: a half-typed number or an emptied provider name is a value the
 * Host refuses, and a refusal mid-typing would clear the field the user is
 * still editing.
 */

import { useEffect, useState, type ReactNode } from "react";
import { parseListDraft, parseNumberDraft } from "./format.js";

/** Path-addressed write into the plugin's settings namespace. */
export type ConfigWrite = (path: readonly string[], value: unknown) => void;

/** Path-addressed clear, so the field re-inherits the composition layer. */
export type ConfigUnset = (path: readonly string[]) => void;

/** Whether the raw user layer carries a path. */
export type OverrideCheck = (path: readonly string[]) => boolean;

export interface SectionProps {
  readonly writable: boolean;
  readonly write: ConfigWrite;
  readonly unset: ConfigUnset;
  readonly overridden: OverrideCheck;
}

/**
 * Section frame: title, optional modified marker, optional trailing control.
 *
 * The `testId` names the frame, and the override marker hangs its own id off it
 * (`<section>-modified`) so a test reads "this plane is overridden" off a node
 * rather than off the word `modified`.
 */
export function Section(props: {
  testId: string;
  title: string;
  modified: boolean;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="msg-section" data-testid={props.testId}>
      <div className="msg-section-title">
        <h3>
          {props.title}
          {props.modified ? (
            <span
              className="msg-modified"
              data-testid={`${props.testId}-modified`}
            >
              modified
            </span>
          ) : null}
        </h3>
        {props.aside ??
          (props.hint === undefined ? null : (
            <span className="msg-muted">{props.hint}</span>
          ))}
      </div>
      {props.children}
    </section>
  );
}

/** Two-state control with a label and an explanatory hint. */
export function Toggle(props: {
  testId: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="msg-toggle-row">
      <span className="msg-toggle-copy">
        <strong>{props.label}</strong>
        <span>{props.hint}</span>
      </span>
      <input
        className="msg-toggle"
        type="checkbox"
        data-testid={props.testId}
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
  testId: string;
  label: string;
  value: string;
  disabled: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="msg-field">
      <span>{props.label}</span>
      <select
        className="msg-control"
        data-testid={props.testId}
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
    </label>
  );
}

/** Whole-number control; the draft commits on blur and on Enter. */
export function NumberField(props: {
  testId: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);

  const commit = () => {
    const next = parseNumberDraft(draft);
    if (next === null) {
      setDraft(String(props.value));
      return;
    }
    if (next !== props.value) props.onChange(next);
  };

  return (
    <label className="msg-field">
      <span>{props.label}</span>
      <input
        className="msg-control"
        type="number"
        inputMode="numeric"
        data-testid={props.testId}
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
    </label>
  );
}

/** Text control; the draft commits on blur and on Enter. */
export function TextField(props: {
  testId: string;
  label: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const commit = () => {
    if (draft !== props.value) props.onChange(draft);
  };

  return (
    <label className="msg-field">
      <span>{props.label}</span>
      <input
        className="msg-control"
        type="text"
        data-testid={props.testId}
        value={draft}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}

/**
 * A list control (tool names, extra patterns). The draft parses on commit so a
 * separator the user is still typing never becomes a stored entry.
 */
export function ListField(props: {
  testId: string;
  label: string;
  hint: string;
  value: readonly string[];
  disabled: boolean;
  placeholder?: string;
  onCommit: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState(props.value.join(", "));
  useEffect(() => {
    setDraft(props.value.join(", "));
  }, [props.value]);

  const commit = () => {
    const next = parseListDraft(draft);
    if (next.join("\u0000") !== props.value.join("\u0000"))
      props.onCommit(next);
  };

  return (
    <label className="msg-field">
      <span>{props.label}</span>
      <textarea
        className="msg-control"
        rows={3}
        data-testid={props.testId}
        value={draft}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
      />
      <span className="msg-muted">{props.hint}</span>
    </label>
  );
}

/**
 * Grouped counters rendered as one row of tiles.
 *
 * Each tile counts a different thing, so the call site names every one of them;
 * sharing the group id across the tiles would leave a single counter reachable
 * only through its caption.
 */
export function Stats(props: {
  testId: string;
  items: ReadonlyArray<{ testId: string; value: string; label: string }>;
}) {
  return (
    <div className="msg-stats" data-testid={props.testId}>
      {props.items.map((item) => (
        <div className="msg-stat" data-testid={item.testId} key={item.testId}>
          <b>{item.value}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Write-only credential control. The configuration form never returns a secret, so
 * the field starts blank on every render and a save writes the typed literal;
 * a blank draft writes nothing, which is what keeps a page open on the card
 * from clearing a key it never saw.
 */
export function SecretField(props: {
  testId: string;
  label: string;
  configured: boolean | null;
  disabled: boolean;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="msg-field" data-testid={props.testId}>
      <span>
        {props.label}
        {props.configured === true ? " — configured" : ""}
      </span>
      <div className="msg-editor">
        <input
          className="msg-control"
          type="password"
          autoComplete="off"
          data-testid={`${props.testId}-input`}
          value={draft}
          disabled={props.disabled}
          placeholder={
            props.configured === true
              ? "Type a new key to replace it"
              : props.placeholder
          }
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
        />
        <button
          type="button"
          className="msg-btn"
          data-testid={`${props.testId}-save`}
          disabled={props.disabled || draft.length === 0}
          onClick={() => {
            props.onSave(draft);
            setDraft("");
          }}
        >
          Save key
        </button>
      </div>
    </div>
  );
}

/** Status chip pair: label and value with the mode's tone. */
export function Chip(props: {
  testId: string;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <span
      className={
        props.tone === undefined ? "msg-chip" : `msg-chip ${props.tone}`
      }
      data-testid={props.testId}
    >
      {props.label} <b>{props.value}</b>
    </span>
  );
}
