import { useId } from "react";
import {
  displayProviderField,
  parseProviderField,
  readProviderDocument,
} from "../scope-provider-form.js";
import type {
  ScopeProviderFormEdit,
  ScopeProviderFormField,
  ScopeProviderInfo,
} from "../types.js";
import { Section } from "./components.js";

const BOOLEAN_OPTIONS = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export type EditProviderField = (
  providerId: string,
  revision: number,
  key: string,
  value: string | null,
) => void;

export function ScopeProviderForms({
  providers,
  configs,
  edits,
  disabled,
  onEdit,
}: {
  readonly providers: readonly ScopeProviderInfo[];
  readonly configs: Readonly<Record<string, string>>;
  readonly edits: readonly ScopeProviderFormEdit[];
  readonly disabled: boolean;
  readonly onEdit: EditProviderField;
}) {
  const registered = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  const ids = new Set([
    ...providers
      .filter((provider) => !provider.builtin || provider.form !== null)
      .map(({ id }) => id),
    ...Object.keys(configs),
  ]);
  if (ids.size === 0) return null;
  return (
    <Section
      title="Scope providers"
      testId="domain-experts-editor-scope-providers"
    >
      {[...ids].sort().map((id) => {
        const provider = registered.get(id);
        const form = provider?.form;
        const document =
          form == null
            ? null
            : readProviderDocument(
                form,
                Object.hasOwn(configs, id) ? (configs[id] ?? "") : "",
              );
        const change = edits.find((edit) => edit.providerId === id);
        let readOnly = "";
        if (provider === undefined)
          readOnly =
            "This provider is unavailable. Saved configuration is preserved.";
        else if (form == null)
          readOnly =
            "This provider supplies no editable form. Saved configuration is preserved.";
        else if (document?.ok === false) readOnly = document.reason;
        return (
          <fieldset className="dx-provider-form" key={id} disabled={disabled}>
            <legend>{provider?.title ?? id}</legend>
            {form == null || document?.ok !== true ? (
              <p className="dx-hint">{readOnly}</p>
            ) : (
              form.fields.map((field) => {
                const stored = displayProviderField(field, document.data);
                const edited = change?.fields.find(
                  ({ key }) => key === field.key,
                );
                return (
                  <ProviderField
                    key={field.key}
                    field={field}
                    value={edited?.value ?? stored ?? ""}
                    edited={edited !== undefined}
                    incompatible={stored === undefined}
                    onChange={(value) => {
                      onEdit(
                        id,
                        form.revision,
                        field.key,
                        value === stored ? null : value,
                      );
                    }}
                  />
                );
              })
            )}
          </fieldset>
        );
      })}
    </Section>
  );
}

function ProviderField({
  field,
  value,
  edited,
  incompatible,
  onChange,
}: {
  readonly field: ScopeProviderFormField;
  readonly value: string;
  readonly edited: boolean;
  readonly incompatible: boolean;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  const parsed = parseProviderField(field, value);
  const problem = edited && !parsed.ok ? parsed.reason : "";
  const hint =
    problem ||
    (incompatible && !edited
      ? "The stored value has a different type. Enter a value to replace it."
      : "");
  const controls = {
    id,
    value,
    "aria-required": field.required,
    "aria-invalid": problem !== "",
    "aria-describedby": hint === "" ? undefined : `${id}-hint`,
  };
  const options = field.kind === "boolean" ? BOOLEAN_OPTIONS : field.options;
  return (
    <div className="dx-field">
      <label className="dx-label" htmlFor={id}>
        {field.label}
      </label>
      {options.length > 0 ? (
        <select
          className="dx-select"
          {...controls}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">
            {field.required ? "Select a value" : "Use provider default"}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="dx-input"
          {...controls}
          inputMode={field.kind === "integer" ? "numeric" : "text"}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
      {hint === "" ? null : (
        <span className="dx-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
