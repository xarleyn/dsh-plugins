/**
 * Small, dependency-free field controls for the settings card.
 *
 * Text and number inputs keep a local draft and commit on blur or Enter, so a
 * half-typed value never becomes a write and a refused write never clears the
 * field under the user's cursor. `overridden` marks a field whose value comes
 * from the user layer rather than the deployment default.
 */

import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useId, useState } from "react";

export interface ToggleProps {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly overridden?: boolean;
  readonly onToggle: (checked: boolean) => void;
}

export function Toggle(props: ToggleProps): ReactElement {
  const id = useId();
  return (
    <div className="jevc-row">
      <div className="jevc-row-text">
        <label className="jevc-row-label" htmlFor={id}>
          {props.label}
          {props.overridden === true ? (
            <span className="jevc-chip"> · overridden</span>
          ) : null}
        </label>
        {props.description === undefined ? null : (
          <span className="jevc-row-description">{props.description}</span>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        className="jevc-toggle"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onToggle(event.target.checked);
        }}
      />
    </div>
  );
}

export interface NumberFieldProps {
  readonly label: string;
  readonly description?: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled: boolean;
  readonly overridden?: boolean;
  readonly onCommit: (value: number | null) => void;
  /** Reported instead of a write when the draft is not a number. */
  readonly onInvalid?: (text: string) => void;
}

export function NumberField(props: NumberFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);

  const commit = (): void => {
    const text = draft.trim();
    if (text.length === 0) {
      props.onCommit(null);
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      props.onInvalid?.(text);
      setDraft(String(props.value));
      return;
    }
    props.onCommit(parsed);
  };

  return (
    <div className="jevc-field">
      <label className="jevc-field-label" htmlFor={id}>
        {props.label}
        {props.overridden === true ? (
          <span className="jevc-chip"> · overridden</span>
        ) : null}
      </label>
      <div className="jevc-inline">
        <input
          id={id}
          type="number"
          className="jevc-input jevc-input--number"
          value={draft}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          disabled={props.disabled}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        {props.unit === undefined ? null : (
          <span className="jevc-unit">{props.unit}</span>
        )}
      </div>
      {props.description === undefined ? null : (
        <p className="jevc-hint">{props.description}</p>
      )}
    </div>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly overridden?: boolean;
  /** Commit with an empty string to drop the override. */
  readonly onCommit: (value: string) => void;
}

export function TextField(props: TextFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  return (
    <div className="jevc-field">
      <label className="jevc-field-label" htmlFor={id}>
        {props.label}
        {props.overridden === true ? (
          <span className="jevc-chip"> · overridden</span>
        ) : null}
      </label>
      <input
        id={id}
        type="text"
        className="jevc-input"
        value={draft}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          props.onCommit(draft.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onCommit(draft.trim());
        }}
      />
      {props.description === undefined ? null : (
        <p className="jevc-hint">{props.description}</p>
      )}
    </div>
  );
}

export interface SelectFieldProps {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly disabled: boolean;
  readonly overridden?: boolean;
  readonly onCommit: (value: string) => void;
}

export function SelectField(props: SelectFieldProps): ReactElement {
  const id = useId();
  return (
    <div className="jevc-field">
      <label className="jevc-field-label" htmlFor={id}>
        {props.label}
        {props.overridden === true ? (
          <span className="jevc-chip"> · overridden</span>
        ) : null}
      </label>
      <select
        id={id}
        className="jevc-input"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onCommit(event.target.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.description === undefined ? null : (
        <p className="jevc-hint">{props.description}</p>
      )}
    </div>
  );
}

export interface TagListFieldProps {
  readonly label: string;
  readonly description?: string;
  readonly values: readonly string[];
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly overridden?: boolean;
  /** Commit the whole list; an empty list drops the override. */
  readonly onCommit: (values: string[]) => void;
}

/**
 * Editable list of tool names: entries render as removable chips plus a text
 * input that appends on Enter, so a list is never emptied by a stray
 * keystroke.
 */
export function TagListField(props: TagListFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = (): void => {
    const value = draft.trim();
    if (value.length === 0) return;
    if (props.values.includes(value)) {
      setDraft("");
      return;
    }
    props.onCommit([...props.values, value]);
    setDraft("");
  };

  return (
    <div className="jevc-field">
      <label className="jevc-field-label" htmlFor={id}>
        {props.label}
        {props.overridden === true ? (
          <span className="jevc-chip"> · overridden</span>
        ) : null}
      </label>
      <div className="jevc-tags">
        {props.values.length === 0 ? (
          <span className="jevc-empty">none</span>
        ) : (
          props.values.map((value) => (
            <span key={value} className="jevc-tag">
              {value}
              <button
                type="button"
                className="jevc-tag-remove"
                aria-label={`Remove ${value}`}
                disabled={props.disabled}
                onClick={() => {
                  props.onCommit(
                    props.values.filter((entry) => entry !== value),
                  );
                }}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="jevc-inline">
        <input
          id={id}
          type="text"
          className="jevc-input"
          value={draft}
          placeholder={props.placeholder ?? "add a tool name"}
          disabled={props.disabled}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="jevc-button"
          disabled={props.disabled || draft.trim().length === 0}
          onClick={add}
        >
          Add
        </button>
      </div>
      {props.description === undefined ? null : (
        <p className="jevc-hint">{props.description}</p>
      )}
    </div>
  );
}
