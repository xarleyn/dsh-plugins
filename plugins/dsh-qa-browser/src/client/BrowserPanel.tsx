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

function browserStatus(
  state: BrowserPanelState | null,
  loading: boolean,
): string {
  if (state === null) {
    return loading ? "Получаем состояние…" : "Нет данных о Browser";
  }
  const session = state.session;
  if (session === null) return "Browser ещё не запускался";
  switch (session.status) {
    case "starting":
      return "Запуск Chromium…";
    case "crashed":
      return "Chromium завершился с ошибкой";
    case "idle":
      return "Browser неактивен";
    case "closed":
      return "Browser закрыт";
    default:
      return session.control.owner === "human"
        ? "Управляет пользователь"
        : "Управляет агент";
  }
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
  const [address, setAddress] = useState("about:blank");
  const [editingAddress, setEditingAddress] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleId, setScaleId] = useState("fit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(makeClientId()).current;
  const lastFrameRevision = useRef<number | null>(null);
  const requestSequence = useRef(0);
  const stage = useRef<HTMLDivElement | null>(null);
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stage.current = node;
  }, []);

  const session = state?.session ?? null;
  const selected = state?.tabs.find((tab) => tab.id === session?.selectedTabId);
  const ownsControl =
    session?.control.owner === "human" && session.control.clientId === clientId;
  const coordinateInputEnabled = state?.coordinateInputEnabled === true;
  const interactive = ownsControl && session !== null;
  const scale = BROWSER_SCALES.find((option) => option.id === scaleId)?.scale;

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
        const selectedId = next.session?.selectedTabId;
        const tab = next.tabs.find((candidate) => candidate.id === selectedId);
        if (tab === undefined) {
          setFrame(null);
          lastFrameRevision.current = null;
          setError(null);
          return;
        }
        if (!forceFrame && lastFrameRevision.current === tab.revision) {
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
        lastFrameRevision.current = nextFrame.revision;
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

  useEffect(() => {
    if (editingAddress) return;
    setAddress(
      selected?.url === undefined || selected.url === ""
        ? "about:blank"
        : selected.url,
    );
  }, [editingAddress, selected?.url]);

  useEffect(() => {
    if (!ownsControl || owner.sessionId === null) return;
    const sessionId = owner.sessionId;
    const heartbeatMs = Math.max(
      1_000,
      Math.floor(((state?.humanControlLeaseSeconds ?? 30) * 1_000) / 3),
    );
    const timer = window.setInterval(() => {
      void props.browserRemote
        .panelControlHeartbeat(owner.qaToken, sessionId, clientId)
        .then(remoteValue)
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          void refresh(false);
        });
    }, heartbeatMs);
    return () => {
      window.clearInterval(timer);
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
    refresh,
    state?.humanControlLeaseSeconds,
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
    const target = normalizeAddress(address);
    if (target === null) {
      setError("Введите адрес страницы.");
      return;
    }
    navigateTo(target);
  }, [address, navigateTo]);

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
        label: ownsControl ? "Вернуть агенту" : "Взять управление",
        disabled:
          state?.humanControlEnabled !== true ||
          (!ownsControl && session?.control.owner === "human"),
        onSelect: () => {
          if (ownsControl) releaseControl();
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
    ownsControl,
    refresh,
    releaseControl,
    selected,
    session?.control.owner,
    state?.humanControlEnabled,
    takeControl,
  ]);

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
  const emptyMessage =
    session === null
      ? "Browser ещё не запускался в этой сессии. Нажмите «Взять управление», чтобы открыть страницу самим."
      : loading
        ? "Получаем изображение…"
        : "Вкладка ещё не открывала страницу.";

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
          address={address}
          editable={interactive && selected !== undefined}
          canGoBack={(selected?.history.back ?? 0) > 0}
          canGoForward={(selected?.history.forward ?? 0) > 0}
          deviceOpen={deviceOpen}
          menuOpen={menuOpen}
          onAddressChange={setAddress}
          onAddressFocus={() => setEditingAddress(true)}
          onAddressBlur={() => setEditingAddress(false)}
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
        emptyMessage={emptyMessage}
        viewport={selected?.viewport ?? { width: 1_280, height: 720 }}
        scale={scale ?? null}
        interactive={interactive}
        coordinateInputEnabled={coordinateInputEnabled}
        // The page is driven by whoever holds the lease, which may be another
        // panel: the chip reports the session, not this pane.
        ownerLabel={
          session?.control.owner === "human"
            ? "Управляет пользователь"
            : "Управляет агент"
        }
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
      <BrowserStatusBar
        status={browserStatus(state, loading)}
        viewport={selected?.viewport ?? null}
        tabCount={state?.tabs.length ?? 0}
        control={
          state?.humanControlEnabled === true && session !== null
            ? {
                label: ownsControl
                  ? "Вернуть агенту"
                  : session.control.owner === "human"
                    ? "Занято другой панелью"
                    : "Взять управление",
                disabled: !ownsControl && session.control.owner === "human",
                onSelect: () =>
                  ownsControl ? releaseControl() : takeControl(),
              }
            : null
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
