/**
 * Tools plane: the tool-call gate and the indirect-injection guard on the
 * results those calls return.
 *
 * One section because one decision covers both ends of a call: the reset clears
 * `tools` and `toolResults` together, so two markers would name one override
 * group.
 */

import { ListField, Section, Toggle } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

/** Tool-call gate and the indirect-injection guard on tool results. */
export function ToolsSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Tools and results"
      modified={
        props.overridden(["tools"]) || props.overridden(["toolResults"])
      }
      aside={
        props.overridden(["tools"]) || props.overridden(["toolResults"]) ? (
          <ResetButton
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["tools"]);
              props.unset(["toolResults"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.tools?.enabled ?? true}
          disabled={disabled}
          label="Gate tool calls"
          hint="Allow, ask for approval, or deny before execution."
          onChange={(value) => {
            props.write(["tools", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.tools?.semanticClassifier ?? true}
          disabled={disabled}
          label="Classify tool calls"
          hint="Runs the safety classifier on assembled arguments, not just the L0 rules."
          onChange={(value) => {
            props.write(["tools", "semanticClassifier"], value);
          }}
        />
        <Toggle
          checked={config?.toolResults?.enabled ?? true}
          disabled={disabled}
          label="Scan tool results"
          hint="Catches instructions smuggled in through fetched or read content."
          onChange={(value) => {
            props.write(["toolResults", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.toolResults?.classifyUntrustedSources ?? true}
          disabled={disabled}
          label="Classify untrusted results"
          hint="Raises the turn risk, which tightens later sensitive calls."
          onChange={(value) => {
            props.write(["toolResults", "classifyUntrustedSources"], value);
          }}
        />
      </div>
      <ListField
        label="Only these tools (names, comma separated)"
        hint="Empty gates every tool. A list narrows the gate to the named tools and leaves the rest untouched."
        value={config?.tools?.sensitiveTools ?? []}
        disabled={disabled}
        placeholder="bash, write, edit"
        onCommit={(values) => {
          props.write(["tools", "sensitiveTools"], values);
        }}
      />
    </Section>
  );
}
