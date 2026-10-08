/**
 * Output plane: the streamed text and reasoning channels, with the budget of the
 * rolling window that checks them.
 *
 * The window parameters live here because they are the trade the streaming mode
 * makes: a wider or more frequent window is a later first chunk.
 */

import type { StreamMode } from "../../config.js";
import { NumberField, Section, SelectField, Toggle } from "../components.js";
import { ResetButton, type ConfigProps } from "./controls.js";

const STREAM_MODES: ReadonlyArray<{ value: StreamMode; label: string }> = [
  { value: "observe", label: "Observe — pass chunks through as they arrive" },
  { value: "interrupt", label: "Interrupt — cut the turn on a hit" },
  {
    value: "buffered",
    label: "Buffered — hold chunks until their window passes",
  },
];

/** Streamed text and reasoning channels, with the rolling-window budget. */
export function OutputSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  const output = config?.output;
  return (
    <Section
      testId="safety-section-output"
      title="Output stream"
      modified={props.overridden(["output"])}
      aside={
        props.overridden(["output"]) ? (
          <ResetButton
            testId="safety-output-reset"
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["output"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          testId="safety-output-enabled"
          checked={output?.enabled ?? true}
          disabled={disabled}
          label="Scan model output"
          hint="Runs on llm/stream for agent turns."
          onChange={(value) => {
            props.write(["output", "enabled"], value);
          }}
        />
        <SelectField
          testId="safety-output-stream-mode"
          label="Streaming mode"
          value={output?.mode ?? "buffered"}
          disabled={disabled}
          options={STREAM_MODES}
          onChange={(value) => {
            props.write(["output", "mode"], value);
          }}
        />
        <Toggle
          testId="safety-output-text-channel"
          checked={output?.text ?? true}
          disabled={disabled}
          label="Text channel"
          hint="Visible answer text."
          onChange={(value) => {
            props.write(["output", "text"], value);
          }}
        />
        <Toggle
          testId="safety-output-reasoning-channel"
          checked={output?.reasoning ?? true}
          disabled={disabled}
          label="Reasoning channel"
          hint="Reasoning deltas, when the model emits them."
          onChange={(value) => {
            props.write(["output", "reasoning"], value);
          }}
        />
      </div>
      <details
        className="msg-advanced"
        data-testid="safety-output-window-details"
      >
        <summary>Rolling window</summary>
        <div className="msg-advanced-content msg-grid">
          <NumberField
            testId="safety-output-check-every-chars"
            label="Check every (characters)"
            value={output?.checkEveryChars ?? 512}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "checkEveryChars"], value);
            }}
          />
          <NumberField
            testId="safety-output-window-chars"
            label="Window (characters)"
            value={output?.windowChars ?? 1_536}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "windowChars"], value);
            }}
          />
          <NumberField
            testId="safety-output-lookbehind-chars"
            label="Look-behind (characters)"
            value={output?.lookbehindChars ?? 768}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "lookbehindChars"], value);
            }}
          />
          <NumberField
            testId="safety-output-min-check-interval"
            label="Minimum interval (ms)"
            value={output?.minCheckIntervalMs ?? 250}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "minCheckIntervalMs"], value);
            }}
          />
          <NumberField
            testId="safety-output-max-buffered-chars"
            label="Maximum buffered (characters)"
            value={output?.maxBufferedChars ?? 8_192}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "maxBufferedChars"], value);
            }}
          />
        </div>
      </details>
      <p className="msg-muted">
        Buffered is the only mode that can guarantee a blocked sentence never
        reaches the page: chunks are held until their window has been checked,
        and an overflow fails closed. Observe never delays, and interrupt cuts
        the turn once a hit is confirmed.
      </p>
    </Section>
  );
}
