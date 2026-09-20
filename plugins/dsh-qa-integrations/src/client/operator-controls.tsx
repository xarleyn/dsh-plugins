/**
 * Shared controls of the operator card body.
 *
 * Every control edits the settings namespace through a path-addressed write,
 * and text, number and list drafts commit on blur or Enter rather than per
 * keystroke: a half-typed value is one the Host refuses, and a refusal
 * mid-typing would clear the field the operator is still editing. Structured
 * values (instance lists, records, credential profiles) commit as a whole at
 * the parent path, because the Host stores the user layer per section path.
 */

import { useEffect, useState, type ReactElement, type ReactNode } from "react";

/** Path-addressed write into the plugin's settings namespace. */
export type ConfigWrite = (path: readonly string[], value: unknown) => void;

/** Path-addressed clear, so the field re-inherits the composition layer. */
export type ConfigUnset = (path: readonly string[]) => void;

/** Whether the raw user layer carries a path. */
export type OverrideCheck = (path: readonly string[]) => boolean;

/** What every control needs to reach the namespace. */
export interface ControlProps {
  readonly disabled: boolean;
  readonly write: ConfigWrite;
  readonly unset: ConfigUnset;
  readonly overridden: OverrideCheck;
}

/** Redrawn when the stored value moves under a draft, and to report refusals. */
export interface ValueProps<T> {
  readonly path: readonly string[];
  readonly value: T;
}

function OverriddenMark(props: { shown: boolean }) {
  if (!props.shown) return null;
  return <span className="qai-op__overridden">переопределено</span>;
}

/** The control's DOM id, derived from its settings path: one per field. */
export function fieldId(path: readonly string[]): string {
  return `qai-op-${path.join("-")}`;
}

function FieldFrame(props: {
  label: string;
  path: readonly string[];
  overridden: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="qai-op__field">
      {/* A real label, so clicking the caption lands in the field. */}
      <label className="qai-op__label" htmlFor={fieldId(props.path)}>
        {props.label}
        <OverriddenMark shown={props.overridden} />
      </label>
      {props.children}
      {props.hint === undefined ? null : (
        <span className="qai-op__hint">{props.hint}</span>
      )}
    </div>
  );
}

/** Two-state control with a label and an explanatory hint. */
export function Toggle(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  value: boolean;
  disabled: boolean;
  write: ConfigWrite;
  overridden?: boolean;
}): ReactElement {
  return (
    <label className="qai-op__toggle-row">
      <span className="qai-op__toggle-copy">
        <strong>
          {props.label}
          <OverriddenMark shown={props.overridden === true} />
        </strong>
        {props.hint === undefined ? null : <span>{props.hint}</span>}
      </span>
      <input
        className="qai-op__toggle"
        type="checkbox"
        checked={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.write(props.path, event.currentTarget.checked);
        }}
      />
    </label>
  );
}

/** Whole-number control; the draft commits on blur and on Enter. */
export function NumberField(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  value: number | undefined;
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const [draft, setDraft] = useState(
    props.value === undefined ? "" : String(props.value),
  );
  useEffect(() => {
    setDraft(props.value === undefined ? "" : String(props.value));
  }, [props.value]);
  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      if (props.value !== undefined) props.unset(props.path);
      return;
    }
    const next = Number(text);
    if (!Number.isFinite(next) || next === props.value) return;
    props.write(props.path, next);
  };
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <input
        id={fieldId(props.path)}
        className="qai-op__input"
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </FieldFrame>
  );
}

/** Free-text control; the draft commits on blur and on Enter. */
export function TextField(props: {
  label: string;
  hint?: string;
  placeholder?: string;
  path: readonly string[];
  value: string | undefined;
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const [draft, setDraft] = useState(props.value ?? "");
  useEffect(() => {
    setDraft(props.value ?? "");
  }, [props.value]);
  const commit = () => {
    const next = draft.trim();
    if (next === "") {
      if (props.value !== undefined && props.value !== "")
        props.unset(props.path);
      return;
    }
    if (next === props.value) return;
    props.write(props.path, next);
  };
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <input
        id={fieldId(props.path)}
        className="qai-op__input"
        type="text"
        value={draft}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </FieldFrame>
  );
}

