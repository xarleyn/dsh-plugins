/**
 * Reading the audit for one session, lazily and cheaply.
 *
 * The two-step load is the SPEC §33 rule made real: the tab reads the summary
 * — one map lookup on the host — until the reader opens the Audit view, and
 * only then fetches the documents. The summary is re-read on a timer because
 * an audit can appear while a session is open, and polling a materialised
 * summary is the affordable way to notice. The unattached list rides the same
 * timer, because it is the same registry and the same question: what is there
 * now that was not there a moment ago.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startVisibilityAwarePolling } from "@yadsh/dsh-plugin-kit/client";
import type { AuditApi } from "./api.js";
import { parseAnalysis, type ParsedAnalysis } from "./analysis.js";
import type {
  AuditSummaryValue,
  SessionAuditValue,
  UnattachedAuditValue,
} from "../types.js";

/** How often an open session re-reads its summary. */
export const SUMMARY_POLL_MS = 15_000;

export type AuditLoadStatus = "loading" | "empty" | "ready" | "error";

/** The summary's state for one session. */
export interface AuditSummaryState {
  readonly status: AuditLoadStatus;
  readonly summary: AuditSummaryValue | null;
  readonly error: string | null;
}

/** The full audit's state, loaded only once the view is open. */
export interface AuditDetailState {
  readonly status: AuditLoadStatus;
  readonly value: SessionAuditValue | null;
  readonly parsed: ParsedAnalysis | null;
  readonly error: string | null;
  readonly reload: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Track one session's audit summary, refreshable while visible.
 *
 * @param api - the Remote facade.
 * @param sessionId - the session whose audit is asked for.
 * @param intervalMs - poll interval; `0` disables polling.
 */
export function useAuditSummary(
  api: AuditApi,
  sessionId: string,
  intervalMs: number = SUMMARY_POLL_MS,
): AuditSummaryState {
  const [state, setState] = useState<AuditSummaryState>({
    status: "loading",
    summary: null,
    error: null,
  });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const summary = await api.summary(sessionId);
      if (!alive.current) return;
      setState(
        summary.available
          ? { status: "ready", summary, error: null }
          : { status: "empty", summary: null, error: null },
      );
    } catch (error) {
      if (!alive.current) return;
      // A transient failure must not blank an audit already on screen: the
      // last good summary stays until a later poll replaces it.
      setState((current) =>
        current.summary === null
          ? { status: "error", summary: null, error: messageOf(error) }
          : { ...current, error: messageOf(error) },
      );
    }
  }, [api, sessionId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    if (intervalMs <= 0) {
      return () => {
        alive.current = false;
      };
    }
    const stop = startVisibilityAwarePolling(() => refresh(), intervalMs);
    return () => {
      alive.current = false;
      stop();
    };
  }, [refresh, intervalMs]);

  return state;
}

/**
 * Track the audits no session view can show, refreshable while visible.
 *
 * A failure here is deliberately swallowed. This list is an advisory beside
 * the audit the reader actually asked for, and a notice that cannot be fetched
 * must not turn a working audit into an error page: the last good list stays,
 * and a list that never resolved renders as nothing at all — the silence this
 * feature exists to break is still better than breaking the page.
 *
 * @param api - the Remote facade.
 * @param intervalMs - poll interval; `0` disables polling.
 */
export function useUnattachedAudits(
  api: AuditApi,
  intervalMs: number = SUMMARY_POLL_MS,
): readonly UnattachedAuditValue[] {
  const [items, setItems] = useState<readonly UnattachedAuditValue[]>([]);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const value = await api.unattached();
      if (!alive.current) return;
      setItems(value);
    } catch {
      // Keep the last good list; see the note above.
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    if (intervalMs <= 0) {
      return () => {
        alive.current = false;
      };
    }
    const stop = startVisibilityAwarePolling(() => refresh(), intervalMs);
    return () => {
      alive.current = false;
      stop();
    };
  }, [refresh, intervalMs]);

  return items;
}

/**
 * Load the full audit for a session, re-loading when the summary moves on.
 *
 * `modifiedAt` is the reload key: the host materialises it from the artifacts'
 * mtimes, so it changes exactly when the audit's bytes change.
 */
export function useAuditDetail(
  api: AuditApi,
  sessionId: string,
  modifiedAt: string | null,
  enabled: boolean,
): AuditDetailState {
  const [state, setState] = useState<{
    status: AuditLoadStatus;
    value: SessionAuditValue | null;
    parsed: ParsedAnalysis | null;
    error: string | null;
  }>({ status: "loading", value: null, parsed: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setState({ status: "loading", value: null, parsed: null, error: null });
      return () => {
        alive.current = false;
      };
    }
    void (async () => {
      try {
        const value = await api.audit(sessionId);
        if (!alive.current) return;
        setState(
          value.available
            ? {
                status: "ready",
                value,
                parsed: parseAnalysis(value.analysisJson),
                error: null,
              }
            : { status: "empty", value: null, parsed: null, error: null },
        );
      } catch (error) {
        if (!alive.current) return;
        setState((current) =>
          current.value === null
            ? {
                status: "error",
                value: null,
                parsed: null,
                error: messageOf(error),
              }
            : { ...current, error: messageOf(error) },
        );
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [api, sessionId, modifiedAt, enabled, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { ...state, reload };
}
