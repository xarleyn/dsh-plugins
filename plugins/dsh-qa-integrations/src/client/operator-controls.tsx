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

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { draftNote, instanceDraftMissing } from "./operator-drafts.js";

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
  const [notice, setNotice] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement | null>(null);
  const commit = (next: readonly string[]) => {
    if (next.length === 0) props.unset(props.path);
    else props.write(props.path, next);
  };
  /**
   * A click always answers. The button used to be disabled while the input was
   * empty, which reads as a dead button: now it says what it is waiting for and
   * puts the caret where the missing value goes.
   */
  const add = () => {
    const value = draft.trim();
    if (value === "") {
      setNotice("введите значение");
      addInput.current?.focus();
      return;
    }
    if (props.values.includes(value)) {
      setNotice("такое значение уже есть в списке");
      return;
    }
    setNotice(null);
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
          ref={addInput}
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
          disabled={props.disabled}
          onClick={add}
        >
          добавить
        </button>
        {notice === null ? null : (
          <span className="qai-op__pending">{notice}</span>
        )}
      </span>
    </FieldFrame>
  );
}

/** One editable address row of an instance list. */
export interface InstanceDraft {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  /**
   * Which product answers at the address, on the providers that distinguish a
   * Cloud deployment from a self-hosted Server / Data Center one. Absent on
   * every other provider, and on a row whose operator never touched the
   * control — the Host resolver reads that as `cloud`.
   */
  readonly deploymentType?: string | undefined;
}

/**
 * Deployment instances (GitLab, Confluence, Jira sites, Test IT, Weblate): a
 * row edits id, label and address, and every committed edit writes the whole
 * list, because a partially stored row would fail the resolvers anyway.
 *
 * The providers that host both a Cloud product and a self-hosted one pass
 * `deployments` as well, and the row then carries a fourth control: the row is
 * written with the key it selects, and a row nobody touched keeps the key out
 * of the payload the other providers' rows must keep clean.
 */
export function InstanceListField(props: {
  label: string;
  hint?: string;
  path: readonly string[];
  instances: readonly InstanceDraft[];
  /**
   * Products a row may declare, first one being what the Host reads when the
   * row names none. Absent for every provider without that distinction.
   */
  deployments?: readonly { readonly value: string; readonly label: string }[];
  disabled: boolean;
  write: ConfigWrite;
  unset: ConfigUnset;
  overridden: OverrideCheck;
}): ReactElement {
  const deployments = props.deployments;
  const [drafts, setDrafts] = useState<readonly InstanceDraft[]>(() =>
    props.instances.map((row) => ({ ...row })),
  );
  const storedCount = useRef(props.instances.length);
  useEffect(() => {
    // Rows the Host stores, plus the rows this card added and has not committed
    // yet: an unfinished row is the operator's draft, and a refuel from the
    // store must not take it off the screen.
    setDrafts((current) => {
      const accepted = Math.max(
        0,
        props.instances.length - storedCount.current,
      );
      const pending = current.slice(storedCount.current + accepted);
      storedCount.current = props.instances.length;
      return [...props.instances.map((row) => ({ ...row })), ...pending];
    });
  }, [props.instances]);
  /**
   * Writes the rows the Host can take — every stored row, plus the drafts that
   * are complete. An unfinished draft stays local: committing it is what used
   * to make the Host refuse the whole array, which is why «добавить» looked
   * like it did nothing.
   */
  const commit = (
    next: readonly InstanceDraft[],
    unsetWhenEmpty = next.length === 0,
  ) => {
    setDrafts(next);
    const takeable = next.filter(
      (row, at) =>
        at < storedCount.current || instanceDraftMissing(row).length === 0,
    );
    if (takeable.length === 0) {
      if (unsetWhenEmpty) props.unset(props.path);
      return;
    }
    props.write(
      props.path,
      takeable.map((row) => ({ ...row })),
    );
  };
  const edit = (index: number, patch: Partial<InstanceDraft>) => {
    commit(
      drafts.map((row, at) => (at === index ? { ...row, ...patch } : row)),
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
        {drafts.map((row, index) => {
          // The map walks the drafts, so the stored counterpart of a row is the
          // instance at the same index; a commit compares against that, never
          // against the draft the input already shows.
          const stored =
            index < storedCount.current ? props.instances[index] : undefined;
          return (
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
                    if (id !== "" && id !== (stored?.id ?? "")) {
                      edit(index, { id });
                    }
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
                    if (label !== "" && label !== (stored?.label ?? "")) {
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
                    if (baseUrl !== "" && baseUrl !== (stored?.baseUrl ?? "")) {
                      edit(index, { baseUrl });
                    }
                  }}
                />
              </span>
              {deployments === undefined ? null : (
                // A real label, so clicking the caption lands in the select — the
                // provider's rows follow the same shape as the other controls.
                <label className="qai-op__instance-cell">
                  <span className="qai-op__instance-key">развёртывание</span>
                  <select
                    className="qai-op__input"
                    value={
                      drafts[index]?.deploymentType ??
                      deployments[0]?.value ??
                      ""
                    }
                    disabled={props.disabled}
                    onChange={(event) => {
                      // The whole list commits at once, like every other cell of
                      // the row, so the row can never be stored half-written.
                      edit(index, {
                        deploymentType: event.currentTarget.value,
                      });
                    }}
                  >
                    {deployments.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="qai-op__row-remove"
                disabled={props.disabled}
                onClick={() => {
                  const removedStored = index < storedCount.current;
                  if (removedStored) storedCount.current -= 1;
                  commit(
                    drafts.filter((_, at) => at !== index),
                    removedStored,
                  );
                }}
              >
                убрать
              </button>
              {index >= storedCount.current ? (
                <span className="qai-op__pending">
                  {draftNote(instanceDraftMissing(row))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span>
        <button
          type="button"
          className="qai-op__button"
          disabled={props.disabled}
          onClick={() => {
            commit([...drafts, { id: "", label: "", baseUrl: "" }]);
          }}
        >
          добавить
        </button>
        {drafts.length === 0 && props.disabled ? (
          <span className="qai-op__pending">
            не сохранено — Хост не принимает правки из этого браузера
          </span>
        ) : null}
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
  const [notice, setNotice] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement | null>(null);
  const valueInput = useRef<HTMLInputElement | null>(null);
  const commit = (next: readonly (readonly [string, string])[]) => {
    if (next.length === 0) {
      props.unset(props.path);
      return;
    }
    const record: Record<string, string> = {};
    for (const [key, value] of next) record[key] = props.fixedValue ?? value;
    props.write(props.path, record);
  };
  /** A click always answers: the button is never the silent kind. */
  const add = () => {
    const key = keyDraft.trim();
    if (key === "") {
      setNotice("введите ключ");
      keyInput.current?.focus();
      return;
    }
    if (props.entries.some(([rowKey]) => rowKey === key)) {
      setNotice("такой ключ уже есть в списке");
      return;
    }
    const value = props.fixedValue ?? valueDraft.trim();
    if (value === "") {
      setNotice("введите значение");
      valueInput.current?.focus();
      return;
    }
    setNotice(null);
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
          ref={keyInput}
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
            ref={valueInput}
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
          disabled={props.disabled}
          onClick={add}
        >
          добавить
        </button>
        {notice === null ? null : (
          <span className="qai-op__pending">{notice}</span>
        )}
      </span>
    </FieldFrame>
  );
}
