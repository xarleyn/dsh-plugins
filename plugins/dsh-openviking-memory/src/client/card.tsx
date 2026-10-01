/**
 * The OpenViking Memory settings card.
 *
 * One source feeds everything here: the `dsh-openviking-memory` settings
 * namespace, which since 0.1.7 *is* the plugin's configuration — every knob of
 * `static Config` is a volatile field the Host serves as a form. Every change is
 * written immediately as a scalar set (or clear, which drops the user-layer
 * override and re-inherits the composition layer); text-like controls keep a
 * local draft so keystrokes do not produce out-of-range intermediate writes.
 * The card has no Remote face — the plugin is host-only — so the header badge
 * projects the configuration, not live runtime state.
 *
 * The card draws its own shell (the `AGENTS.md` contract) and therefore owns the
 * list it sits in: the Plugins page hands the row's configuration section an
 * empty column, so the `<li>` root is wrapped in a plugin-owned `<ul>`.
 */

import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
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
  /**
   * The live Config of this plugin's namespace.
   *
   * Named `settingsForm`, not `form`: the row seat hands its registrant a `form`
   * of its own — the Host's `ConfigPageForm`, `{ state, mutate }` and nothing
   * else (`packages/client/ui-plugin-manager/src/client/slot-contract.ts:124-130`
   * at tag `dsh-v0.1.7-rc.2`, delivered as the owner prop at `:24-27`) — and the
   * renderer spreads that owner prop after this face, so a face member called
   * `form` would be overwritten by it. What the page's form cannot do is carry a
   * subscription: its `state` is one snapshot, refreshed when the page owner
   * renders, so the card follows the resolved `ConfigForm` for the values it
   * displays. Writes are different — the page's `mutate` is the very same form's
   * `mutate`, reached through the row id the seat is keyed by — so the card hands
   * them to the page's form whenever the seat supplies one, and to this form only
   * on a seat that supplies none.
   */
  readonly settingsForm: ConfigForm<Config>;
}

type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<OpenVikingCardFace>;

/** The sentence the row's `summary` seat answers with, and the card header's own line. */
export const OPENVIKING_MEMORY_ROW_SUMMARY =
  "Durable memory tools, conversation capture, and automatic profile/recall injection against one OpenViking server.";

/** Mutation operations as the namespace's form declares them. */
type FormOps = Parameters<ConfigForm<Config>["mutate"]>[0];

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

