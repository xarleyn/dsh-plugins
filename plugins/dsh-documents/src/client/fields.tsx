/**
 * Body controls of the documents card.
 *
 * Deliberately small and local: the shell and the CSS contract come from the
 * plugin kit, and everything here is built from `--dsw-alias-*` tokens so light,
 * dark and system themes stay coherent. Only the body uses these classes — the
 * card's outer shell is the shared one (AGENTS.md).
 */

import type { ChangeEvent, ReactElement, ReactNode } from "react";

export function Section(props: {
  readonly title: string;
  readonly hint?: string;
  readonly reset?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="dsh-docs-section">
      <div className="dsh-docs-section-title">
        <h3>{props.title}</h3>
        {props.reset ?? null}
      </div>
      {props.hint === undefined ? null : (
        <p className="dsh-docs-muted">{props.hint}</p>
      )}
      {props.children}
    </section>
  );
}

export function Grid(props: { readonly children: ReactNode }): ReactElement {
  return <div className="dsh-docs-grid">{props.children}</div>;
}

export function Toggle(props: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <label className="dsh-docs-toggle-row">
      <span className="dsh-docs-toggle-copy">
        <strong>{props.label}</strong>
        {props.hint === undefined ? null : <span>{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        className="dsh-docs-toggle"
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onChange(event.target.checked);
        }}
      />
    </label>
  );
}

export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: string) => void;
}): ReactElement {
  return (
    <label className="dsh-docs-field">
      <span>{props.label}</span>
      <input
        type="text"
        className="dsh-docs-control"
        value={props.value}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled ?? false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onCommit(event.target.value);
        }}
      />
      {props.hint === undefined ? null : (
        <span className="dsh-docs-field-hint">{props.hint}</span>
      )}
    </label>
  );
}

export function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
}): ReactElement {
  return (
    <label className="dsh-docs-field">
      <span>{props.label}</span>
      <input
        type="number"
        className="dsh-docs-control"
        value={String(props.value)}
        min={props.min}
        max={props.max}
        disabled={props.disabled ?? false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) props.onCommit(parsed);
        }}
      />
      {props.hint === undefined ? null : (
        <span className="dsh-docs-field-hint">{props.hint}</span>
      )}
    </label>
  );
}

export function SelectField<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: T) => void;
}): ReactElement {
  return (
    <label className="dsh-docs-field">
      <span>{props.label}</span>
      <select
        className="dsh-docs-control"
        value={props.value}
        disabled={props.disabled ?? false}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          props.onCommit(event.target.value as T);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint === undefined ? null : (
        <span className="dsh-docs-field-hint">{props.hint}</span>
      )}
    </label>
  );
}

export function Notice(props: {
  readonly tone?: "info" | "warn";
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className={
        props.tone === "warn" ? "dsh-docs-notice warn" : "dsh-docs-notice"
      }
    >
      {props.children}
    </div>
  );
}

/** One-line fact list, used for the tool inventory and the artifact location. */
export function Facts(props: {
  readonly rows: readonly (readonly [string, string])[];
}): ReactElement {
  return (
    <dl className="dsh-docs-facts">
      {props.rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
