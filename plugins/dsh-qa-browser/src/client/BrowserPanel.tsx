/**
 * The QA panel's browser: a live view of the page this chat's agent drives,
 * with the chrome of a browser around it. The container owns the lease, the
 * polling and every remote call; the pieces in `chrome.tsx` only draw what it
 * hands them.
 *
 * Two facts decide what the chrome may do, and they are deliberately separate:
 * the *lease* says who is driving, and the deployment's coordinate-input switch
 * says whether pointer gestures may be forwarded at all. Keys, text and scroll
 * follow the lease; clicks and context menus need both.
 *
 * What all of that resolves to — the selected tab, the lease owner, the
 * refusals, the address the field reads — is decided once, in `panel-view.ts`,
 * and consumed from there. This file owns what the module cannot know: the
 * remotes, the polling, the frame memo, and the operator's own draft in the
 * address field.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  RemoteResult,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";
import {
  QA_SURFACE_PANEL_SLOT,
  type QaSurfacePanelOwnerProps,
} from "@yadsh/dsh-qa-surface/client/panels";

import type { BrowserPanelFrame, BrowserPanelState } from "../types.js";
import {
  BrowserDeviceRow,
  BrowserMenu,
  BrowserStage,
  BrowserStatusBar,
  BrowserTabStrip,
  BrowserToolbar,
  type BrowserMenuItem,
} from "./chrome.js";
import { BROWSER_SCALES } from "./devices.js";
import {
  panelView,
  refusalKindLabel,
  selectedTab,
  type PanelAddressDraft,
} from "./panel-view.js";
import { normalizeAddress } from "./url.js";

export type BrowserPanelRemote = TypertRemoteNamespace<"qaBrowser">;

export interface BrowserPanelProps extends PropsRuntime<
  typeof QA_SURFACE_PANEL_SLOT
> {
  readonly browserRemote: BrowserPanelRemote;
}

/**
 * A tab the agent is working through is worth watching closely, and a human who
 * holds the lease expects their own clicks to show up promptly; an idle preview
 * is not worth a screenshot every second.
 */
const POLL_ACTIVE_MS = 1_000;
/**
 * Idle panels poll slowly: the frame itself is fetched only when the tab
 * revision changes (a ~0.5 MB PNG per poll is not a heartbeat), so the idle
 * poll only costs one small panelState call. A real screencast channel is
 * the structural fix and stays a SPEC non-goal for this release.
 */
const POLL_IDLE_MS = 5_000;

function remoteValue<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function keyboardShortcut(event: KeyboardEvent<HTMLElement>): string {
  const modifiers = [
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Meta" : null,
  ].filter((value): value is string => value !== null);
  return [...modifiers, event.key].join("+");
}