export function OpenVikingMemoryCard({ form, settingsForm }: CardProps) {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;

  const [error, setError] = useState<string | null>(null);

  // One write path for every change the card makes: the page's own form when the
  // seat supplies one, the form this entry resolved when it does not. The two are
  // the same object — the seat resolves `configForms.get(rowId)` and the row id is
  // this namespace — and `set`/`unset` are one-op `mutate`s, so routing a scalar
  // write through `mutate` keeps the revision fence, the ordering and the recovery
  // read of the path it replaces.
  const commit = useCallback(
    (ops: FormOps) => (form ?? settingsForm).mutate(ops),
    [form, settingsForm],
  );

  const write = useCallback(
    (key: string, value: unknown) => {
      commit([{ op: "set", path: [key], value }] as unknown as FormOps).catch(
        (cause: unknown) => {
          setError(displayError(cause));
        },
      );
    },
    [commit],
  );

  const clear = useCallback(
    (key: string) => {
      commit([{ op: "unset", path: [key] }] as unknown as FormOps).catch(
        (cause: unknown) => {
          setError(displayError(cause));
        },
      );
    },
    [commit],
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
    })) as unknown as FormOps;
    commit(ops).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [commit, overrides]);

  if (settings.status === "unavailable") return null;

  const autoInject = config?.autoInject ?? true;

  return (
    <ul className="ovm-list">
      <CardShell
        title="OpenViking Memory"
        description={OPENVIKING_MEMORY_ROW_SUMMARY}
        badge={
          <span
            className="dsh-plugin-card__badge"
            data-testid="openviking-card-badge"
          >
            {badgeText(autoInject)}
          </span>
        }
        label={(open) =>
          `${open ? "Hide" : "Show"} settings: OpenViking Memory`
        }
        bodyClassName="ovm-body"
      >
        {settings.status === "loading" ? (
          <p className="ovm-muted" data-testid="openviking-card-loading">
            Loading the OpenViking Memory configuration…
          </p>
        ) : (
          <>
            {error !== null ? (
              <div
                className="ovm-error"
                data-testid="openviking-card-write-error"
              >
                {error}
              </div>
            ) : null}

            <section
              className="ovm-section"
              data-testid="openviking-card-presentation"
            >
              <div className="ovm-section-title">
                <h3>Automatic context presentation</h3>
              </div>
              <ToggleRow
                label="autoInject"
                description="Master switch for profile and recall injection. Off leaves memory retrieval to the model's own tool calls."
                checked={autoInject}
                disabled={!writable}
                overridden={overridden("autoInject")}
                testId="openviking-card-presentation-auto-inject"
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
                testId="openviking-card-presentation-inject-startup-profile"
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
                testId="openviking-card-presentation-inject-step-profile"
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
                testId="openviking-card-presentation-auto-recall"
                onToggle={(checked) => {
                  write("autoRecall", checked);
                }}
              />
              <p className="ovm-notice">
                The three granular knobs only narrow <strong>autoInject</strong>{" "}
                — they never widen it. With auto-inject off the plugin still
                connects, captures and commits conversation turns, mounts the{" "}
                <span className="ovm-mono">mcp__openviking__*</span> tools and
                the memory skill, and guards{" "}
                <span className="ovm-mono">viking://</span> URIs; no profile or
                recall request is issued at all.
              </p>
            </section>

            <section
              className="ovm-section"
              data-testid="openviking-card-connection"
            >
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
                  testId="openviking-card-connection-endpoint"
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
                  testId="openviking-card-connection-api-key"
                  onCommit={commitText("apiKey")}
                />
                <TextField
                  label="account"
                  hint="X-OpenViking-Account header"
                  value={config?.account}
                  placeholder="(from OPENVIKING_ACCOUNT)"
                  disabled={!writable}
                  overridden={overridden("account")}
                  testId="openviking-card-connection-account"
                  onCommit={commitText("account")}
                />
                <TextField
                  label="user"
                  hint="X-OpenViking-User header"
                  value={config?.user}
                  placeholder="(from OPENVIKING_USER)"
                  disabled={!writable}
                  overridden={overridden("user")}
                  testId="openviking-card-connection-user"
                  onCommit={commitText("user")}
                />
              </div>
              <p className="ovm-notice">
                Empty fields fall back to the{" "}
                <span className="ovm-mono">OPENVIKING_*</span> environment
                variables and the OpenViking credential files, so a blank key
                does not clear a credential that comes from the environment.
              </p>
            </section>

            <section className="ovm-section" data-testid="openviking-card-peer">
              <div className="ovm-section-title">
                <h3>Peer identity</h3>
              </div>
              <ToggleRow
                label="workspacePeer"
                description="Derive the recall peer from the current workspace."
                checked={config?.workspacePeer ?? true}
                disabled={!writable}
                overridden={overridden("workspacePeer")}
                testId="openviking-card-peer-workspace-peer"
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
                  testId="openviking-card-peer-id"
                  onCommit={commitText("peerId")}
                />
                <TextField
                  label="peerSource"
                  hint={"preset or template, e.g. team-{dir}"}
                  value={config?.peerSource}
                  placeholder="git | cwd | none | team-{dir}"
                  disabled={!writable}
                  overridden={overridden("peerSource")}
                  testId="openviking-card-peer-source"
                  onCommit={commitText("peerSource")}
                />
              </div>
            </section>

            <section
              className="ovm-section"
              data-testid="openviking-card-recall"
            >
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
                  testId="openviking-card-recall-peer-scope"
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
                  testId="openviking-card-recall-query-expansion"
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
                  testId="openviking-card-recall-rewrite"
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
                  testId="openviking-card-recall-token-budget"
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
                  testId="openviking-card-recall-max-content-chars"
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
                  testId="openviking-card-recall-limit"
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
                  testId="openviking-card-recall-score-threshold"
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
                  testId="openviking-card-recall-min-query-length"
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
                  testId="openviking-card-recall-profile-token-budget"
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
                  testId="openviking-card-recall-dedup-turns"
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
                  testId="openviking-card-recall-context-timeout-ms"
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
                  testId="openviking-card-recall-max-tokens"
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
                  testId="openviking-card-recall-compress-max-bullets"
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
                testId="openviking-card-recall-prefer-abstract"
                onToggle={(checked) => {
                  write("recallPreferAbstract", checked);
                }}
              />
            </section>

            <section
              className="ovm-section"
              data-testid="openviking-card-capture"
            >
              <div className="ovm-section-title">
                <h3>Capture and commit</h3>
              </div>
              <ToggleRow
                label="syncTurns"
                description="Capture conversation turns into the OpenViking session."
                checked={config?.syncTurns ?? true}
                disabled={!writable}
                overridden={overridden("syncTurns")}
                testId="openviking-card-capture-sync-turns"
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
                testId="openviking-card-capture-tool-results"
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
                testId="openviking-card-capture-assistant-turns"
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
                  testId="openviking-card-capture-max-length"
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
                  testId="openviking-card-capture-tool-max-chars"
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
                  testId="openviking-card-capture-commit-token-threshold"
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
                  testId="openviking-card-capture-commit-keep-recent-count"
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
                testId="openviking-card-capture-filters"
                onCommit={commitFilters("captureFilters")}
              />
            </section>

            <section
              className="ovm-section"
              data-testid="openviking-card-multi-user"
            >
              <div className="ovm-section-title">
                <h3>Multi-user memory</h3>
              </div>
              <ToggleRow
                label="qaUserScoping"
                description="With a QA Surface mounted, keep one memory space per account: a chat reads and writes only the memory of the account that owns it."
                checked={config?.qaUserScoping ?? true}
                disabled={!writable}
                overridden={overridden("qaUserScoping")}
                testId="openviking-card-multi-user-scoping"
                onToggle={(checked) => {
                  write("qaUserScoping", checked);
                }}
              />
              <p className="ovm-notice">
                The account travels as{" "}
                <span className="ovm-mono">X-OpenViking-User</span> on every
                request this plugin makes for a session, and a session no
                account has claimed is left alone entirely. Two things this
                switch does not change: the bridged{" "}
                <span className="ovm-mono">mcp__openviking__*</span> tools
                answer as the <span className="ovm-mono">user</span> configured
                above, not as the account that asked; and a store running in{" "}
                <span className="ovm-mono">api_key</span> mode strips the header
                and serves its own single space. Each account&apos;s{" "}
                <span className="ovm-mono">Память</span> page in the QA settings
                dialog reports which of the two it is showing. Switching this on
                starts a fresh space — memory written under the deployment
                identity before it stays there.
              </p>
            </section>

            <details
              className="ovm-advanced"
              data-testid="openviking-card-advanced"
            >
              <summary>Advanced</summary>
              <div className="ovm-advanced-content">
                <ToggleRow
                  label="skipSubagentSessions"
                  description="Leave sessions whose origin is subagent entirely alone."
                  checked={config?.skipSubagentSessions ?? false}
                  disabled={!writable}
                  overridden={overridden("skipSubagentSessions")}
                  testId="openviking-card-advanced-skip-subagent-sessions"
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
                    testId="openviking-card-advanced-request-timeout-ms"
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
                    testId="openviking-card-advanced-mcp-tool-call-timeout-ms"
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
                    testId="openviking-card-advanced-capture-mode"
                    onSelect={commitSelect("captureMode")}
                  />
                </div>
              </div>
            </details>

            <div className="ovm-footer">
              <p className="ovm-footer-note">
                Writes land in the current profile's{" "}
                <span className="ovm-mono">dsh-openviking-memory</span> settings
                layer and take effect immediately: the plugin re-resolves its
                configuration and hands it to the running runtime. The bridged{" "}
                <span className="ovm-mono">mcp__openviking__*</span> tools are
                the exception — they are a child process whose transport is
                fixed at start, so an endpoint or credential change reaches them
                on the next reload. Out-of-range values are rejected by the
                schema, never clamped.
              </p>
              {overrides.length > 0 ? (
                <button
                  type="button"
                  className="ovm-btn"
                  data-testid="openviking-card-reset-all"
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
    </ul>
  );
}

/**
 * The entry the Plugins page renders for this bundle's row, seated twice.
 *
 * `RowDetail` fills the row's description line with `description ??
 * renderSlot('plugins.row.config', { view: 'summary' }, { entryKey: key })` and
 * renders the same entry again as the configuration body with
 * `{ view: 'page', form }` — `@deepseek-ai/dsh-client-ui-plugin-manager`
 * `0.1.7-rc.2` at `lib/client.js:1841` and `:1852`, the fallback documented in the
 * shipped contract at `lib/types/client/slot-contract.d.ts:105-116`. SPEC §7.1
 * carries the commands that print both sites from the installed package.
 *
 * Answering the second seat with a sentence rather than with the card is what
 * `AGENTS.md` requires of a row card: the fallback lands inside the page's own
 * `<p>`, so mounting the form there would draw a page within a line of text.
 *
 * Whether the page asks *this* row for the line is the Host's inventory, not
 * something this checkout can read. `description` comes from `rowText`, which
 * folds in `row.meta?.description` and nothing else (`lib/client.js:211-215`); the
 * patch declares its row as `id` + `name` — no description — and
 * `tests/bundle.test.ts` holds it there, so adding a row description is what would
 * close this branch. The reader that fills `row.meta` lives in
 * `@deepseek-ai/dsh-package-manifest`, which no package of this repository
 * installs, so the branch stands on the seat's contract rather than on a measured
 * render, and the live pass SPEC §7 names is what sees the line.
 */
export function OpenVikingMemoryCardEntry(props: CardProps) {
  if (props.view === "summary") return OPENVIKING_MEMORY_ROW_SUMMARY;
  return <OpenVikingMemoryCard {...props} />;
}
