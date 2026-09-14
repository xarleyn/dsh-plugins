import type { ReactNode } from "react";

/**
 * Field primitives for the settings dialog. The plugin's host-facing settings
 * card owns `qa-card-*`, whose stylesheet is injected only where that card is
 * mounted; the QA page carries its own `dsh-qa-settings-*` rules instead, so
 * the dialog looks the same whether or not a loopback operator ever opened
 * the deployment settings.
 */

export interface QaSettingsFieldProps {
  readonly label: string;
  /** Secondary line under the control; not part of the field's name. */
  readonly hint?: string;
  readonly children: ReactNode;
}

export function QaSettingsField(props: QaSettingsFieldProps) {
  return (
    <div className="dsh-qa-settings__field">
      <label className="dsh-qa-settings__field-label">
        {props.label}
        {props.children}
      </label>
      {props.hint === undefined ? null : (
        <span className="dsh-qa-settings__field-hint">{props.hint}</span>
      )}
    </div>
  );
}

export function QaSettingsSection(props: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="dsh-qa-settings__section">
      <header className="dsh-qa-settings__section-head">
        <h3 className="dsh-qa-settings__section-title">{props.title}</h3>
        {props.aside}
      </header>
      {props.children}
    </section>
  );
}

export function QaSettingsToggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="dsh-qa-settings__toggle-row">
      <label className="dsh-qa-settings__toggle">
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled === true}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
        <span className="dsh-qa-settings__toggle-label">{props.label}</span>
      </label>
      {props.hint === undefined ? null : (
        <span className="dsh-qa-settings__field-hint">{props.hint}</span>
      )}
    </div>
  );
}

export function QaSettingsNotice(props: {
  readonly tone: "info" | "warn" | "error";
  readonly children: ReactNode;
}) {
  return (
    <p
      className={`dsh-qa-settings__notice dsh-qa-settings__notice--${props.tone}`}
      role={props.tone === "error" ? "alert" : "status"}
    >
      {props.children}
    </p>
  );
}

export function QaSettingsActions(props: { readonly children: ReactNode }) {
  return <div className="dsh-qa-settings__actions">{props.children}</div>;
}

export function QaSettingsButton(props: {
  readonly label: string;
  readonly tone?: "primary" | "plain" | "danger";
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick?: () => void;
}) {
  const tone = props.tone ?? "plain";
  return (
    <button
      // The only submit button in the dialog belongs to the editor's form;
      // every other control is an explicit action.
      type={props.type ?? "button"}
      className={`dsh-qa-settings__button dsh-qa-settings__button--${tone}`}
      disabled={props.disabled === true}
      {...(props.title === undefined ? {} : { title: props.title })}
      {...(props.onClick === undefined ? {} : { onClick: props.onClick })}
    >
      {props.label}
    </button>
  );
}
