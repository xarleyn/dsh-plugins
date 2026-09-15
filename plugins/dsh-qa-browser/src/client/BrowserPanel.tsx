import { useCallback, useEffect, useRef, useState } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult, TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import {
  QA_SURFACE_PANEL_SLOT,
  type QaSurfacePanelOwnerProps,
} from "@yadsh/dsh-qa-surface/client/panels";

import type { BrowserPanelFrame, BrowserPanelState } from "../types.js";

export type BrowserPanelRemote = TypertRemoteNamespace<"qaBrowser">;

export interface BrowserPanelProps
  extends PropsRuntime<typeof QA_SURFACE_PANEL_SLOT> {
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

export function BrowserPanel(props: BrowserPanelProps) {
  const owner: QaSurfacePanelOwnerProps = props;
  const [state, setState] = useState<BrowserPanelState | null>(null);
  const [frame, setFrame] = useState<BrowserPanelFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFrameRevision = useRef<number | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(
    async (forceFrame: boolean) => {
      if (!owner.visible || owner.sessionId === null) return;
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const next = remoteValue(
          await props.browserRemote.panelState(
            owner.qaToken,
            owner.sessionId,
          ),
        );
        if (sequence !== requestSequence.current || owner.signal.aborted) return;
        setState(next);
        const selectedId = next.session?.selectedTabId;
        const selected = next.tabs.find((tab) => tab.id === selectedId);
        if (selected === undefined) {
          setFrame(null);
          lastFrameRevision.current = null;
          setError(null);
          return;
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
        if (sequence !== requestSequence.current || owner.signal.aborted) return;
        lastFrameRevision.current = nextFrame.revision;
        setFrame(nextFrame);
        setError(null);
      } catch (cause) {
        if (sequence !== requestSequence.current || owner.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (sequence === requestSequence.current && !owner.signal.aborted) {
          setLoading(false);
        }
      }
    }, [
      owner.qaToken,
      owner.sessionId,
      owner.signal,
      owner.visible,
      props.browserRemote,
    ],
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

  if (owner.sessionId === null) {
    return (
      <div className="dsh-qa-browser-panel__empty" role="status">
        Откройте или создайте чат, чтобы связать Browser с QA-сессией.
      </div>
    );
  }

  const selectedId = state?.session?.selectedTabId;
  const selected = state?.tabs.find((tab) => tab.id === selectedId);

  return (
    <section className="dsh-qa-browser-panel" aria-label="Browser">
      <div className="dsh-qa-browser-panel__tabs" role="tablist" aria-label="Вкладки Browser">
        {(state?.tabs ?? []).map((tab) => (
          <div
            key={tab.id}
            className="dsh-qa-browser-panel__tab"
            role="tab"
            aria-selected={tab.id === selectedId}
            title={tab.title || tab.url || "Новая вкладка"}
          >
            {tab.status === "loading" ? <span aria-hidden="true">◌</span> : null}
            <span>{tab.title || "Новая вкладка"}</span>
          </div>
        ))}
      </div>
      <div className="dsh-qa-browser-panel__toolbar">
        <div className="dsh-qa-browser-panel__address" title={selected?.url}>
          {selected?.url || "about:blank"}
        </div>
        <button
          type="button"
          className="dsh-qa-browser-panel__refresh"
          disabled={loading}
          onClick={() => void refresh(true)}
          aria-label="Обновить изображение Browser"
        >
          ↻
        </button>
      </div>
      <div className="dsh-qa-browser-panel__viewport">
        {frame === null ? (
          <div className="dsh-qa-browser-panel__empty" role="status">
            {loading ? "Получаем изображение…" : "Browser ещё не запускался в этой сессии."}
          </div>
        ) : (
          <img
            src={`data:${frame.mediaType};base64,${frame.data}`}
            alt={`Страница Browser: ${frame.title || frame.url}`}
          />
        )}
      </div>
      <footer className="dsh-qa-browser-panel__status">
        <span>{browserStatus(state)}</span>
        {selected === undefined ? null : (
          <span>
            {selected.viewport.width}×{selected.viewport.height}
          </span>
        )}
      </footer>
      {error === null ? null : (
        <div className="dsh-qa-browser-panel__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