export function BrowserPanel(props: BrowserPanelProps) {
  const owner: QaSurfacePanelOwnerProps = props;
  const [state, setState] = useState<BrowserPanelState | null>(null);
  const [frame, setFrame] = useState<BrowserPanelFrame | null>(null);
  const [addressDraft, setAddressDraft] = useState<PanelAddressDraft>({
    editing: false,
    value: null,
  });
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleId, setScaleId] = useState("fit");
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
  const stage = useRef<HTMLDivElement | null>(null);
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stage.current = node;
  }, []);

  // One pass over the polled state decides the tab, the lease, the refusals and
  // the address; everything below reads that decision instead of repeating it.
  const view = panelView(state, loading, clientId, addressDraft);
  const session = view.session;
  const selected = view.selected;
  const ownsControl = view.ownsControl;
  const refusals = view.refusals;
  const interactive = view.canDrive;
  const coordinateInputEnabled = state?.coordinateInputEnabled === true;
  const scale = BROWSER_SCALES.find((option) => option.id === scaleId)?.scale;
  leaseSeconds.current = state?.humanControlLeaseSeconds ?? 30;

  const refresh = useCallback(
    async (forceFrame: boolean) => {
      if (!owner.visible || owner.sessionId === null) return;
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const next = remoteValue(
          await props.browserRemote.panelState(owner.qaToken, owner.sessionId),
        );
        if (sequence !== requestSequence.current || owner.signal.aborted)
          return;
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
          await props.browserRemote.panelFrame(
            owner.qaToken,
            owner.sessionId,
            tab.id,
          ),
        );
        if (sequence !== requestSequence.current || owner.signal.aborted)
          return;
        lastFrame.current = { tabId: tab.id, revision: nextFrame.revision };
        setFrame(nextFrame);
        setError(null);
      } catch (cause) {
        if (sequence !== requestSequence.current || owner.signal.aborted)
          return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (sequence === requestSequence.current && !owner.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [
      owner.qaToken,
      owner.sessionId,
      owner.signal,
      owner.visible,
      props.browserRemote,
    ],
  );

  /** Run one remote mutation, then re-read the state and the image behind it. */
  const runRemote = useCallback(
    async (call: () => Promise<RemoteResult<unknown>>) => {
      setLoading(true);
      try {
        remoteValue(await call());
        await refresh(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  // The busy flag, not the tabs array, is the dependency: every poll produces
  // new tab objects, and an identity churn here would re-run this effect (and
  // invalidate an in-flight frame fetch) once per poll.
  const anyTabLoading =
    state?.tabs.some((tab) => tab.status === "loading") ?? false;

  useEffect(() => {
    if (!owner.visible || owner.sessionId === null) return;
    void refresh(true);
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
        void props.browserRemote
          .panelControlHeartbeat(owner.qaToken, sessionId, clientId)
          .then(remoteValue)
          .catch((cause: unknown) => {
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
    props.browserRemote,
    refresh,
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
      void props.browserRemote.panelReleaseControl(
        owner.qaToken,
        sessionId,
        clientId,
      );
    };
  }, [
    clientId,
    owner.qaToken,
    owner.sessionId,
    ownsControl,
    props.browserRemote,
  ]);

  const sessionId = owner.sessionId;
  const token = owner.qaToken;

  const takeControl = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() =>
      props.browserRemote.panelTakeControl(token, sessionId, clientId),
    );
  }, [clientId, props.browserRemote, runRemote, sessionId, token]);

  const releaseControl = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() =>
      props.browserRemote.panelReleaseControl(token, sessionId, clientId),
    );
  }, [clientId, props.browserRemote, runRemote, sessionId, token]);

  const openTab = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() =>
      props.browserRemote.panelNewTab(token, sessionId, clientId),
    );
  }, [clientId, props.browserRemote, runRemote, sessionId, token]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (sessionId === null) return;
      void runRemote(() =>
        props.browserRemote.panelCloseTab(token, sessionId, tabId, clientId),
      );
    },
    [clientId, props.browserRemote, runRemote, sessionId, token],
  );

  const selectTab = useCallback(
    (tabId: string) => {
      if (sessionId === null) return;
      void runRemote(() =>
        props.browserRemote.panelSelectTab(token, sessionId, tabId, clientId),
      );
    },
    [clientId, props.browserRemote, runRemote, sessionId, token],
  );

  const navigateTo = useCallback(
    (target: string) => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        props.browserRemote.panelNavigate(
          token,
          sessionId,
          selected.id,
          clientId,
          target,
        ),
      );
    },
    [clientId, props.browserRemote, runRemote, selected, sessionId, token],
  );

  const history = useCallback(
    (action: "back" | "forward" | "reload") => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        props.browserRemote.panelHistory(
          token,
          sessionId,
          selected.id,
          clientId,
          action,
        ),
      );
    },
    [clientId, props.browserRemote, runRemote, selected, sessionId, token],
  );

  const resize = useCallback(
    (width: number, height: number) => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        props.browserRemote.panelViewport(
          token,
          sessionId,
          selected.id,
          clientId,
          width,
          height,
        ),
      );
    },
    [clientId, props.browserRemote, runRemote, selected, sessionId, token],
  );

  const submitAddress = useCallback(() => {
    const target = normalizeAddress(view.address);
    if (target === null) {
      setError("Введите адрес страницы.");
      return;
    }
    navigateTo(target);
  }, [navigateTo, view.address]);

  const pointer = useCallback(
    (event: MouseEvent<HTMLImageElement>, button: "left" | "right") => {
      if (!interactive || !coordinateInputEnabled) return;
      if (sessionId === null || selected === undefined) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const relativeX = event.clientX - bounds.left;
      const relativeY = event.clientY - bounds.top;
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        relativeX < 0 ||
        relativeY < 0 ||
        relativeX >= bounds.width ||
        relativeY >= bounds.height
      ) {
        return;
      }
      // Clicking the page hands it the keyboard, the way a browser does: the
      // stage, not the panel, is what forwards keys to the page.
      stage.current?.focus();
      void runRemote(() =>
        props.browserRemote.panelPointer(
          token,
          sessionId,
          selected.id,
          clientId,
          "click",
          (relativeX / bounds.width) * selected.viewport.width,
          (relativeY / bounds.height) * selected.viewport.height,
          button,
          1,
        ),
      );
    },
    [
      clientId,
      coordinateInputEnabled,
      interactive,
      props.browserRemote,
      runRemote,
      selected,
      sessionId,
      token,
    ],
  );

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!interactive || sessionId === null || selected === undefined) return;
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        void runRemote(() =>
          props.browserRemote.panelText(
            token,
            sessionId,
            selected.id,
            clientId,
            event.key,
          ),
        );
        return;
      }
      if (
        event.key === "Tab" ||
        event.key === "Enter" ||
        event.key === "Escape" ||
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key.startsWith("Arrow") ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        event.preventDefault();
        const key = keyboardShortcut(event);
        void runRemote(() =>
          props.browserRemote.panelKey(
            token,
            sessionId,
            selected.id,
            clientId,
            key,
          ),
        );
      }
    },
    [
      clientId,
      interactive,
      props.browserRemote,
      runRemote,
      selected,
      sessionId,
      token,
    ],
  );

  const paste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (!interactive || sessionId === null || selected === undefined) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      void runRemote(() =>
        props.browserRemote.panelText(
          token,
          sessionId,
          selected.id,
          clientId,
          text,
        ),
      );
    },
    [
      clientId,
      interactive,
      props.browserRemote,
      runRemote,
      selected,
      sessionId,
      token,
    ],
  );

  const wheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (!interactive || sessionId === null || selected === undefined) return;
      event.preventDefault();
      void runRemote(() =>
        props.browserRemote.panelScroll(
          token,
          sessionId,
          selected.id,
          clientId,
          event.deltaX,
          event.deltaY,
        ),
      );
    },
    [
      clientId,
      interactive,
      props.browserRemote,
      runRemote,
      selected,
      sessionId,
      token,
    ],
  );

  const copyAddress = useCallback(() => {
    const url = selected?.url ?? "";
    if (url === "") return;
    void navigator.clipboard?.writeText(url).catch((cause: unknown) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Браузер не разрешил скопировать адрес.",
      );
    });
  }, [selected?.url]);

  const menuItems = useMemo((): readonly BrowserMenuItem[] => {
    return [
      {
        id: "control",
        label: view.menuControl.label,
        disabled: view.menuControl.disabled,
        onSelect: () => {
          if (view.menuControl.action === "release") releaseControl();
          else takeControl();
        },
      },
      {
        id: "refresh",
        label: "Обновить изображение",
        onSelect: () => void refresh(true),
      },
      {
        id: "reload",
        label: "Перезагрузить страницу",
        disabled: !interactive || selected === undefined,
        onSelect: () => history("reload"),
      },
      {
        id: "new-tab",
        label: "Новая вкладка",
        disabled: !interactive,
        onSelect: openTab,
      },
      {
        id: "close-tab",
        label: "Закрыть вкладку",
        disabled: !interactive || selected === undefined,
        onSelect: () => {
          if (selected !== undefined) closeTab(selected.id);
        },
      },
      {
        id: "copy",
        label: "Копировать адрес",
        disabled: selected === undefined || (selected?.url ?? "") === "",
        onSelect: copyAddress,
      },
    ];
  }, [
    closeTab,
    copyAddress,
    history,
    interactive,
    openTab,
    refresh,
    releaseControl,
    selected,
    takeControl,
    view.menuControl,
  ]);

  /** The status-bar chip, resolved once for the JSX below. */
  const chip = view.chipControl;

  if (owner.sessionId === null) {
    return (
      <div className="dsh-qa-browser-panel__empty" role="status">
        Откройте или создайте чат, чтобы связать Browser с QA-сессией.
      </div>
    );
  }

  const frameView =
    frame === null
      ? null
      : {
          src: `data:${frame.mediaType};base64,${frame.data}`,
          alt: `Страница Browser: ${frame.title || frame.url}`,
        };

  return (
    <section className="dsh-qa-browser-panel" aria-label="Browser">
      <BrowserTabStrip
        tabs={state?.tabs ?? []}
        selectedId={session?.selectedTabId ?? null}
        interactive={interactive}
        onSelect={selectTab}
        onClose={closeTab}
        onNewTab={openTab}
      />
      <div className="dsh-qa-browser-panel__bar">
        <BrowserToolbar
          address={view.address}
          editable={interactive && selected !== undefined}
          canGoBack={(selected?.history.back ?? 0) > 0}
          canGoForward={(selected?.history.forward ?? 0) > 0}
          deviceOpen={deviceOpen}
          menuOpen={menuOpen}
          onAddressChange={(value) => {
            // Typing starts an edit and owns the field until the operator
            // leaves it: nothing a poll delivers may overwrite half a URL.
            setAddressDraft({ editing: true, value });
          }}
          onAddressFocus={() => {
            setAddressDraft((draft) => ({ ...draft, editing: true }));
          }}
          onAddressBlur={() => {
            setAddressDraft({ editing: false, value: null });
          }}
          onAddressSubmit={submitAddress}
          onBack={() => history("back")}
          onForward={() => history("forward")}
          onReload={() => history("reload")}
          onToggleDevice={() => setDeviceOpen((open) => !open)}
          onToggleMenu={() => setMenuOpen((open) => !open)}
        />
        {deviceOpen && selected !== undefined ? (
          <BrowserDeviceRow
            viewport={selected.viewport}
            scaleId={scaleId}
            interactive={interactive}
            onResize={resize}
            onPreset={(preset) => resize(preset.width, preset.height)}
            onScale={setScaleId}
          />
        ) : null}
        {menuOpen ? (
          <BrowserMenu items={menuItems} onClose={() => setMenuOpen(false)} />
        ) : null}
      </div>
      <BrowserStage
        frame={frameView}
        busy={selected?.status === "loading"}
        emptyMessage={view.emptyMessage}
        viewport={view.viewport}
        scale={scale ?? null}
        interactive={interactive}
        coordinateInputEnabled={coordinateInputEnabled}
        // The page is driven by whoever holds the lease, which may be another
        // panel: the chip reports the session, not this pane.
        ownerLabel={view.ownerLabel}
        onStageRef={bindStage}
        onImageClick={(event) => pointer(event, "left")}
        onImageContextMenu={(event) => {
          if (!interactive) return;
          event.preventDefault();
          pointer(event, "right");
        }}
        onKeyDown={keyDown}
        onPaste={paste}
        onWheel={wheel}
      />
      {view.refusalHeadline === null ? null : (
        <div className="dsh-qa-browser-panel__refusal" role="alert">
          <p className="dsh-qa-browser-panel__refusal-title">
            {view.refusalHeadline}
          </p>
          <ul className="dsh-qa-browser-panel__refusal-list">
            {refusals.map((entry, index) => (
              <li
                className="dsh-qa-browser-panel__refusal-item"
                key={`${String(index)}:${entry.kind}:${entry.code}:${entry.host}`}
              >
                <span className="dsh-qa-browser-panel__refusal-host">
                  {entry.host}
                </span>
                <span className="dsh-qa-browser-panel__refusal-kind">
                  {refusalKindLabel(entry)}
                </span>
              </li>
            ))}
          </ul>
          <p className="dsh-qa-browser-panel__refusal-text">
            {view.leadRefusal?.message}
          </p>
          {/*
            The refusal names the setting; what it cannot say is which of the
            two ways to open the deployment is the sane one, and that is the
            operator's decision to make here rather than in the chat.
          */}
          <p className="dsh-qa-browser-panel__refusal-hint">
            Это настройка контура, а не чата: точечно — добавить узел в
            security.network.allowHosts, широко — включить
            security.network.allowPrivateNetworks для всей приватной сети.
          </p>
        </div>
      )}
      <BrowserStatusBar
        status={view.statusLine}
        viewport={selected?.viewport ?? null}
        tabCount={view.tabCount}
        control={
          chip === null
            ? null
            : {
                label: chip.label,
                disabled: chip.disabled,
                onSelect: () => {
                  if (chip.action === "release") releaseControl();
                  else takeControl();
                },
              }
        }
      />
      {error === null ? null : (
        <div className="dsh-qa-browser-panel__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
