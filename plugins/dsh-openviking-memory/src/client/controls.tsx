/**
 * Body controls of the OpenViking Memory card.
 *
 * Text-like controls keep a local draft so keystrokes do not race the wire:
 * the draft commits on blur or Enter, and an external snapshot change
 * refreshes the draft only while the control is not being edited. Toggles and
 * selects commit immediately, matching the Safety Gate card's behaviour.
 */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";

let nextControlId = 0;

/** Per-instance id so every control's label can point at it. */
function useControlId(kind: string): string {
  const [id] = useState(() => `ovm-${kind}-${String(nextControlId++)}`);
  return id;
}

/**
 * Draft state that follows external value changes only while the control is
 * being edited. The editing flag rides the control's own focus events, which
 * keeps the hook free of element refs and their per-tag typings.
 */
function useDraft(
  value: string,
): [string, (next: string) => void, (editing: boolean) => void] {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return [
    draft,
    setDraft,
    (flag: boolean) => {
      editing.current = flag;
    },
  ];
}

/** Marker shown next to a field label when the user layer carries a value. */
function OverrideMarker({ shown }: { shown: boolean }): ReactElement | null {
  if (!shown) return null;
  return <span className="ovm-override">override</span>;
}

/** Label line shared by every field. */
function FieldLabel(props: {
  id: string;
  label: string;
  hint?: string;
  overridden: boolean;
}): ReactElement {
  return (
    <span>
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint === undefined ? null : (
        <span className="ovm-muted"> — {props.hint}</span>
      )}{" "}
      <OverrideMarker shown={props.overridden} />
    </span>
  );
}

/** Master-switch and granular-knob row. */
export function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  overridden: boolean;
  onToggle: (checked: boolean) => void;
}): ReactElement {
  const id = useControlId("toggle");
  return (
    <div className="ovm-toggle-row">
      <span className="ovm-toggle-copy">
        <strong>
          <label htmlFor={id}>{props.label}</label>
        </strong>
        <span>{props.description}</span>
      </span>
      <OverrideMarker shown={props.overridden} />
      <input
        id={id}
        type="checkbox"
        className="ovm-toggle"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onToggle(event.target.checked);
        }}
      />
    </div>
  );
}

/** Single-line text field; an empty commit means "clear the override". */
export function TextField(props: {
  label: string;
  hint?: string;
  value: string | undefined;
  placeholder: string;
  secret?: boolean;
  disabled: boolean;
  overridden: boolean;
  onCommit: (text: string) => void;
}): ReactElement {
  const id = useControlId("text");
  const [draft, setDraft, setEditing] = useDraft(props.value ?? "");
  return (
    <span className="ovm-field">
      <FieldLabel
        id={id}
        label={props.label}
        hint={props.hint}
        overridden={props.overridden}
      />
      <input
        id={id}
        type={props.secret === true ? "password" : "text"}
        className="ovm-control"
        value={draft}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoComplete={props.secret === true ? "off" : undefined}
        spellCheck={false}
        onFocus={() => {
          setEditing(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          props.onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </span>
  );
}

/** Numeric field with declared schema bounds; commits on blur or Enter. */
export function NumberField(props: {
  label: string;
  hint?: string;
  value: number | undefined;
  placeholder: string;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  overridden: boolean;
  /** Receives the parsed draft; `null` (empty) means "clear the override". */
  onCommit: (value: number | null) => void;
  onInvalid: (text: string) => void;
}): ReactElement {
  const id = useControlId("number");
  const [draft, setDraft, setEditing] = useDraft(
    props.value === undefined ? "" : String(props.value),
  );
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      props.onCommit(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < props.min || value > props.max) {
      props.onInvalid(trimmed);
      return;
    }
    props.onCommit(value);
  };
  return (
    <span className="ovm-field">
      <FieldLabel
        id={id}
        label={props.label}
        hint={props.hint}
        overridden={props.overridden}
      />
      <input
        id={id}
        type="number"
        className="ovm-control"
        value={draft}
        placeholder={props.placeholder}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onFocus={() => {
          setEditing(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </span>
  );
}

/** Enum field. The empty option stands for "not configured" (inherit). */
export function SelectField(props: {
  label: string;
  hint?: string;
  value: string | undefined;
  inheritLabel: string;
  options: readonly { readonly value: string; readonly label: string }[];
  disabled: boolean;
  overridden: boolean;
  onSelect: (value: string) => void;
}): ReactElement {
  const id = useControlId("select");
  return (
    <span className="ovm-field">
      <FieldLabel
        id={id}
        label={props.label}
        hint={props.hint}
        overridden={props.overridden}
      />
      <select
        id={id}
        className="ovm-control"
        value={props.value ?? ""}
        disabled={props.disabled}
        onChange={(event) => {
          props.onSelect(event.target.value);
        }}
      >
        <option value="">{props.inheritLabel}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** One sed-style capture filter per line; an empty commit clears the list. */
export function FiltersField(props: {
  label: string;
  hint?: string;
  value: readonly string[] | undefined;
  placeholder: string;
  disabled: boolean;
  overridden: boolean;
  onCommit: (filters: string[]) => void;
}): ReactElement {
  const id = useControlId("filters");
  const [draft, setDraft, setEditing] = useDraft(
    props.value === undefined ? "" : props.value.join("\n"),
  );
  return (
    <span className="ovm-field">
      <FieldLabel
        id={id}
        label={props.label}
        hint={props.hint}
        overridden={props.overridden}
      />
      <textarea
        id={id}
        className="ovm-area"
        value={draft}
        placeholder={props.placeholder}
        disabled={props.disabled}
        spellCheck={false}
        onFocus={() => {
          setEditing(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          props.onCommit(
            draft
              .split("\n")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          );
        }}
      />
    </span>
  );
}
