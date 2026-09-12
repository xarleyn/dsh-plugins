import { useState, type ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="dx-field">
      <span className="dx-label">{label}</span>
      {children}
      {hint === undefined ? null : <span className="dx-hint">{hint}</span>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  label,
  hint,
  placeholder,
  invalid = false,
  type = "text",
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly invalid?: boolean;
  readonly type?: string;
}) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        className="dx-input"
        type={type}
        value={value}
        placeholder={placeholder ?? ""}
        aria-invalid={invalid}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

export function TextArea({
  value,
  onChange,
  label,
  hint,
  rows = 6,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hint?: string;
  readonly rows?: number;
  readonly placeholder?: string;
}) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <textarea
        className="dx-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder ?? ""}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
}) {
  return (
    <label className="dx-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

/**
 * Editor for a list of short strings.
 *
 * One input per row keeps the value list and the DOM in lockstep, so a path
 * or namespace is edited in place instead of being re-parsed from a blob.
 */
export function ListEditor({
  values,
  onChange,
  label,
  hint,
  placeholder,
  addLabel = "Add",
}: {
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly addLabel?: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = (): void => {
    const value = draft.trim();
    if (value === "") return;
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="dx-field">
      <span className="dx-label">{label}</span>
      {values.length === 0 ? (
        <span className="dx-hint">None.</span>
      ) : (
        <div className="dx-actions">
          {values.map((value, index) => (
            <span className="dx-chip dx-mono" key={`${value}-${String(index)}`}>
              {value}
              <button
                type="button"
                className="dx-button"
                style={{ padding: "0 6px", fontSize: "11px" }}
                aria-label={`Remove ${value}`}
                onClick={() => {
                  onChange(values.filter((_, position) => position !== index));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="dx-actions">
        <input
          className="dx-input"
          style={{ flex: "1 1 200px" }}
          value={draft}
          placeholder={placeholder ?? ""}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }}
        />
        <button type="button" className="dx-button" onClick={commit}>
          {addLabel}
        </button>
      </div>
      {hint === undefined ? null : <span className="dx-hint">{hint}</span>}
    </div>
  );
}

export function Select({
  value,
  onChange,
  label,
  options,
  hint,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly hint?: string;
}) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <select
        className="dx-select"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="dx-section">
      <h3 className="dx-section-title">{title}</h3>
      {note === undefined ? null : <p className="dx-section-note">{note}</p>}
      {children}
    </section>
  );
}

export function StatusLine({
  tone = "info",
  children,
}: {
  readonly tone?: "info" | "error";
  readonly children: ReactNode;
}) {
  return (
    <p className={tone === "error" ? "dx-status dx-status--error" : "dx-status"} role="status">
      {children}
    </p>
  );
}

export function EnforcementChip({ enforcement }: { readonly enforcement: string }) {
  const enforced = enforcement === "enforced";
  return (
    <span className={enforced ? "dx-chip dx-chip--enforced" : "dx-chip dx-chip--advisory"}>
      {enforced ? "enforced" : "advisory"}
    </span>
  );
}
