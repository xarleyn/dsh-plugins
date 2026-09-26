/**
 * The Safety Gate settings card.
 *
 * Two sources meet here: the gate's live configuration form, which is the
 * operator's write path, and the `safetyGate` Remote, which reports what the
 * running gate is actually doing. Everything the user changes is committed
 * immediately as a path-addressed mutation fenced by the revision the card
 * read; the status and verdict views poll the Remote while the card is open.
 */

import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import {
  CardShell,
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
import { badgeText, isOverridden, overriddenKeys } from "./format.js";
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
} from "./sections.js";

const REFRESH_INTERVAL_MS = 3_000;

/** The face the slot entry injects into this card. */
export interface SafetyGateCardFace {
  readonly form: ConfigForm<ModelSafetyGateConfig>;
  inspect(): Promise<RemoteResult<SafetyGateInspect>>;
}

type CardProps = PropsRuntime<"settings.plugins.tab"> &
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

export function SafetyGateCard({ form, inspect }: CardProps) {
  const store = useMemo(() => bindSettingsExternalStore(form), [form]);
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
      form.mutate(ops, revision).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [form, revision],
  );

  const unset = useCallback(
    (path: readonly string[]) => {
      const ops = [{ op: "unset", path: [...path] }] as unknown as FormOps;
      form.mutate(ops, revision).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [form, revision],
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
    form.mutate(ops, revision).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [form, overrides, revision]);

  if (settings.status === "unavailable") return null;

  const enabled = snapshot?.enabled ?? config?.enabled ?? true;
  const mode = snapshot?.mode ?? config?.mode;

  const sectionProps: ConfigProps = {
    config,
    classifierState: snapshot?.classifier ?? null,
    writable,
    write,
    unset,
    overridden,
  };

  return (
    // This surface is a page the plugin owns, not a seat the host lists, so the
    // shell keeps its `ul > li` contract inside a list of our own.
    <ul className="msg-card-list">
      <CardShell
        title="Model Safety Gate"
        description="Deterministic and classifier checks for prompts, streamed output, tool calls, and tool results."
        badge={
          <span className="dsh-plugin-card__badge">
            {badgeText(enabled, mode)}
          </span>
        }
        label={(open) =>
          `${open ? "Hide" : "Show"} settings: Model Safety Gate`
        }
        bodyClassName="msg-body"
      >
        {settings.status === "loading" ? (
          <p className="msg-muted">Loading the Safety Gate configuration…</p>
        ) : (
          <>
            {error !== null ? <div className="msg-error">{error}</div> : null}
            {snapshot?.configRejected ? (
              <div className="msg-error">
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
