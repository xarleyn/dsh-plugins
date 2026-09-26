/**
 * Input plane: which verdicts an unsafe or low-quality prompt receives.
 *
 * The prompt is checked before the main-model request, so this is the only plane
 * that can refuse a turn before any token is generated.
 */

import { Section, SelectField, Toggle } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

const ACTIONS: ReadonlyArray<{
  value: "allow" | "warn" | "block";
  label: string;
}> = [
  { value: "allow", label: "Allow" },
  { value: "warn", label: "Warn" },
  { value: "block", label: "Block" },
];

/** Prompt gate: which verdicts an unsafe or low-quality prompt receives. */
export function InputSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Input guard"
      modified={props.overridden(["input"])}
      aside={
        props.overridden(["input"]) ? (
          <ResetButton
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["input"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.input?.enabled ?? true}
          disabled={disabled}
          label="Scan prompts"
          hint="Runs on agent/pre-step, before the main-model request."
          onChange={(value) => {
            props.write(["input", "enabled"], value);
          }}
        />
        <SelectField
          label="Safety findings"
          value={config?.input?.safetyAction ?? "block"}
          disabled={disabled}
          options={ACTIONS}
          onChange={(value) => {
            props.write(["input", "safetyAction"], value);
          }}
        />
        <SelectField
          label="Quality findings"
          value={config?.input?.qualityAction ?? "warn"}
          disabled={disabled}
          options={ACTIONS}
          onChange={(value) => {
            props.write(["input", "qualityAction"], value);
          }}
        />
      </div>
      <p className="msg-muted">
        Blocking on usefulness is opt-in on purpose: quality verdicts warn by
        default, and only an explicit block here turns them into a rejected
        prompt.
      </p>
    </Section>
  );
}
