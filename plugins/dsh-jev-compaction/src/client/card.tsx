/**
 * The Jev Compaction settings card.
 *
 * One source feeds everything here: the `jev-compaction` settings namespace,
 * which is the plugin's configuration on the Host. Every control writes
 * immediately as a scalar set (or a clear, which drops the user-layer override
 * and re-inherits the deployment default); text-like controls keep a local
 * draft so keystrokes never produce intermediate writes. The card has no
 * Remote face — the plugin is host-only — so the header projects the
 * configuration, not live runtime state, and the status block never claims a
 * health check it did not perform.
 */

import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  CardShell,
  bindSettingsExternalStore,
} from "@yadsh/dsh-plugin-kit/client";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { JevCompactionConfig } from "../config.js";
import {
  NumberField,
  SelectField,
  TagListField,
  TextField,
  Toggle,
} from "./controls.js";
import {
  badgeText,
  formatBytes,
  isOverridden,
  overriddenKeys,
  splitBytes,
  toBytes,
  triggerSummary,
} from "./format.js";

/** The face the slot entry injects into this card. */
export interface JevCompactionCardFace {
  readonly scope: SettingsScope<JevCompactionConfig>;
}

type CardProps = PropsRuntime<"settings.plugin.item"> &
  InjectFace<JevCompactionCardFace>;

/** Mutation operations as the bound scope declares them. */
type ScopeOps = Parameters<SettingsScope<JevCompactionConfig>["mutate"]>[0];

const PROVIDER_OPTIONS = [
  { value: "typesafe", label: "TypeSafe Jev (hosted System One)" },
  { value: "jeff", label: "Self-hosted System One-compatible server" },
  { value: "custom", label: "Custom endpoint" },
] as const;

const ARCHIVE_FAILURE_OPTIONS = [
  { value: "keep-original", label: "Keep the original result (recommended)" },
  { value: "shape-anyway", label: "Shape anyway" },
] as const;

const LOG_LEVEL_OPTIONS = [
  { value: "silent", label: "silent" },
  { value: "error", label: "error" },
  { value: "warn", label: "warn" },
  { value: "info", label: "info" },
  { value: "debug", label: "debug" },
  { value: "trace", label: "trace" },
] as const;

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "The Host rejected that value.";
}

/** The schema, not the card, owns the ranges; say so instead of guessing. */
function rangeError(text: string): string {
  return `"${text}" is outside this field's configured range.`;
}

