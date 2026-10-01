/**
 * The Safety Gate settings card.
 *
 * Two sources meet here: the gate's live configuration form, which is the
 * operator's write path, and the `safetyGate` Remote, which reports what the
 * running gate is actually doing. Everything the user changes is committed
 * immediately as a path-addressed mutation fenced by the revision the card
 * read; the status and verdict views poll the Remote while the card is open.
 */

import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import {
  bindSettingsExternalStore,
  startVisibilityAwarePolling,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ModelSafetyGateConfig } from "../config.js";
import type { SafetyGateInspect } from "../types.js";
import { isOverridden, overriddenKeys } from "./format.js";
import {
  AdvancedSection,
  AuditSection,
  ClassifierSection,
  GateSection,
  InputSection,
  OutputSection,
  StatusSection,
  ToolsSection,
  VerdictsSection,
  type ConfigProps,
} from "./sections/index.js";

const REFRESH_INTERVAL_MS = 3_000;

/** The one-liner this row carries: the page draws it as the row's description. */
const ROW_SUMMARY =
  "Deterministic and classifier checks for prompts, streamed output, tool calls, and tool results.";

/** The face the slot entry injects into this card. */
export interface SafetyGateCardFace {
  /**
   * The live Config of this plugin's namespace.
   *
   * Named `settingsForm`, not `form`: the row seat hands its registrant a
   * `form` of its own — the page's `ConfigPageForm`, which is only
   * `{ state, mutate }` and so can neither be subscribed to nor written field
   * by field — and the renderer spreads that owner prop after this face.
   */
  readonly settingsForm: ConfigForm<ModelSafetyGateConfig>;
  inspect(): Promise<RemoteResult<SafetyGateInspect>>;
}

type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<SafetyGateCardFace>;

/** Mutation operations as the configuration form declares them. */
type FormOps = Parameters<ConfigForm<ModelSafetyGateConfig>["mutate"]>[0];

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "The Safety Gate could not complete that request.";
}

export function SafetyGateCard({ settingsForm, inspect }: CardProps) {
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
  const revision = settings.revision;

  const [snapshot, setSnapshot] = useState<SafetyGateInspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const activeRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current;
    setRefreshing(true);
    try {
      const result = await inspect();
      if (request !== activeRequest.current) return;
      if (result.ok) {
        setSnapshot(result.value);
        setError(null);
      } else {
        setError(displayError(result.error));
      }
    } catch (cause) {
      if (request === activeRequest.current) setError(displayError(cause));
    } finally {
      if (request === activeRequest.current) {
        setRefreshing(false);
        setNow(Date.now());
      }
    }
  }, [inspect]);

  useEffect(() => {
    const stopPolling = startVisibilityAwarePolling(
      refresh,
      REFRESH_INTERVAL_MS,
    );
    return () => {
      stopPolling();
      activeRequest.current += 1;
    };
  }, [refresh]);

  /**
   * Path-addressed write into the live configuration. The form's operations are
   * typed for the wire's JSON values, which a control's value satisfies by
   * construction; the cast keeps that boundary in one place. The revision the
   * card read fences the write, so an edit that raced this surface is refused
   * rather than silently overwritten.
   */
  const write = useCallback(
    (path: readonly string[], value: unknown) => {
      const ops = [{ op: "set", path: [...path], value }] as unknown as FormOps;
      settingsForm.mutate(ops, revision).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [revision, settingsForm],
  );

  const unset = useCallback(
    (path: readonly string[]) => {
      const ops = [{ op: "unset", path: [...path] }] as unknown as FormOps;
      settingsForm.mutate(ops, revision).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [revision, settingsForm],
  );

  const overridden = useCallback(
    (path: readonly string[]) => isOverridden(settings.user, path),
    [settings.user],
  );

  const overrides = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    const ops = overrides.map((key) => ({
      op: "unset",
      path: [key],
    })) as unknown as FormOps;
    settingsForm.mutate(ops, revision).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [overrides, revision, settingsForm]);

  if (settings.status === "unavailable") return null;

  const sectionProps: ConfigProps = {
    config,
    classifierState: snapshot?.classifier ?? null,
    writable,
    write,
    unset,
    overridden,
  };

  return (
    // The Plugins page draws this card's frame, its heading and its expand
    // control, so the bundle renders the body and nothing around it (AGENTS.md).
    <div className="msg-body">
      {settings.status === "loading" ? (
        <p className="msg-muted" data-testid="safety-card-loading">
          Loading the Safety Gate configuration…
        </p>
      ) : (
        <>
          {error !== null ? (
            <div className="msg-error" data-testid="safety-card-error">
              {error}
            </div>
          ) : null}
          {snapshot?.configRejected ? (
            <div
              className="msg-error"
              data-testid="safety-card-config-rejected"
            >
              The gate is still running its last workable configuration:{" "}
              {snapshot.configRejected}
            </div>
          ) : null}
          <StatusSection
            inspect={snapshot}
            refreshing={refreshing}
            now={now}
            onRefresh={() => {
              void refresh();
            }}
          />
          <GateSection {...sectionProps} />
          <InputSection {...sectionProps} />
          <OutputSection {...sectionProps} />
          <ToolsSection {...sectionProps} />
          <ClassifierSection {...sectionProps} />
          <AuditSection {...sectionProps} />
          <VerdictsSection inspect={snapshot} />
          <AdvancedSection {...sectionProps} />
          <div className="msg-footer">
            <p className="msg-footer-note">
              Changes apply to the running gate immediately. Chat moderation
              banners and the per-session override control are not built yet
              (design SPEC Phase 6), so the{" "}
              <span className="msg-mono">ui.*</span> keys and{" "}
              <span className="msg-mono">allowSessionOverride</span> are
              accepted but have no effect today. The gate is a decision layer,
              not a sandbox: it does not replace the permission system.
            </p>
            {overrides.length > 0 ? (
              <button
                type="button"
                className="msg-btn"
                data-testid="safety-card-reset-overrides"
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
    </div>
  );
}

/**
 * The entry the Plugins page renders for this bundle's row.
 *
 * The page seats the same entry in two views: as the row's `summary` one-liner
 * wherever the bundle declares no description of its own, and as the `page`
 * body below it. The summary lands inside the page's own text, so it stays a
 * sentence — mounting the card there would draw a page within a line and start
 * a second poll of the Remote.
 */
export function SafetyGateEntry(props: CardProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return <SafetyGateCard {...props} />;
}