/** Fixed-option control for the schema's string unions. */
export function SelectField(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled: boolean;
  write: ConfigWrite;
  overridden: OverrideCheck;
}): ReactElement {
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <select
        id={fieldId(props.path)}
        className="qai-op__input"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.write(props.path, event.currentTarget.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/**
 * List of strings; every committed value replaces the whole array at the
 * parent path, which is the granularity the namespace stores.
 */
export function StringListField(props: {
  label: string;
  hint?: string;
  placeholder?: string;
  path: readonly string[];
  values: readonly string[];
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const commit = (next: readonly string[]) => {
    if (next.length === 0) props.unset(props.path);
    else props.write(props.path, next);
  };
  const add = () => {
    const value = draft.trim();
    if (value === "" || props.values.includes(value)) return;
    commit([...props.values, value]);
    setDraft("");
  };
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <ul className="qai-op__rows">
        {props.values.map((row, index) => (
          <li key={`${index}:${row}`} className="qai-op__row">
            <span className="qai-op__row-value">{row}</span>
            <button
              type="button"
              className="qai-op__row-remove"
              disabled={props.disabled}
              onClick={() => {
                commit(props.values.filter((_, at) => at !== index));
              }}
            >
              убрать
            </button>
          </li>
        ))}
      </ul>
      <span className="qai-op__row-add">
        <input
          className="qai-op__input"
          type="text"
          value={draft}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
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
          className="qai-op__button"
          disabled={props.disabled || draft.trim() === ""}
          onClick={add}
        >
          добавить
        </button>
      </span>
    </FieldFrame>
  );
}

/** One editable address row of an instance list. */
export interface InstanceDraft {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
}

/**
 * Deployment instances (GitLab, Confluence, Jira sites, Test IT, Weblate): a
 * row edits id, label and address, and every committed edit writes the whole
 * list, because a partially stored row would fail the resolvers anyway.
 */
export function InstanceListField(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  instances: readonly InstanceDraft[];
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const [drafts, setDrafts] = useState<readonly InstanceDraft[]>(() =>
    props.instances.map((row) => ({ ...row })),
  );
  useEffect(() => {
    setDrafts(props.instances.map((row) => ({ ...row })));
  }, [props.instances]);
  const commit = (next: readonly InstanceDraft[]) => {
    setDrafts(next);
    if (next.length === 0) props.unset(props.path);
    else
      props.write(
        props.path,
        next.map((row) => ({ ...row })),
      );
  };
  const edit = (index: number, patch: Partial<InstanceDraft>) => {
    commit(
      props.instances.map((row, at) =>
        at === index ? { ...row, ...patch } : row,
      ),
    );
  };
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <ul className="qai-op__instances">
        {props.instances.map((row, index) => (
          <li key={`${index}:${row.id}`} className="qai-op__instance">
            <span className="qai-op__instance-cell">
              <span className="qai-op__instance-key">id</span>
              <input
                className="qai-op__input"
                type="text"
                value={drafts[index]?.id ?? ""}
                placeholder="corp"
                disabled={props.disabled}
                onChange={(event) => {
                  setDrafts(
                    drafts.map((draft, at) =>
                      at === index
                        ? { ...draft, id: event.currentTarget.value }
                        : draft,
                    ),
                  );
                }}
                onBlur={() => {
                  const id = drafts[index]?.id.trim() ?? "";
                  if (id !== "" && id !== row.id) edit(index, { id });
                }}
              />
            </span>
            <span className="qai-op__instance-cell">
              <span className="qai-op__instance-key">название</span>
              <input
                className="qai-op__input"
                type="text"
                value={drafts[index]?.label ?? ""}
                placeholder="Корпоративный GitLab"
                disabled={props.disabled}
                onChange={(event) => {
                  setDrafts(
                    drafts.map((draft, at) =>
                      at === index
                        ? { ...draft, label: event.currentTarget.value }
                        : draft,
                    ),
                  );
                }}
                onBlur={() => {
                  const label = drafts[index]?.label.trim() ?? "";
                  if (label !== "" && label !== row.label) {
                    edit(index, { label });
                  }
                }}
              />
            </span>
            <span className="qai-op__instance-cell qai-op__instance-cell--wide">
              <span className="qai-op__instance-key">адрес</span>
              <input
                className="qai-op__input"
                type="text"
                value={drafts[index]?.baseUrl ?? ""}
                placeholder="https://gitlab.example.corp"
                disabled={props.disabled}
                onChange={(event) => {
                  setDrafts(
                    drafts.map((draft, at) =>
                      at === index
                        ? { ...draft, baseUrl: event.currentTarget.value }
                        : draft,
                    ),
                  );
                }}
                onBlur={() => {
                  const baseUrl = drafts[index]?.baseUrl.trim() ?? "";
                  if (baseUrl !== "" && baseUrl !== row.baseUrl) {
                    edit(index, { baseUrl });
                  }
                }}
              />
            </span>
            <button
              type="button"
              className="qai-op__row-remove"
              disabled={props.disabled}
              onClick={() => {
                commit(props.instances.filter((_, at) => at !== index));
              }}
            >
              убрать
            </button>
          </li>
        ))}
      </ul>
      <span>
        <button
          type="button"
          className="qai-op__button"
          disabled={props.disabled}
          onClick={() => {
            commit([...props.instances, { id: "", label: "", baseUrl: "" }]);
          }}
        >
          добавить
        </button>
      </span>
    </FieldFrame>
  );
}

/**
 * Mapping control for `fieldAliases`, credential resources and deny policy:
 * rows of a key and its value, committed as one record at the parent path.
 * A new entry is typed into the key (and value) inputs and lands in the
 * record on «добавить»; an existing value commits on blur.
 */
export function RecordField(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  entries: ReadonlyArray<readonly [string, string]>;
  keyPlaceholder: string;
  valuePlaceholder: string;
  /** Fixed value for entries whose schema admits one spelling ("deny"). */
  fixedValue?: string;
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const [keyDraft, setKeyDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const commit = (next: readonly (readonly [string, string])[]) => {
    if (next.length === 0) {
      props.unset(props.path);
      return;
    }
    const record: Record<string, string> = {};
    for (const [key, value] of next) record[key] = props.fixedValue ?? value;
    props.write(props.path, record);
  };
  const add = () => {
    const key = keyDraft.trim();
    if (key === "" || props.entries.some(([rowKey]) => rowKey === key)) return;
    const value = props.fixedValue ?? valueDraft.trim();
    if (value === "") return;
    commit([...props.entries, [key, value] as readonly [string, string]]);
    setKeyDraft("");
    setValueDraft("");
  };
  return (
    <FieldFrame
      label={props.label}
      path={props.path}
      overridden={props.overridden(props.path)}
      hint={props.hint}
    >
      <ul className="qai-op__rows">
        {props.entries.map(([key, value]) => (
          <li key={key} className="qai-op__row">
            <span className="qai-op__row-key">{key}</span>
            {props.fixedValue === undefined ? (
              <input
                className="qai-op__input"
                type="text"
                defaultValue={value}
                placeholder={props.valuePlaceholder}
                disabled={props.disabled}
                onBlur={(event) => {
                  const next = event.currentTarget.value.trim();
                  if (next !== "" && next !== value) {
                    commit(
                      props.entries.map((row) =>
                        row[0] === key
                          ? ([key, next] as readonly [string, string])
                          : row,
                      ),
                    );
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <span className="qai-op__row-value">{value}</span>
            )}
            <button
              type="button"
              className="qai-op__row-remove"
              disabled={props.disabled}
              onClick={() => {
                commit(props.entries.filter(([rowKey]) => rowKey !== key));
              }}
            >
              убрать
            </button>
          </li>
        ))}
      </ul>
      <span className="qai-op__row-add">
        <input
          className="qai-op__input"
          type="text"
          value={keyDraft}
          placeholder={props.keyPlaceholder}
          disabled={props.disabled}
          onChange={(event) => {
            setKeyDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        {props.fixedValue === undefined ? (
          <input
            className="qai-op__input"
            type="text"
            value={valueDraft}
            placeholder={props.valuePlaceholder}
            disabled={props.disabled}
            onChange={(event) => {
              setValueDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        ) : null}
        <button
          type="button"
          className="qai-op__button"
          disabled={props.disabled || keyDraft.trim() === ""}
          onClick={add}
        >
          добавить
        </button>
      </span>
    </FieldFrame>
  );
}
