/**
 * Classifier plane: which backend moderates, what happens when it fails, and
 * what the operator is told before content leaves the machine.
 *
 * The endpoint fields appear only for the backend that uses them, and the
 * remote choice raises a disclosure rather than a confirmation.
 */

import {
  NumberField,
  Section,
  SecretField,
  SelectField,
  TextField,
  Toggle,
} from "../components.js";
import { describeEndpoint } from "../format.js";
import { ResetButton, type ConfigProps } from "./controls.js";

const BACKENDS = [
  { value: "none", label: "None — deterministic rules only" },
  { value: "dsh", label: "DSH provider — a small Harness model" },
  { value: "openai-compatible", label: "OpenAI-compatible endpoint (remote)" },
];

const FAILURE_MODES = [
  { value: "rules-only", label: "Rules only — keep the L0 verdict" },
  { value: "open", label: "Open — allow when the classifier fails" },
  { value: "closed", label: "Closed — block when the classifier fails" },
  { value: "ask", label: "Ask — defer to the approval flow" },
];

/** Classifier wiring, its failure policy, and the remote-content disclosure. */
export function ClassifierSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  const classifier = config?.classifier;
  const backend = classifier?.backend ?? "none";
  const remote = backend === "openai-compatible";
  const endpoint = describeEndpoint(backend, classifier?.baseURL);
  return (
    <Section
      testId="safety-section-classifier"
      title="Classifier"
      modified={props.overridden(["classifier"])}
      aside={
        props.overridden(["classifier"]) ? (
          <ResetButton
            testId="safety-classifier-reset"
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["classifier"]);
            }}
          />
        ) : undefined
      }
    >
      {remote ? (
        <div
          className="msg-notice warn"
          data-testid="safety-classifier-notice-remote"
        >
          <strong>Safety classifier is remote.</strong> Prompts, model output,
          and reasoning are sent to {endpoint} for classification. Turn on
          “Require a local classifier” to forbid remote endpoints, or keep the
          classifier off to stay on the deterministic rules.
        </div>
      ) : null}
      <div className="msg-grid">
        <SelectField
          testId="safety-classifier-backend"
          label="Backend"
          value={backend}
          disabled={disabled}
          options={BACKENDS}
          onChange={(value) => {
            props.write(["classifier", "backend"], value);
          }}
        />
        <SelectField
          testId="safety-classifier-failure-mode"
          label="On classifier failure"
          value={classifier?.failureMode ?? "rules-only"}
          disabled={disabled}
          options={FAILURE_MODES}
          onChange={(value) => {
            props.write(["classifier", "failureMode"], value);
          }}
        />
        {backend === "dsh" ? (
          <>
            <TextField
              testId="safety-classifier-provider"
              label="Provider id"
              value={classifier?.provider ?? ""}
              disabled={disabled}
              placeholder="local"
              onChange={(value) => {
                props.write(["classifier", "provider"], value);
              }}
            />
            <TextField
              testId="safety-classifier-model"
              label="Model id"
              value={classifier?.model ?? ""}
              disabled={disabled}
              placeholder="safety-small"
              onChange={(value) => {
                props.write(["classifier", "model"], value);
              }}
            />
          </>
        ) : null}
        {remote ? (
          <>
            <TextField
              testId="safety-classifier-base-url"
              label="Endpoint base URL"
              value={classifier?.baseURL ?? ""}
              disabled={disabled}
              placeholder="https://host/v1"
              onChange={(value) => {
                props.write(["classifier", "baseURL"], value);
              }}
            />
            <TextField
              testId="safety-classifier-remote-model"
              label="Model id"
              value={classifier?.model ?? ""}
              disabled={disabled}
              placeholder="safety-small"
              onChange={(value) => {
                props.write(["classifier", "model"], value);
              }}
            />
          </>
        ) : null}
        <NumberField
          testId="safety-classifier-timeout"
          label="Timeout (ms)"
          value={classifier?.timeoutMs ?? 3_000}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "timeoutMs"], value);
          }}
        />
        <NumberField
          testId="safety-classifier-max-tokens"
          label="Maximum reply tokens"
          value={classifier?.maxTokens ?? 128}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "maxTokens"], value);
          }}
        />
        <NumberField
          testId="safety-classifier-temperature"
          label="Temperature"
          value={classifier?.temperature ?? 0}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "temperature"], value);
          }}
        />
        <Toggle
          testId="safety-classifier-require-local"
          checked={classifier?.requireLocal ?? false}
          disabled={disabled}
          label="Require a local classifier"
          hint="Refuses every remote endpoint, including an OpenAI-compatible one."
          onChange={(value) => {
            props.write(["classifier", "requireLocal"], value);
          }}
        />
      </div>
      <SecretField
        testId="safety-classifier-api-key"
        label="Endpoint bearer key"
        configured={props.classifierState?.apiKeyConfigured ?? null}
        disabled={disabled}
        placeholder="sk-…"
        onSave={(value) => {
          props.write(["classifier", "apiKey"], value);
        }}
      />
      {props.classifierState?.active === false && backend !== "none" ? (
        <div
          className="msg-notice warn"
          data-testid="safety-classifier-notice-inactive"
        >
          This backend is configured but not running:{" "}
          {props.classifierState.reason ?? "no transport is attached."} Until it
          is, every check stops at the deterministic layer.
        </div>
      ) : null}
      <p className="msg-muted">
        The classifier never has tools and never sees its own output: its calls
        run under a bypass marker, so moderating a generation cannot recursively
        moderate the moderator.
      </p>
    </Section>
  );
}
