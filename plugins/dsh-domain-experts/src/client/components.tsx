import { useState, type ReactNode } from "react";

/**
 * Scope one shared component's markup under the id its call site owns, so a
 * component reused in three tabs never hands two of them the same hook.
 */
export function testIdPart(
  base: string | undefined,
  part: string,
): string | undefined {
  return base === undefined ? undefined : `${base}-${part}`;
}

export function Field({
  label,
  hint,
  children,
  testId,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="dx-field" data-testid={testId}>
      <span className="dx-label" data-testid={testIdPart(testId, "label")}>
        {label}
      </span>
      {children}
      {hint === undefined ? null : (
        <span className="dx-hint" data-testid={testIdPart(testId, "hint")}>
          {hint}
        </span>
      )}
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
  testId,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly invalid?: boolean;
  readonly type?: string;
  readonly testId?: string;
}) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      testId={testId}
    >
      <input
        className="dx-input"
        type={type}
        value={value}
        placeholder={placeholder ?? ""}
        aria-invalid={invalid}
        data-testid={testIdPart(testId, "input")}
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
  testId,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hint?: string;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly testId?: string;
}) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      testId={testId}
    >
      <textarea
        className="dx-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder ?? ""}
        data-testid={testIdPart(testId, "input")}
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
  testId,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly testId?: string;
}) {
  return (
    <label className="dx-check" data-testid={testId}>
      <input
        type="checkbox"
        checked={checked}
        data-testid={testIdPart(testId, "input")}
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
  testId,
}: {
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly addLabel?: string;
  readonly testId?: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = (): void => {
    const value = draft.trim();
    if (value === "") return;
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="dx-field" data-testid={testId}>
      <span className="dx-label" data-testid={testIdPart(testId, "label")}>
        {label}
      </span>
      {values.length === 0 ? (
        <span className="dx-hint" data-testid={testIdPart(testId, "empty")}>
          None.
        </span>
      ) : (
        <div className="dx-actions" data-testid={testIdPart(testId, "items")}>
          {values.map((value, index) => (
            <span
              className="dx-chip dx-mono"
              key={`${value}-${String(index)}`}
              data-testid={testIdPart(testId, "item")}
            >
              {value}
              <button
                type="button"
                className="dx-button"
                style={{ padding: "0 6px", fontSize: "11px" }}
                aria-label={`Remove ${value}`}
                data-testid={testIdPart(testId, "remove")}
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
      <div className="dx-actions" data-testid={testIdPart(testId, "add")}>
        <input
          className="dx-input"
          style={{ flex: "1 1 200px" }}
          value={draft}
          placeholder={placeholder ?? ""}
          data-testid={testIdPart(testId, "input")}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }}
        />
        <button
          type="button"
          className="dx-button"
          data-testid={testIdPart(testId, "add-button")}
          onClick={commit}
        >
          {addLabel}
        </button>
      </div>
      {hint === undefined ? null : (
        <span className="dx-hint" data-testid={testIdPart(testId, "hint")}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Select({
  value,
  onChange,
  label,
  options,
  hint,
  testId,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly hint?: string;
  readonly testId?: string;
}) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      testId={testId}
    >
      <select
        className="dx-select"
        value={value}
        data-testid={testIdPart(testId, "input")}
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
  testId,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="dx-section" data-testid={testId}>
      <h3
        className="dx-section-title"
        data-testid={testIdPart(testId, "title")}
      >
        {title}
      </h3>
      {note === undefined ? null : (
        <p className="dx-section-note" data-testid={testIdPart(testId, "note")}>
          {note}
        </p>
      )}
      {children}
    </section>
  );
}

export function StatusLine({
  tone = "info",
  children,
  testId,
}: {
  readonly tone?: "info" | "error";
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p
      className={tone === "error" ? "dx-status dx-status--error" : "dx-status"}
      role="status"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

export function EnforcementChip({
  enforcement,
  testId,
}: {
  readonly enforcement: string;
  readonly testId?: string;
}) {
  const enforced = enforcement === "enforced";
  return (
    <span
      className={
        enforced ? "dx-chip dx-chip--enforced" : "dx-chip dx-chip--advisory"
      }
      data-testid={testId}
    >
      {enforced ? "enforced" : "advisory"}
    </span>
  );
}
