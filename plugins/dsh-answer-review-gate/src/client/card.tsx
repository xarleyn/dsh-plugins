import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  bindSettingsExternalStore,
  settingsBodyStyles,
} from "@yadsh/dsh-plugin-kit/client";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { AnswerReviewGateConfig } from "../config.js";

export const REVIEW_SETTINGS_SUMMARY =
  "Independent review deadlines, tool budgets and revision rounds.";
export const REVIEW_SETTINGS_STYLES = settingsBodyStyles({
  body: ".review-settings",
  grid: ".review-settings__grid",
  field: ".review-settings__field",
  fieldLabel: ".review-settings__label",
  hint: ".review-settings__hint",
  control: ".review-settings__control",
  notice: ".review-settings__notice",
});

interface BudgetField {
  readonly key: string;
  readonly label: string;
  readonly path: string[];
  readonly scale: number;
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}
const FIELDS: readonly BudgetField[] = [
  {
    key: "calls",
    label: "Tool calls per round",
    path: ["maxToolCallsPerRound"],
    scale: 1,
    min: 0,
    max: 10000,
    fallback: 0,
  },
  {
    key: "timeout",
    label: "Review timeout (seconds)",
    path: ["reviewTimeoutMs"],
    scale: 1000,
    min: 0,
    max: 3600,
    fallback: 0,
  },
  {
    key: "refusals",
    label: "Consecutive tool errors",
    path: ["maxConsecutiveRefusalsPerRound"],
    scale: 1,
    min: 0,
    max: 100,
    fallback: 0,
  },
  {
    key: "rounds",
    label: "Review and revision rounds",
    path: ["maxReviewRounds"],
    scale: 1,
    min: 1,
    max: 10,
    fallback: 3,
  },
  {
    key: "outer",
    label: "Outer round deadline (seconds)",
    path: ["reviewer", "roundTimeoutMs"],
    scale: 1000,
    min: 0,
    max: 1800,
    fallback: 600000,
  },
];

/** Body only: the Plugins row owns the surrounding title and card. */
export function ReviewSettingsCard({
  settingsForm,
}: {
  readonly settingsForm: ConfigForm<AnswerReviewGateConfig>;
}) {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const writable = state.status === "ready" && state.writable;
  const value = state.value;
  const commit = (path: string[], next: number | string) => {
    setError(null);
    void settingsForm
      .mutate([{ op: "set", path, value: next }])
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save review settings.",
        );
      });
  };
  return (
    <div className="review-settings" data-testid="review-settings">
      <p>
        Changes apply to the next review round. A running review keeps its
        original budget.
      </p>
      <p className="review-settings__hint">
        The review deadline includes delegated experts. The outer deadline also
        bounds the complete backend call; the earlier deadline wins. Zero
        disables an individual deadline or tool budget.
      </p>
      {!writable && (
        <p className="review-settings__notice" role="status">
          {state.status === "ready"
            ? "These settings are read-only."
            : "The profile settings are not available yet."}
        </p>
      )}
      {error !== null && (
        <p className="review-settings__notice" role="alert">
          {error}
        </p>
      )}
      <div className="review-settings__grid">
        {FIELDS.map((field) => {
          const current =
            field.path.length === 2
              ? value?.reviewer?.roundTimeoutMs
              : value?.[field.path[0] as keyof AnswerReviewGateConfig];
          const displayed =
            (typeof current === "number" ? current : field.fallback) /
            field.scale;
          return (
            <label className="review-settings__field" key={field.key}>
              <span className="review-settings__label">{field.label}</span>
              <input
                className="review-settings__control"
                key={displayed}
                type="number"
                min={field.min}
                max={field.max}
                step={1}
                defaultValue={displayed}
                disabled={!writable}
                onBlur={(event) => {
                  const input = event.currentTarget;
                  if (input.value.trim() === "" || !input.validity.valid) {
                    input.value = String(displayed);
                    return;
                  }
                  const next = Number(input.value);
                  if (field.key === "outer" && next > 0 && next < 10) {
                    setError(
                      "The outer deadline must be zero or at least 10 seconds.",
                    );
                    return;
                  }
                  if (next !== displayed)
                    commit(field.path, next * field.scale);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <span className="review-settings__hint">
                {field.path.join(".")}
              </span>
            </label>
          );
        })}
        <label className="review-settings__field">
          <span className="review-settings__label">
            When review cannot complete
          </span>
          <select
            className="review-settings__control"
            disabled={!writable}
            value={value?.failMode ?? "warn"}
            onChange={(event) =>
              commit(["failMode"], event.currentTarget.value)
            }
          >
            <option value="warn">Deliver with an unverified warning</option>
            <option value="closed">
              Require correction or an explicit unverified notice
            </option>
            <option value="open">Deliver without blocking</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** The summary view is plain text inside the Host's description paragraph. */
export function ReviewSettingsEntry(props: {
  readonly view: "page" | "summary";
  readonly settingsForm: ConfigForm<AnswerReviewGateConfig>;
}) {
  return props.view === "summary" ? (
    <>{REVIEW_SETTINGS_SUMMARY}</>
  ) : (
    <ReviewSettingsCard settingsForm={props.settingsForm} />
  );
}