export function JevCompactionCard({ scope }: CardProps): ReactElement | null {
  const store = useMemo(() => bindSettingsExternalStore(scope), [scope]);
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;

  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown) => {
    setError(displayError(cause));
  }, []);

  const write = useCallback(
    (path: string[], value: unknown) => {
      scope
        .mutate([{ op: "set", path, value }] as unknown as ScopeOps)
        .catch(fail);
    },
    [scope, fail],
  );

  const clear = useCallback(
    (path: string[]) => {
      scope.mutate([{ op: "unset", path }] as unknown as ScopeOps).catch(fail);
    },
    [scope, fail],
  );

  const overrides = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    const ops = overrides.map((key) => ({ op: "unset", path: [key] }));
    scope.mutate(ops as unknown as ScopeOps).catch(fail);
  }, [overrides, scope, fail]);

  const overridden = useCallback(
    (path: string[]) => isOverridden(settings.user, ...path),
    [settings.user],
  );

  const commitScalar = useCallback(
    (path: string[], value: unknown) => {
      if (value === null || value === undefined || value === "") clear(path);
      else write(path, value);
    },
    [clear, write],
  );

  const commitList = useCallback(
    (path: string[], values: string[]) => {
      if (values.length === 0) clear(path);
      else write(path, values);
    },
    [clear, write],
  );

  if (settings.status === "unavailable") return null;

  const enabled = config?.enabled ?? true;
  const shaping = config?.resultShaping;
  const archive = config?.archive;
  const shapingEnabled = shaping?.enabled ?? false;
  const archiveEnabled = archive?.enabled ?? true;
  const archiveRoot = archive?.rootPath ?? "";
  const archiveSize = splitBytes(archive?.maxBytes ?? 1_073_741_824);
  const provider = config?.decision?.provider ?? "typesafe";
  const apiKeyEnv = config?.jev?.apiKeyEnv ?? "TYPESAFE_API_KEY";

  return (
    <CardShell
      title="Jev Compaction"
      description="Semantic result shaping and historical context compaction powered by Jev."
      badge={
        <span className="dsh-plugin-card__badge">
          {badgeText(enabled, shapingEnabled)}
        </span>
      }
      label={(open) => `${open ? "Hide" : "Show"} settings: Jev Compaction`}
      bodyClassName="jevc-body"
    >
      {settings.status === "loading" || config === undefined ? (
        <p className="jevc-muted">Loading the Jev Compaction configuration…</p>
      ) : (
        <>
          {error !== null ? (
            <div className="jevc-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="jevc-section">
            <div className="jevc-status">
              <span>
                Status:{" "}
                <span className="jevc-status-value">
                  <span
                    className={
                      enabled ? "jevc-status-dot--on" : "jevc-status-dot--off"
                    }
                  >
                    ●
                  </span>{" "}
                  {enabled ? "Enabled" : "Disabled"}
                </span>
              </span>
              <span>
                Provider: <span className="jevc-status-value">{provider}</span>
              </span>
              <span>
                Model:{" "}
                <span className="jevc-status-value">
                  {config.jev?.model ?? ""}
                </span>
              </span>
              <span>
                Mode: <span className="jevc-status-value">{settings.mode}</span>
              </span>
            </div>
            <Toggle
              label="Enable Jev Compaction"
              description="Turns semantic context management on or off without uninstalling the plugin."
              checked={enabled}
              disabled={!writable}
              overridden={overridden(["enabled"])}
              onToggle={(checked) => {
                write(["enabled"], checked);
              }}
            />
          </section>

          <section className="jevc-section">
            <div className="jevc-section-title">Immediate result shaping</div>
            <p className="jevc-hint">
              Semantically compress large repetitive tool outputs before they
              are written to conversation history. Runs on the tool-execution
              path, so the original rendered result is not recoverable from
              session replay unless the archive below is on.
            </p>
            <Toggle
              label="Shape tool results before they are persisted"
              description="Off by default: this changes durable model-visible content."
              checked={shapingEnabled}
              disabled={!writable}
              overridden={overridden(["resultShaping", "enabled"])}
              onToggle={(checked) => {
                write(["resultShaping", "enabled"], checked);
              }}
            />
            {shapingEnabled && !archiveEnabled ? (
              <div className="jevc-warning" role="status">
                Shaped output may not be recoverable from session replay: the
                original-output archive is off.
              </div>
            ) : null}

            <TagListField
              label="Eligible tools"
              description="Only these tools may be shaped. Unknown tools are kept unchanged."
              values={shaping?.includeTools ?? []}
              disabled={!writable}
              overridden={overridden(["resultShaping", "includeTools"])}
              onCommit={(values) => {
                commitList(["resultShaping", "includeTools"], values);
              }}
            />
            <TagListField
              label="Never shape these tools"
              description="Exclusions win over the eligible list."
              values={shaping?.excludeTools ?? []}
              placeholder="add an excluded tool"
              disabled={!writable}
              overridden={overridden(["resultShaping", "excludeTools"])}
              onCommit={(values) => {
                commitList(["resultShaping", "excludeTools"], values);
              }}
            />

            <NumberField
              label="Minimum result size"
              unit="characters"
              value={shaping?.thresholdChars ?? 12000}
              min={0}
              disabled={!writable}
              overridden={overridden(["resultShaping", "thresholdChars"])}
              onCommit={(value) => {
                commitScalar(["resultShaping", "thresholdChars"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Maximum shaped results per turn"
              value={shaping?.maxPerTurn ?? 2}
              min={0}
              disabled={!writable}
              overridden={overridden(["resultShaping", "maxPerTurn"])}
              onCommit={(value) => {
                commitScalar(["resultShaping", "maxPerTurn"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <Toggle
              label="Preserve errors"
              description="Keep failed tool results unchanged. Recommended."
              checked={shaping?.preserveErrors ?? true}
              disabled={!writable}
              overridden={overridden(["resultShaping", "preserveErrors"])}
              onToggle={(checked) => {
                write(["resultShaping", "preserveErrors"], checked);
              }}
            />

            <NumberField
              label="Minimum savings ratio"
              unit="(0-1)"
              value={shaping?.minSavingsRatio ?? 0.3}
              min={0}
              max={1}
              step={0.05}
              description="A shaping that saves less than this is discarded."
              disabled={!writable}
              overridden={overridden(["resultShaping", "minSavingsRatio"])}
              onCommit={(value) => {
                commitScalar(["resultShaping", "minSavingsRatio"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Minimum savings"
              unit="characters"
              value={shaping?.minSavingsChars ?? 4000}
              min={0}
              disabled={!writable}
              overridden={overridden(["resultShaping", "minSavingsChars"])}
              onCommit={(value) => {
                commitScalar(["resultShaping", "minSavingsChars"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <p className="jevc-hint">
              Trigger:{" "}
              {triggerSummary(
                shaping?.thresholdChars ?? 12000,
                shaping?.minLines ?? 80,
              )}
              .
            </p>
          </section>

          <section className="jevc-section">
            <div className="jevc-section-title">Original output archive</div>
            <p className="jevc-hint">
              Immediate shaping happens before DSH persists the final tool
              result. Archiving keeps a local copy of the original rendered
              output for diagnostics and future recovery.
            </p>
            <Toggle
              label="Archive the original output"
              description="Save the full rendered result locally before immediate shaping so it can be inspected later."
              checked={archiveEnabled}
              disabled={!writable}
              overridden={overridden(["archive", "enabled"])}
              onToggle={(checked) => {
                write(["archive", "enabled"], checked);
              }}
            />
            {!archiveEnabled ? (
              <div className="jevc-warning" role="status">
                Shaped output may not be recoverable from session replay.
              </div>
            ) : null}
            <NumberField
              label="Retention"
              unit="days (0 = keep)"
              value={archive?.retentionDays ?? 14}
              min={0}
              disabled={!writable}
              overridden={overridden(["archive", "retentionDays"])}
              onCommit={(value) => {
                commitScalar(["archive", "retentionDays"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Maximum archive size"
              unit={archiveSize.unit}
              value={archiveSize.value}
              min={0}
              step={0.5}
              description={`Currently ${formatBytes(archive?.maxBytes ?? 1_073_741_824)}. 0 disables the size cap.`}
              disabled={!writable}
              overridden={overridden(["archive", "maxBytes"])}
              onCommit={(value) => {
                commitScalar(
                  ["archive", "maxBytes"],
                  value === null ? null : toBytes(value, archiveSize.unit),
                );
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <SelectField
              label="If archiving fails"
              description="Fail-open by default: an unarchived result is never shaped."
              value={archive?.onFailure ?? "keep-original"}
              options={ARCHIVE_FAILURE_OPTIONS}
              disabled={!writable}
              overridden={overridden(["archive", "onFailure"])}
              onCommit={(value) => {
                write(["archive", "onFailure"], value);
              }}
            />
            <TextField
              label="Archive root"
              value={archiveRoot}
              placeholder="default: $DSH_HOME/data/dsh-jev-compaction/originals"
              description="Absolute path, or empty for the harness home. Changing it needs a restart."
              disabled={!writable}
              overridden={overridden(["archive", "rootPath"])}
              onCommit={(value) => {
                commitScalar(["archive", "rootPath"], value);
              }}
            />
          </section>

          <section className="jevc-section">
            <div className="jevc-section-title">Historical compaction</div>
            <p className="jevc-hint">
              When context grows, semantically prune stale historical tool
              results before falling back to ordinary summary compaction.
            </p>
            <NumberField
              label="Start semantic pruning at"
              unit="% of model context"
              value={Math.round((config.trigger?.contextRatio ?? 0.7) * 100)}
              min={0}
              max={100}
              disabled={!writable}
              overridden={overridden(["trigger", "contextRatio"])}
              onCommit={(value) => {
                commitScalar(
                  ["trigger", "contextRatio"],
                  value === null ? null : value / 100,
                );
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Minimum surface tokens"
              value={config.trigger?.minSurfaceTokens ?? 32000}
              min={1}
              disabled={!writable}
              overridden={overridden(["trigger", "minSurfaceTokens"])}
              onCommit={(value) => {
                commitScalar(["trigger", "minSurfaceTokens"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Preserve recent messages"
              value={config.preserve?.recentMessages ?? 6}
              min={0}
              disabled={!writable}
              overridden={overridden(["preserve", "recentMessages"])}
              onCommit={(value) => {
                commitScalar(["preserve", "recentMessages"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Preserve recent tokens"
              value={config.preserve?.recentTokens ?? 12000}
              min={0}
              disabled={!writable}
              overridden={overridden(["preserve", "recentTokens"])}
              onCommit={(value) => {
                commitScalar(["preserve", "recentTokens"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Full-keep threshold"
              unit="(0-1)"
              value={config.decisions?.fullThreshold ?? 0.7}
              min={0}
              max={1}
              step={0.05}
              description="Above this retention score a result stays full."
              disabled={!writable}
              overridden={overridden(["decisions", "fullThreshold"])}
              onCommit={(value) => {
                commitScalar(["decisions", "fullThreshold"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
            <NumberField
              label="Truncate threshold"
              unit="(0-1)"
              value={config.decisions?.truncateThreshold ?? 0.45}
              min={0}
              max={1}
              step={0.05}
              description="Above this a result keeps a truncated head and tail instead of a stub."
              disabled={!writable}
              overridden={overridden(["decisions", "truncateThreshold"])}
              onCommit={(value) => {
                commitScalar(["decisions", "truncateThreshold"], value);
              }}
              onInvalid={(text) => {
                setError(rangeError(text));
              }}
            />
          </section>

          <section className="jevc-section">
            <div className="jevc-section-title">Decision backend</div>
            <p className="jevc-hint">
              Jev/System One endpoint used for semantic retention decisions.
            </p>
            <SelectField
              label="Provider"
              value={provider}
              options={PROVIDER_OPTIONS}
              disabled={!writable}
              overridden={overridden(["decision", "provider"])}
              onCommit={(value) => {
                write(["decision", "provider"], value);
              }}
            />
            <TextField
              label="Endpoint"
              value={config.jev?.baseUrl ?? ""}
              placeholder="https://api.typesafe.ai/v1/systemone"
              disabled={!writable}
              overridden={overridden(["jev", "baseUrl"])}
              onCommit={(value) => {
                commitScalar(["jev", "baseUrl"], value);
              }}
            />
            <TextField
              label="Model"
              value={config.jev?.model ?? ""}
              disabled={!writable}
              overridden={overridden(["jev", "model"])}
              onCommit={(value) => {
                commitScalar(["jev", "model"], value);
              }}
            />
            <TextField
              label="API key environment variable"
              value={apiKeyEnv}
              placeholder="TYPESAFE_API_KEY"
              description="Only the variable name is stored and shown. The key itself is read on the Host and never reaches this page."
              disabled={!writable}
              overridden={overridden(["jev", "apiKeyEnv"])}
              onCommit={(value) => {
                commitScalar(["jev", "apiKeyEnv"], value);
              }}
            />
          </section>

          <details className="jevc-details">
            <summary>Advanced</summary>
            <div className="jevc-details-body">
              <NumberField
                label="Request timeout"
                unit="ms"
                value={config.jev?.timeoutMs ?? 2500}
                min={500}
                max={60000}
                disabled={!writable}
                overridden={overridden(["jev", "timeoutMs"])}
                onCommit={(value) => {
                  commitScalar(["jev", "timeoutMs"], value);
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <NumberField
                label="Concurrent Jev requests"
                value={config.jev?.maxConcurrency ?? 4}
                min={1}
                max={8}
                disabled={!writable}
                overridden={overridden(["jev", "maxConcurrency"])}
                onCommit={(value) => {
                  commitScalar(["jev", "maxConcurrency"], value);
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <NumberField
                label="Jev state token ceiling"
                value={config.state?.maxStateTokens ?? 25000}
                min={1000}
                disabled={!writable}
                overridden={overridden(["state", "maxStateTokens"])}
                onCommit={(value) => {
                  commitScalar(["state", "maxStateTokens"], value);
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <NumberField
                label="Head lines kept per shaped result"
                value={shaping?.keepHeadLines ?? 8}
                min={0}
                disabled={!writable}
                overridden={overridden(["resultShaping", "keepHeadLines"])}
                onCommit={(value) => {
                  commitScalar(["resultShaping", "keepHeadLines"], value);
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <NumberField
                label="Tail lines kept per shaped result"
                value={shaping?.keepTailLines ?? 12}
                min={0}
                disabled={!writable}
                overridden={overridden(["resultShaping", "keepTailLines"])}
                onCommit={(value) => {
                  commitScalar(["resultShaping", "keepTailLines"], value);
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <NumberField
                label="Minimum classification confidence"
                unit="(0-1)"
                value={shaping?.minClassificationConfidence ?? 0.6}
                min={0}
                max={1}
                step={0.05}
                description="Below this the group is kept."
                disabled={!writable}
                overridden={overridden([
                  "resultShaping",
                  "minClassificationConfidence",
                ])}
                onCommit={(value) => {
                  commitScalar(
                    ["resultShaping", "minClassificationConfidence"],
                    value,
                  );
                }}
                onInvalid={(text) => {
                  setError(rangeError(text));
                }}
              />
              <SelectField
                label="Log level"
                value={config.diagnostics?.logLevel ?? "info"}
                options={LOG_LEVEL_OPTIONS}
                disabled={!writable}
                overridden={overridden(["diagnostics", "logLevel"])}
                onCommit={(value) => {
                  write(["diagnostics", "logLevel"], value);
                }}
              />
            </div>
          </details>

          {writable ? null : (
            <p className="jevc-hint">
              This profile exposes the settings read-only.
            </p>
          )}

          <div className="jevc-actions">
            <button
              type="button"
              className="jevc-button"
              disabled={!writable || overrides.length === 0}
              onClick={resetAll}
            >
              Reset overrides ({overrides.length})
            </button>
          </div>

          <p className="jevc-hint">
            Changes are written to the Host settings service as they are made
            and apply to the running plugin without a restart.
          </p>
        </>
      )}
    </CardShell>
  );
}
