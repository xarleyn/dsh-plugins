/**
 * The OpenViking Memory settings card.
 *
 * One source feeds everything here: the `dsh-openviking-memory` settings
 * namespace, which is the plugin's configuration on the Host. Every change is
 * written immediately as a scalar set (or clear, which drops the user-layer
 * override and re-inherits the composition layer); text-like controls keep a
 * local draft so keystrokes do not produce out-of-range intermediate writes.
 * The card has no Remote face — the plugin is host-only — so the header badge
 * projects the configuration, not live runtime state.
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
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { Config } from "../config.js";
import {
  FiltersField,
  NumberField,
  SelectField,
  TextField,
  ToggleRow,
} from "./controls.js";
import { badgeText, isOverridden, overriddenKeys } from "./format.js";

/** The face the slot entry injects into this card. */
export interface OpenVikingCardFace {
  readonly scope: SettingsScope<Config>;
}

type CardProps = PropsRuntime<"settings.plugin.item"> &
  InjectFace<OpenVikingCardFace>;

/** Mutation operations as the bound scope declares them. */
type ScopeOps = Parameters<SettingsScope<Config>["mutate"]>[0];

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "The OpenViking Memory could not complete that request.";
}

/** The schema, not the card, is the range authority; say so instead of guessing. */
function rangeError(text: string): string {
  return `"${text}" is outside this field's configured range.`;
}

