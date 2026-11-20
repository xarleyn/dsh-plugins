import { useCallback, useEffect, useState } from "react";
import { startVisibilityAwarePolling } from "@yadsh/dsh-plugin-kit/client";
import type { AuditApi } from "./api.js";
import { parseAnalysis, type ParsedAnalysis } from "./analysis.js";
import type {
  AuditSummaryValue,
  SessionAuditValue,
  UnattachedAuditValue,
} from "../types.js";

export const SUMMARY_POLL_MS = 15_000;
const MAX_INLINE_ANALYSIS_CHARACTERS = 512 * 1024;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAuditHistory(api: AuditApi, sessionId: string) {
  const [state, setState] = useState<{
    entries: readonly AuditSummaryValue[] | null;
    error: string | null;
  }>({ entries: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let pending = false;
    const stop = startVisibilityAwarePolling(async () => {
      if (pending) return;
      pending = true;
      try {
        const entries = await api.audits(sessionId);
        if (live) setState({ entries, error: null });
      } catch (error) {
        if (live)
          setState((current) => ({ ...current, error: messageOf(error) }));
      } finally {
        pending = false;
      }
    }, SUMMARY_POLL_MS);
    return () => {
      live = false;
      stop();
    };
  }, [api, sessionId, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, reload };
}

/** Unattached audits are advisory. Preserve the last good list on a failed poll. */
export function useUnattachedAudits(
  api: AuditApi,
): readonly UnattachedAuditValue[] {
  const [items, setItems] = useState<readonly UnattachedAuditValue[]>([]);
  useEffect(() => {
    let live = true;
    const stop = startVisibilityAwarePolling(async () => {
      try {
        const value = await api.unattached();
        if (live) setItems(value);
      } catch {
        // This advisory cannot hide the audit the reader asked for.
      }
    }, SUMMARY_POLL_MS);
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return items;
}

type Detail =
  | { readonly status: "loading" | "empty" }
  | { readonly status: "error"; readonly error: string }
  | {
      readonly status: "ready";
      readonly value: SessionAuditValue;
      readonly parsed: ParsedAnalysis | null;
    };

export type AuditDetailState = Detail & { readonly reload: () => void };

/** Load only the selected document and refresh it when its registered revision changes. */
export function useAuditDetail(
  api: AuditApi,
  sessionId: string,
  selection: AuditSummaryValue | undefined,
): AuditDetailState {
  const auditId = selection?.auditId;
  const revision = selection?.revision;
  const key = JSON.stringify([
    sessionId,
    auditId,
    revision ?? selection?.modifiedAt,
  ]);
  const [state, setState] = useState<{ key: string; detail: Detail }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (auditId === undefined) return;
    let live = true;
    void (async () => {
      try {
        const value = await api.auditById(sessionId, auditId);
        if (!live) return;
        if (
          !value.available ||
          value.summary.auditId !== auditId ||
          value.summary.sessionId !== sessionId ||
          (revision !== undefined && value.summary.revision !== revision)
        ) {
          setState({ key, detail: { status: "empty" } });
          return;
        }
        const parsed =
          value.analysisJson.length <= MAX_INLINE_ANALYSIS_CHARACTERS
            ? parseAnalysis(value.analysisJson)
            : null;
        setState({ key, detail: { status: "ready", value, parsed } });
      } catch (error) {
        if (live)
          setState({
            key,
            detail: { status: "error", error: messageOf(error) },
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, sessionId, auditId, revision, key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return state?.key === key
    ? { ...state.detail, reload }
    : { status: "loading", reload };
}
