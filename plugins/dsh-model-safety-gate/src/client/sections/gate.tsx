/**
 * Gate plane: the master switch, the mode profile, and the scanning budget.
 *
 * Everything the sections below decide is subject to this plane — a disabled
 * gate skips every check whatever the per-plane switches say.
 */

import type { GateMode } from "../../config.js";
import { NumberField, Section, SelectField, Toggle } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

const GATE_MODES: ReadonlyArray<{ value: GateMode; label: string }> = [
  { value: "off", label: "Off — scan nothing" },
  { value: "audit", label: "Audit — record only" },
  { value: "warn", label: "Warn — record and surface" },
  { value: "enforce", label: "Enforce — block" },
];

/** Master switch, mode profile, and the scanning budget. */
export function GateSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      testId="safety-section-gate"
      title="Gate"
      modified={props.overridden(["enabled"]) || props.overridden(["mode"])}
      aside={
        props.overridden(["enabled"]) || props.overridden(["mode"]) ? (
          <ResetButton
            testId="safety-gate-reset"
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["enabled"]);
              props.unset(["mode"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          testId="safety-gate-enabled"
          checked={config?.enabled ?? true}
          disabled={disabled}
          label="Gate enabled"
          hint="Off switches every guard off, whatever the sections below say."
          onChange={(value) => {
            props.write(["enabled"], value);
          }}
        />
        <SelectField
          testId="safety-gate-mode"
          label="Mode"
          value={config?.mode ?? "warn"}
          disabled={disabled}
          options={GATE_MODES}
          onChange={(value) => {
            props.write(["mode"], value);
          }}
        />
        <Toggle
          testId="safety-gate-session-override"
          checked={config?.allowSessionOverride ?? true}
          disabled={disabled}
          label="Allow per-session override"
          hint="A session may lower the mode for itself. Reserved for a future session control."
          onChange={(value) => {
            props.write(["allowSessionOverride"], value);
          }}
        />
        <NumberField
          testId="safety-gate-max-scan-chars"
          label="Scan budget (characters)"
          value={config?.maxScanChars ?? 65_536}
          disabled={disabled}
          onChange={(value) => {
            props.write(["maxScanChars"], value);
          }}
        />
      </div>
    </Section>
  );
}
