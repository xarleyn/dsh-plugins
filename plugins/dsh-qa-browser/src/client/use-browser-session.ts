/**
 * The panel's side of the session: what it polls, the frame it keeps, and the
 * lease it holds.
 *
 * Everything here is a question of transport rather than of drawing — when to
 * ask the host for state, when a fresh screenshot is worth ~0.5 MB, how the
 * lease is renewed and handed back — so the component reads as the chrome it
 * assembles and this module owns the conversation with the runtime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coalesceBrowserRefresh } from "./refresh-queue.js";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaSurfacePanelOwnerProps } from "@yadsh/dsh-qa-surface/client/panels";

import type { BrowserPanelFrame, BrowserPanelState } from "../types.js";
import type { BrowserPanelRemote } from "./BrowserPanel.js";
import {
  panelView,
  selectedTab,
  type PanelAddressDraft,
} from "./panel-view.js";
import {
  makeClientId,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  remoteValue,
} from "./panel-runtime.js";

export interface BrowserSessionTransport {
  readonly browserRemote: BrowserPanelRemote;
  readonly owner: QaSurfacePanelOwnerProps;
}

export function useBrowserSession({
  browserRemote,
  owner,
}: BrowserSessionTransport) {
  const [state, setState] = useState<BrowserPanelState | null>(null);
  const [frame, setFrame] = useState<BrowserPanelFrame | null>(null);
  const [addressDraft, setAddressDraft] = useState<PanelAddressDraft>({
    editing: false,
    value: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(makeClientId()).current;
  /**
   * The frame currently on the stage, identified the way the Host identifies a
   * picture: by the tab it belongs to *and* that tab's revision. A revision on
   * its own is not an identity — two tabs each carry their own counter, so two
   * pages that were both never scrolled share one number, and remembering only
   * the number showed the other tab's image.
   */
  const lastFrame = useRef<{ tabId: string; revision: number } | null>(null);
  /** The lease length the Host last advertised, read when a heartbeat is armed. */
  const leaseSeconds = useRef(30);
  const requestSequence = useRef(0);
  // A panel owner signal survives chat switches. A queued refresh belongs to
  // one identity and must never invalidate or overwrite the next chat's read.
  const identity = useMemo(
    () => ({}),
    [owner.qaToken, owner.sessionId, owner.signal, browserRemote],
  );
  const latestIdentity = useRef<object | null>(identity);
  latestIdentity.current = identity;
  const current = useCallback(
    () => latestIdentity.current === identity && !owner.signal.aborted,
    [identity, owner.signal],
  );
  useEffect(() => {
    latestIdentity.current = identity;
    return () => {
      if (latestIdentity.current === identity) latestIdentity.current = null;
    };
  }, [identity]);

  // One pass over the polled state decides the tab, the lease, the refusals and
  // the address; everything below reads that decision instead of repeating it.
  const view = panelView(state, loading, clientId, addressDraft);
  const { ownsControl } = view;
  leaseSeconds.current = state?.humanControlLeaseSeconds ?? 30;

  const read = useCallback(
    async (forceFrame: boolean) => {
      if (!current() || !owner.visible || owner.sessionId === null) return;
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const next = remoteValue(
          await browserRemote.panelState(owner.qaToken, owner.sessionId),
        );
        if (sequence !== requestSequence.current || !current()) return;
        setState(next);
        const tab = selectedTab(next);
        if (tab === undefined) {
          setFrame(null);
          lastFrame.current = null;
          setError(null);
          return;
        }
        if (
          !forceFrame &&
          lastFrame.current?.tabId === tab.id &&
          lastFrame.current.revision === tab.revision
        ) {
          setError(null);
          return;
        }
        const nextFrame = remoteValue(
          await browserRemote.panelFrame(
            owner.qaToken,
            owner.sessionId,
            tab.id,
          ),
        );
        if (sequence !== requestSequence.current || !current()) return;
        lastFrame.current = { tabId: tab.id, revision: nextFrame.revision };
        setFrame(nextFrame);
        setError(null);
      } catch (cause) {
        if (sequence !== requestSequence.current || !current()) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (sequence === requestSequence.current && current()) {
          setLoading(false);
        }
      }
    },
    [
      owner.qaToken,
      owner.sessionId,
      owner.signal,
      owner.visible,
      browserRemote,
      current,
    ],
  );
  const refresh = useMemo(
    () => coalesceBrowserRefresh(read, current),
    [read, current],
  );

  /** Run one remote mutation, then re-read the state and the image behind it. */
  const runRemote = useCallback(
    async (call: () => Promise<RemoteResult<unknown>>) => {
      setLoading(true);
      try {
        remoteValue(await call());
        if (!current()) return;
        await refresh(true);
      } catch (cause) {
        if (current())
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (current()) setLoading(false);
      }
    },
    [refresh, current],
  );

  // The busy flag, not the tabs array, is the dependency: every poll produces
  // new tab objects, and an identity churn here would re-run this effect (and
  // invalidate an in-flight frame fetch) once per poll.
  const anyTabLoading =
    state?.tabs.some((tab) => tab.status === "loading") ?? false;

  useEffect(() => {
    if (!owner.visible || owner.sessionId === null) return;
    void refresh(false);
    const timer = window.setInterval(
      () => void refresh(false),
      ownsControl || anyTabLoading ? POLL_ACTIVE_MS : POLL_IDLE_MS,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [owner.sessionId, owner.visible, ownsControl, anyTabLoading, refresh]);

  /**
   * Keep the lease alive while this panel holds it.
   *
   * The cadence comes from the length the Host advertises, read when the
   * heartbeat is armed rather than tracked as a dependency: the advertised
   * length is one more fact that arrives with a poll, and rebuilding the
   * interval on it would run the teardown beside this effect — which hands the
   * page back — and the operator would lose the lease they were still holding.
   */
  useEffect(() => {
    if (!ownsControl || owner.sessionId === null) return;
    const sessionId = owner.sessionId;
    const timer = window.setInterval(
      () => {
        void browserRemote
          .panelControlHeartbeat(owner.qaToken, sessionId, clientId)
          .then(remoteValue)
          .catch((cause: unknown) => {
            if (!current()) return;
            setError(cause instanceof Error ? cause.message : String(cause));
            void refresh(false);
          });
      },
      Math.max(1_000, Math.floor((leaseSeconds.current * 1_000) / 3)),
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [
    clientId,
    owner.qaToken,
    owner.sessionId,
    ownsControl,
    browserRemote,
    refresh,
    current,
  ]);

  /**
   * Hand the page back when this panel stops being the one that holds it: on
   * unmount, on a chat switch, or when the lease moves to the agent. Its
   * dependencies are deliberately only the ones that end or start a lease.
   */
  useEffect(() => {
    if (!ownsControl || owner.sessionId === null) return;
    const sessionId = owner.sessionId;
    return () => {
      void browserRemote
        .panelReleaseControl(owner.qaToken, sessionId, clientId)
        .catch(() => {
          /* The retiring chat has no active UI to receive this error. */
        });
    };
  }, [clientId, owner.qaToken, owner.sessionId, ownsControl, browserRemote]);

  return {
    addressDraft,
    clientId,
    error,
    frame,
    refresh,
    runRemote,
    setAddressDraft,
    setError,
    state,
    view,
  };
}