export function OpenVikingMemoryCard({ scope }: CardProps) {
  const store = useMemo(() => bindSettingsExternalStore(scope), [scope]);
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;

  const [error, setError] = useState<string | null>(null);

  const write = useCallback(
    (key: string, value: unknown) => {
      scope.set(key, value).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [scope],
  );

  const clear = useCallback(
    (key: string) => {
      scope.unset(key).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [scope],
  );

  const commitText = useCallback(
    (key: string) => (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) clear(key);
      else write(key, trimmed);
    },
    [clear, write],
  );

  const invalidInput = useCallback((text: string) => {
    setError(rangeError(text));
  }, []);

  const commitNumber = useCallback(
    (key: string) => (value: number | null) => {
      if (value === null) clear(key);
      else write(key, value);
    },
    [clear, write],
  );

  const commitSelect = useCallback(
    (key: string) => (value: string) => {
      if (value === "") clear(key);
      else write(key, value);
    },
    [clear, write],
  );

  const commitFilters = useCallback(
    (key: string) => (filters: string[]) => {
      if (filters.length === 0) clear(key);
      else write(key, filters);
    },
    [clear, write],
  );

  const overridden = useCallback(
    (key: string) => isOverridden(settings.user, key),
    [settings.user],
  );

  const overrides = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    const ops = overrides.map((key) => ({
      op: "unset",
      path: [key],
    })) as unknown as ScopeOps;
    scope.mutate(ops).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [overrides, scope]);

  if (settings.status === "unavailable") return null;

  const autoInject = config?.autoInject ?? true;

  return (
    <CardShell
      title="OpenViking Memory"
      description="Durable memory tools, conversation capture, and automatic profile/recall injection against one OpenViking server."
      badge={
        <span className="dsh-plugin-card__badge">{badgeText(autoInject)}</span>
      }
      label={(open) => `${open ? "Hide" : "Show"} settings: OpenViking Memory`}
      bodyClassName="ovm-body"
    >
      {settings.status === "loading" ? (
        <p className="ovm-muted">
          Loading the OpenViking Memory configuration…
        </p>
      ) : (
        <>
          {error !== null ? <div className="ovm-error">{error}</div> : null}

          <section className="ovm-section">
            <div className="ovm-section-title">
              <h3>Automatic context presentation</h3>
            </div>
            <ToggleRow
              label="autoInject"
              description="Master switch for profile and recall injection. Off leaves memory retrieval to the model's own tool calls."
              checked={autoInject}
              disabled={!writable}
              overridden={overridden("autoInject")}
              onToggle={(checked) => {
                write("autoInject", checked);
              }}
            />
            <ToggleRow
              label="injectStartupProfile"
              description="Inject the stored user profile once at session start."
              checked={config?.injectStartupProfile ?? true}
              disabled={!writable}
              overridden={overridden("injectStartupProfile")}
              onToggle={(checked) => {
                write("injectStartupProfile", checked);
              }}
            />
            <ToggleRow
              label="injectStepProfile"
              description="Re-inject the profile before each step until it has been delivered."
              checked={config?.injectStepProfile ?? true}
              disabled={!writable}
              overridden={overridden("injectStepProfile")}
              onToggle={(checked) => {
                write("injectStepProfile", checked);
              }}
            />
            <ToggleRow
              label="autoRecall"
              description="Run a semantic recall against the memory before each step."
              checked={config?.autoRecall ?? true}
              disabled={!writable}
              overridden={overridden("autoRecall")}
              onToggle={(checked) => {
                write("autoRecall", checked);
              }}
            />
            <p className="ovm-notice">
              The three granular knobs only narrow <strong>autoInject</strong> —
              they never widen it. With auto-inject off the plugin still
              connects, captures and commits conversation turns, mounts the{" "}
              <span className="ovm-mono">mcp__openviking__*</span> tools and the
              memory skill, and guards{" "}
              <span className="ovm-mono">viking://</span> URIs; no profile or
              recall request is issued at all.
            </p>
          </section>

          <section className="ovm-section">
            <div className="ovm-section-title">
              <h3>Connection</h3>
            </div>
            <div className="ovm-grid">
              <TextField
                label="endpoint"
                hint="OpenViking base URL"
                value={config?.endpoint}
                placeholder="http://127.0.0.1:1933"
                disabled={!writable}
                overridden={overridden("endpoint")}
                onCommit={commitText("endpoint")}
              />
              <TextField
                label="apiKey"
                hint="bearer token, stored in the profile"
                value={config?.apiKey}
                placeholder="(from OPENVIKING_API_KEY or credential files)"
                secret
                disabled={!writable}
                overridden={overridden("apiKey")}
                onCommit={commitText("apiKey")}
              />
              <TextField
                label="account"
                hint="X-OpenViking-Account header"
                value={config?.account}
                placeholder="(from OPENVIKING_ACCOUNT)"
                disabled={!writable}
                overridden={overridden("account")}
                onCommit={commitText("account")}
              />
              <TextField
                label="user"
                hint="X-OpenViking-User header"
                value={config?.user}
                placeholder="(from OPENVIKING_USER)"
                disabled={!writable}
                overridden={overridden("user")}
                onCommit={commitText("user")}
              />
            </div>
            <p className="ovm-notice">
              Empty fields fall back to the{" "}
              <span className="ovm-mono">OPENVIKING_*</span> environment
              variables and the OpenViking credential files, so a blank key does
              not clear a credential that comes from the environment.
            </p>
          </section>

          <section className="ovm-section">
            <div className="ovm-section-title">
              <h3>Peer identity</h3>
            </div>
            <ToggleRow
              label="workspacePeer"
              description="Derive the recall peer from the current workspace."
              checked={config?.workspacePeer ?? true}
              disabled={!writable}
              overridden={overridden("workspacePeer")}
              onToggle={(checked) => {
                write("workspacePeer", checked);
              }}
            />
            <div className="ovm-grid">
              <TextField
                label="peerId"
                hint="explicit actor peer id; skips derivation"
                value={config?.peerId}
                placeholder="(derived from the workspace)"
                disabled={!writable}
                overridden={overridden("peerId")}
                onCommit={commitText("peerId")}
              />
              <TextField
                label="peerSource"
                hint={"preset or template, e.g. team-{dir}"}
                value={config?.peerSource}
                placeholder="git | cwd | none | team-{dir}"
                disabled={!writable}
                overridden={overridden("peerSource")}
                onCommit={commitText("peerSource")}
              />
            </div>
          </section>

          <section className="ovm-section">
            <div className="ovm-section-title">
              <h3>Recall</h3>
            </div>
            <div className="ovm-grid">
              <SelectField
                label="recallPeerScope"
                value={config?.recallPeerScope}
                inheritLabel="Inherit (all)"
                options={[
                  { value: "all", label: "all — every peer of the user" },
                  { value: "actor", label: "actor — the caller's own peer" },
                ]}
                disabled={!writable}
                overridden={overridden("recallPeerScope")}
                onSelect={commitSelect("recallPeerScope")}
              />
              <SelectField
                label="recallQueryExpansion"
                value={config?.recallQueryExpansion}
                inheritLabel="Not configured (server default)"
                options={[
                  { value: "auto", label: "auto" },
                  { value: "off", label: "off" },
                ]}
                disabled={!writable}
                overridden={overridden("recallQueryExpansion")}
                onSelect={commitSelect("recallQueryExpansion")}
              />
              <SelectField
                label="recallRewrite"
                hint="who writes the recall digest"
                value={config?.recallRewrite}
                inheritLabel="Inherit (off)"
                options={[
                  { value: "off", label: "off" },
                  { value: "auto", label: "auto" },
                  { value: "client", label: "client" },
                  { value: "server", label: "server" },
                ]}
                disabled={!writable}
                overridden={overridden("recallRewrite")}
                onSelect={commitSelect("recallRewrite")}
              />
              <NumberField
                label="recallTokenBudget"
                value={config?.recallTokenBudget}
                placeholder="2000"
                min={200}
                max={50000}
                step={1}
                disabled={!writable}
                overridden={overridden("recallTokenBudget")}
                onCommit={commitNumber("recallTokenBudget")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallMaxContentChars"
                value={config?.recallMaxContentChars}
                placeholder="500"
                min={100}
                max={5000}
                step={1}
                disabled={!writable}
                overridden={overridden("recallMaxContentChars")}
                onCommit={commitNumber("recallMaxContentChars")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallLimit"
                hint="unset follows the server's quota"
                value={config?.recallLimit}
                placeholder="10"
                min={1}
                max={50}
                step={1}
                disabled={!writable}
                overridden={overridden("recallLimit")}
                onCommit={commitNumber("recallLimit")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="scoreThreshold"
                value={config?.scoreThreshold}
                placeholder="0.35"
                min={0}
                max={1}
                step={0.05}
                disabled={!writable}
                overridden={overridden("scoreThreshold")}
                onCommit={commitNumber("scoreThreshold")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="minQueryLength"
                value={config?.minQueryLength}
                placeholder="3"
                min={1}
                max={64}
                step={1}
                disabled={!writable}
                overridden={overridden("minQueryLength")}
                onCommit={commitNumber("minQueryLength")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="profileTokenBudget"
                value={config?.profileTokenBudget}
                placeholder="10000"
                min={500}
                max={50000}
                step={1}
                disabled={!writable}
                overridden={overridden("profileTokenBudget")}
                onCommit={commitNumber("profileTokenBudget")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallDedupTurns"
                hint="0 disables de-duplication"
                value={config?.recallDedupTurns}
                placeholder="5"
                min={0}
                max={1000}
                step={1}
                disabled={!writable}
                overridden={overridden("recallDedupTurns")}
                onCommit={commitNumber("recallDedupTurns")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallContextTimeoutMs"
                hint="0 derives it from the request"
                value={config?.recallContextTimeoutMs}
                placeholder="0"
                min={0}
                max={600000}
                step={1}
                disabled={!writable}
                overridden={overridden("recallContextTimeoutMs")}
                onCommit={commitNumber("recallContextTimeoutMs")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallMaxTokens"
                hint="unset follows the server's ceiling"
                value={config?.recallMaxTokens}
                placeholder="1600"
                min={64}
                max={1000000}
                step={1}
                disabled={!writable}
                overridden={overridden("recallMaxTokens")}
                onCommit={commitNumber("recallMaxTokens")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="recallCompressMaxBullets"
                hint="digest bullet cap"
                value={config?.recallCompressMaxBullets}
                placeholder="6"
                min={1}
                max={50}
                step={1}
                disabled={!writable}
                overridden={overridden("recallCompressMaxBullets")}
                onCommit={commitNumber("recallCompressMaxBullets")}
                onInvalid={invalidInput}
              />
            </div>
            <ToggleRow
              label="recallPreferAbstract"
              description="Use the stored abstract instead of reading the item body."
              checked={config?.recallPreferAbstract ?? true}
              disabled={!writable}
              overridden={overridden("recallPreferAbstract")}
              onToggle={(checked) => {
                write("recallPreferAbstract", checked);
              }}
            />
          </section>

          <section className="ovm-section">
            <div className="ovm-section-title">
              <h3>Capture and commit</h3>
            </div>
            <ToggleRow
              label="syncTurns"
              description="Capture conversation turns into the OpenViking session."
              checked={config?.syncTurns ?? true}
              disabled={!writable}
              overridden={overridden("syncTurns")}
              onToggle={(checked) => {
                write("syncTurns", checked);
              }}
            />
            <ToggleRow
              label="captureToolResults"
              description="Capture tool results as well as user and assistant turns."
              checked={config?.captureToolResults ?? false}
              disabled={!writable}
              overridden={overridden("captureToolResults")}
              onToggle={(checked) => {
                write("captureToolResults", checked);
              }}
            />
            <ToggleRow
              label="captureAssistantTurns"
              description="Capture assistant turns as well as user turns."
              checked={config?.captureAssistantTurns ?? true}
              disabled={!writable}
              overridden={overridden("captureAssistantTurns")}
              onToggle={(checked) => {
                write("captureAssistantTurns", checked);
              }}
            />
            <div className="ovm-grid">
              <NumberField
                label="captureMaxLength"
                value={config?.captureMaxLength}
                placeholder="24000"
                min={200}
                max={100000}
                step={1}
                disabled={!writable}
                overridden={overridden("captureMaxLength")}
                onCommit={commitNumber("captureMaxLength")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="captureToolMaxChars"
                value={config?.captureToolMaxChars}
                placeholder="1000000"
                min={200}
                max={1000000}
                step={1}
                disabled={!writable}
                overridden={overridden("captureToolMaxChars")}
                onCommit={commitNumber("captureToolMaxChars")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="commitTokenThreshold"
                hint="commit once pending tokens reach this"
                value={config?.commitTokenThreshold}
                placeholder="20000"
                min={1000}
                max={1000000}
                step={1}
                disabled={!writable}
                overridden={overridden("commitTokenThreshold")}
                onCommit={commitNumber("commitTokenThreshold")}
                onInvalid={invalidInput}
              />
              <NumberField
                label="commitKeepRecentCount"
                value={config?.commitKeepRecentCount}
                placeholder="10"
                min={0}
                max={1000}
                step={1}
                disabled={!writable}
                overridden={overridden("commitKeepRecentCount")}
                onCommit={commitNumber("commitKeepRecentCount")}
                onInvalid={invalidInput}
              />
            </div>
            <FiltersField
              label="captureFilters"
              hint="one sed-style filter per line: s/pat/rep/, d|pat|, k|pat|, optionally prefixed user: or assistant:"
              value={config?.captureFilters}
              placeholder={"s/internal/stable/\nd|debug noise|"}
              disabled={!writable}
              overridden={overridden("captureFilters")}
              onCommit={commitFilters("captureFilters")}
            />
          </section>

          <details className="ovm-advanced">
            <summary>Advanced</summary>
            <div className="ovm-advanced-content">
              <ToggleRow
                label="skipSubagentSessions"
                description="Leave sessions whose origin is subagent entirely alone."
                checked={config?.skipSubagentSessions ?? false}
                disabled={!writable}
                overridden={overridden("skipSubagentSessions")}
                onToggle={(checked) => {
                  write("skipSubagentSessions", checked);
                }}
              />
              <div className="ovm-grid">
                <NumberField
                  label="requestTimeoutMs"
                  hint="one OpenViking HTTP request"
                  value={config?.requestTimeoutMs}
                  placeholder="10000"
                  min={1000}
                  max={120000}
                  step={1}
                  disabled={!writable}
                  overridden={overridden("requestTimeoutMs")}
                  onCommit={commitNumber("requestTimeoutMs")}
                  onInvalid={invalidInput}
                />
                <NumberField
                  label="mcpToolCallTimeoutMs"
                  hint="one bridged MCP tool call"
                  value={config?.mcpToolCallTimeoutMs}
                  placeholder="60000"
                  min={1000}
                  max={600000}
                  step={1}
                  disabled={!writable}
                  overridden={overridden("mcpToolCallTimeoutMs")}
                  onCommit={commitNumber("mcpToolCallTimeoutMs")}
                  onInvalid={invalidInput}
                />
                <SelectField
                  label="captureMode"
                  hint="deprecated, kept for upstream configs"
                  value={config?.captureMode}
                  inheritLabel="Inherit (semantic)"
                  options={[
                    { value: "semantic", label: "semantic" },
                    { value: "keyword", label: "keyword" },
                  ]}
                  disabled={!writable}
                  overridden={overridden("captureMode")}
                  onSelect={commitSelect("captureMode")}
                />
              </div>
            </div>
          </details>

          <div className="ovm-footer">
            <p className="ovm-footer-note">
              Writes land in the current profile's{" "}
              <span className="ovm-mono">dsh-openviking-memory</span> settings
              layer; the harness applies them by reloading the plugin, which
              re-runs connection, capture and injection with the new values.
              Out-of-range values are rejected by the schema, never clamped.
            </p>
            {overrides.length > 0 ? (
              <button
                type="button"
                className="ovm-btn"
                disabled={!writable}
                onClick={resetAll}
              >
                Reset{" "}
                {overrides.length === 1
                  ? "1 override"
                  : `${String(overrides.length)} overrides`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </CardShell>
  );
}
