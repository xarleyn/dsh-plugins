/**
 * Reading which chats have an audit, and loading one on demand.
 *
 * The badge is a property of the chat list, so the summaries are polled for
 * the whole visible list in one pass — one cheap `sessionAudit/summary` per
 * chat, which is a map lookup on the host. The documents behind a badge are
 * fetched only when its dialog opens, so a sidebar with audits in it costs
 * nothing like a sidebar with audits rendered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startVisibilityAwarePolling } from "@yadsh/dsh-plugin-kit/client";
import type { QaAuditApi, QaSessionAudit, QaAuditSummary } from "./types.js";

/** How often the chat list re-asks which chats have an audit. */
export const AUDIT_POLL_MS = 30_000;

/**
 * Poll the audit summary for every chat id.
 *
 * @param api - the Remote facade, or `null` when the audit plugin is absent.
 * @param sessionIds - the chats currently listed.
 */
export function useChatAudits(
  api: QaAuditApi | null,
  sessionIds: readonly string[],
): ReadonlyMap<string, QaAuditSummary> {
  const [audits, setAudits] = useState<ReadonlyMap<string, QaAuditSummary>>(
    () => new Map(),
  );
  // The ids move with every transcript frame, so they are read through a ref
  // rather than restarting the poll.
  const idsRef = useRef(sessionIds);
  idsRef.current = sessionIds;
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (api === null) return;
    const ids = idsRef.current;
    if (ids.length === 0) {
      if (alive.current) setAudits(new Map());
      return;
    }
    const settled = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await api.summary(id)] as const;
        } catch {
          // One chat's summary failing is not the whole list failing, and a
          // transient failure must not drop the badges already shown.
          return [id, null] as const;
        }
      }),
    );
    if (!alive.current) return;
    setAudits((current) => {
      const next = new Map<string, QaAuditSummary>();
      for (const [id, summary] of settled) {
        if (summary === null) {
          const previous = current.get(id);
          if (previous !== undefined) next.set(id, previous);
          continue;
        }
        if (summary.available) next.set(id, summary);
      }
      return sameMap(current, next) ? current : next;
    });
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const stop = startVisibilityAwarePolling(() => refresh(), AUDIT_POLL_MS);
    return () => {
      alive.current = false;
      stop();
    };
  }, [refresh]);

  return audits;
}

/** Reference-equal when nothing a reader would see moved. */
function sameMap(
  left: ReadonlyMap<string, QaAuditSummary>,
  right: ReadonlyMap<string, QaAuditSummary>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, summary] of right) {
    const other = left.get(id);
    if (other === undefined) return false;
    if (
      other.verdict !== summary.verdict ||
      other.critical !== summary.critical ||
      other.major !== summary.major ||
      other.minor !== summary.minor ||
      other.observation !== summary.observation ||
      other.other !== summary.other ||
      other.modifiedAt !== summary.modifiedAt
    ) {
      return false;
    }
  }
  return true;
}

/** The dialog's own load: one audit's documents, fetched when it opens. */
export interface QaAuditLoad {
  readonly loading: boolean;
  readonly audit: QaSessionAudit | null;
  readonly error: string | null;
}

export function useSessionAuditDocument(
  api: QaAuditApi | null,
  sessionId: string | null,
  open: boolean,
  /** Reload key; the summary's `modifiedAt` changes exactly when bytes do. */
  modifiedAt: string | null,
): QaAuditLoad {
  const [state, setState] = useState<QaAuditLoad>({
    loading: false,
    audit: null,
    error: null,
  });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!open || api === null || sessionId === null) {
      setState({ loading: false, audit: null, error: null });
      return () => {
        alive.current = false;
      };
    }
    setState({ loading: true, audit: null, error: null });
    void (async () => {
      try {
        const audit = await api.audit(sessionId);
        if (!alive.current) return;
        setState({
          loading: false,
          audit: audit.available ? audit : null,
          error: null,
        });
      } catch (error) {
        if (!alive.current) return;
        setState({
          loading: false,
          audit: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [api, sessionId, open, modifiedAt]);

  return state;
}
