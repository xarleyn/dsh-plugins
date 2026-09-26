/**
 * Audit plane: whether verdicts are recorded, and whether a record keeps the
 * content it checked.
 *
 * The raw-content switch is the one setting here that widens what is written
 * down, so it warns on the card the moment it is on.
 */

import { Section, Toggle } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

/** Audit switches, including the opt-in raw-content record. */
export function AuditSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Audit"
      modified={props.overridden(["audit"])}
      aside={
        props.overridden(["audit"]) ? (
          <ResetButton
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["audit"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.audit?.enabled ?? true}
          disabled={disabled}
          label="Record verdicts"
          hint="Session events and counters for every check."
          onChange={(value) => {
            props.write(["audit", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.includeRawContent ?? false}
          disabled={disabled}
          label="Include raw content"
          hint="Off by default: records carry a hash. On stores a bounded preview of the checked content."
          onChange={(value) => {
            props.write(["audit", "includeRawContent"], value);
          }}
        />
      </div>
      {config?.audit?.includeRawContent === true ? (
        <div className="msg-notice warn">
          Raw content is on. The checked prompt, output, or tool argument is
          stored in the session log and the recent-verdict list, so anything the
          gate inspects — including secrets it matched — is written down
          verbatim.
        </div>
      ) : null}
    </Section>
  );
}
