import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
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

export type BrowserPanelRemote = TypertRemoteNamespace<"qaBrowser">;

export interface BrowserPanelProps extends PropsRuntime<
  typeof QA_SURFACE_PANEL_SLOT
> {
  readonly browserRemote: BrowserPanelRemote;
}

function remoteValue<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function browserStatus(state: BrowserPanelState | null): string {
  if (state?.session === null) return "Browser ещё не запускался";
  switch (state?.session.status) {
    case "starting":
      return "Запуск Chromium…";
    case "crashed":
      return "Chromium завершился с ошибкой";
    case "idle":
      return "Browser неактивен";
    case "closed":
      return "Browser закрыт";
    default:
      return state?.session.control.owner === "human"
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(makeClientId()).current;
  const addressInput = useRef<HTMLInputElement>(null);
  const lastFrameRevision = useRef<number | null>(null);
  const requestSequence = useRef(0);

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
        const selected = next.tabs.find((tab) => tab.id === selectedId);
        if (selected === undefined) {
          setFrame(null);
          lastFrameRevision.current = null;
          setError(null);
          return;
        }
        if (document.activeElement !== addressInput.current) {
          setAddress(selected.url || "about:blank");
        }
        if (!forceFrame && lastFrameRevision.current === selected.revision) {
          setError(null);
          return;
        }
        const nextFrame = remoteValue(
          await props.browserRemote.panelFrame(
            owner.qaToken,
            owner.sessionId,
            selected.id,
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

  const runInteraction = useCallback(
    async (action: () => Promise<unknown>) => {
      setLoading(true);
      try {
        await action();
        await refresh(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!owner.visible || owner.sessionId === null) return;
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2_000);
    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
    };
  }, [owner.sessionId, owner.visible, refresh]);

  const ownsControl =
    state?.session?.control.owner === "human" &&
    state.session.control.clientId === clientId;

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

  if (owner.sessionId === null) {
    return (
      <div className="dsh-qa-browser-panel__empty" role="status">
        Откройте или создайте чат, чтобы связать Browser с QA-сессией.
      </div>
    );
  }

  const sessionId = owner.sessionId;
  const selectedId = state?.session?.selectedTabId;
  const selected = state?.tabs.find((tab) => tab.id === selectedId);
  const controlledByOther =
    state?.session?.control.owner === "human" && !ownsControl;

  const takeControl = () =>
    runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelTakeControl(
          owner.qaToken,
          sessionId,
          clientId,
        ),
      );
    });

  const releaseControl = () =>
    runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelReleaseControl(
          owner.qaToken,
          sessionId,
          clientId,
        ),
      );
    });

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    if (!ownsControl || selected === undefined) return;
    void runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelNavigate(
          owner.qaToken,
          sessionId,
          selected.id,
          clientId,
          address,
        ),
      );
    });
  };

  const pointer = (
    event: MouseEvent<HTMLImageElement>,
    button: "left" | "right",
  ) => {
    if (!ownsControl || selected === undefined) return;
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
    event.currentTarget.parentElement?.focus();
    void runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelPointer(
          owner.qaToken,
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
    });
  };

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!ownsControl || selected === undefined) return;
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      void runInteraction(async () => {
        remoteValue(
          await props.browserRemote.panelText(
            owner.qaToken,
            sessionId,
            selected.id,
            clientId,
            event.key,
          ),
        );
      });
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
      void runInteraction(async () => {
        remoteValue(
          await props.browserRemote.panelKey(
            owner.qaToken,
            sessionId,
            selected.id,
            clientId,
            key,
          ),
        );
      });
    }
  };

  const paste = (event: ClipboardEvent<HTMLElement>) => {
    if (!ownsControl || selected === undefined) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    void runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelText(
          owner.qaToken,
          sessionId,
          selected.id,
          clientId,
          text,
        ),
      );
    });
  };

  const wheel = (event: WheelEvent<HTMLElement>) => {
    if (!ownsControl || selected === undefined) return;
    event.preventDefault();
    void runInteraction(async () => {
      remoteValue(
        await props.browserRemote.panelScroll(
          owner.qaToken,
          sessionId,
          selected.id,
          clientId,
          event.deltaX,
          event.deltaY,
        ),
      );
    });
  };

  return (
    <section className="dsh-qa-browser-panel" aria-label="Browser">
      <div
        className="dsh-qa-browser-panel__tabs"
        role="tablist"
        aria-label="Вкладки Browser"
      >
        {(state?.tabs ?? []).map((tab) => (
          <button
            type="button"
            key={tab.id}
            className="dsh-qa-browser-panel__tab"
            role="tab"
            aria-selected={tab.id === selectedId}
            disabled={!ownsControl}
            title={tab.title || tab.url || "Новая вкладка"}
            onClick={() =>
              void runInteraction(async () => {
                remoteValue(
                  await props.browserRemote.panelSelectTab(
                    owner.qaToken,
                    sessionId,
                    tab.id,
                    clientId,
                  ),
                );
              })
            }
          >
            {tab.status === "loading" ? (
              <span aria-hidden="true">◌</span>
            ) : null}
            <span>{tab.title || "Новая вкладка"}</span>
          </button>
        ))}
      </div>
      <form className="dsh-qa-browser-panel__toolbar" onSubmit={navigate}>
        <input
          ref={addressInput}
          className="dsh-qa-browser-panel__address"
          aria-label="Адрес Browser"
          title={selected?.url}
          value={address}
          readOnly={!ownsControl}
          onChange={(event) => setAddress(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="dsh-qa-browser-panel__go"
          disabled={!ownsControl || loading || selected === undefined}
          aria-label="Перейти по адресу"
        >
          →
        </button>
        <button
          type="button"
          className="dsh-qa-browser-panel__refresh"
          disabled={loading}
          onClick={() => void refresh(true)}
          aria-label="Обновить изображение Browser"
        >
          ↻
        </button>
      </form>
      <div
        className="dsh-qa-browser-panel__viewport"
        tabIndex={ownsControl ? 0 : -1}
        aria-label={
          ownsControl
            ? "Интерактивное окно Browser"
            : "Предпросмотр Browser только для чтения"
        }
        onKeyDown={keyDown}
        onPaste={paste}
        onWheel={wheel}
      >
        {frame === null ? (
          <div className="dsh-qa-browser-panel__empty" role="status">
            {loading
              ? "Получаем изображение…"
              : "Browser ещё не запускался в этой сессии."}
          </div>
        ) : (
          <img
            className={
              ownsControl
                ? "dsh-qa-browser-panel__frame--interactive"
                : undefined
            }
            src={`data:${frame.mediaType};base64,${frame.data}`}
            alt={`Страница Browser: ${frame.title || frame.url}`}
            draggable={false}
            onClick={(event) => pointer(event, "left")}
            onContextMenu={(event) => {
              if (!ownsControl) return;
              event.preventDefault();
              pointer(event, "right");
            }}
          />
        )}
      </div>
      <footer className="dsh-qa-browser-panel__status">
        <span>{browserStatus(state)}</span>
        <div className="dsh-qa-browser-panel__status-actions">
          {selected === undefined ? null : (
            <span>
              {selected.viewport.width}×{selected.viewport.height}
            </span>
          )}
          {state?.humanControlEnabled && state.session !== null ? (
            <button
              type="button"
              className="dsh-qa-browser-panel__control"
              disabled={loading || controlledByOther}
              onClick={() =>
                void (ownsControl ? releaseControl() : takeControl())
              }
            >
              {ownsControl
                ? "Вернуть агенту"
                : controlledByOther
                  ? "Занято другой панелью"
                  : "Взять управление"}
            </button>
          ) : null}
        </div>
      </footer>
      {error === null ? null : (
        <div className="dsh-qa-browser-panel__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
