/**
 * Advanced plane: operator-added regular expressions that escalate straight to a
 * block, on top of the built-in rule set.
 */

import { ListField, Section } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

/** Operator-added regular expressions that escalate straight to a block. */
export function AdvancedSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      testId="safety-section-advanced"
      title="Advanced"
      modified={props.overridden(["customBlockPatterns"])}
      aside={
        props.overridden(["customBlockPatterns"]) ? (
          <ResetButton
            testId="safety-advanced-reset"
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["customBlockPatterns"]);
            }}
          />
        ) : undefined
      }
    >
      <ListField
        testId="safety-advanced-custom-block-patterns"
        label="Extra block patterns (one per line, comma separated)"
        hint="Case-insensitive JavaScript regular expressions, scanned in the deterministic layer. A pattern that does not compile is refused here rather than silently dropped at load."
        value={config?.customBlockPatterns ?? []}
        disabled={disabled}
        placeholder="internal-ticket-[0-9]+"
        onCommit={(values) => {
          props.write(["customBlockPatterns"], values);
        }}
      />
    </Section>
  );
}
