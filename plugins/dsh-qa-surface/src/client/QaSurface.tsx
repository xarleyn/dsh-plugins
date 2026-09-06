import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type {
  HostDescriptionSource,
  IApiClient,
} from "@deepseek-ai/dsh-client-connection/client";
import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { QaSessionState } from "../types.js";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import { QaSessionController } from "./QaSessionController.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaMessage } from "./components/QaMessage.js";

const INACTIVE_STATE: QaSessionState = Object.freeze({
  phase: "idle",
  sessionId: null,
  messages: Object.freeze([]),
  error: null,
  canSend: false,
  canStop: false,
});
const noopSubscribe = () => () => undefined;

export interface QaSurfaceFace {
  readonly route: QaRouteController;
  readonly config: QaConfigController;
  readonly sessions: ISessions;
  readonly api: Pick<IApiClient["sessions"], "create" | "selectModel">;
  readonly connection: HostDescriptionSource;
}

type QaSurfaceProps = PropsRuntime<"shell.overlay"> & InjectFace<QaSurfaceFace>;

function focusable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hidden);
}

function trapKeys(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
  if (event.key !== "Tab") return;
  const items = focusable(event.currentTarget);
  if (items.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function statusText(state: QaSessionState): string | null {
  if (state.phase === "creating") return "Connecting…";
  if (state.phase === "reconnecting") return "Connection lost. Reconnecting…";
  if (state.phase === "running") return "Assistant is responding…";
  return null;
}

export function QaSurface(props: QaSurfaceProps) {
  const route = useSyncExternalStore(
    props.route.subscribe,
    props.route.getSnapshot,
    props.route.getSnapshot,
  );
  const configState = useSyncExternalStore(
    props.config.subscribe,
    props.config.getSnapshot,
    props.config.getSnapshot,
  );
  const config = configState.config;
  const [controller, setController] = useState<QaSessionController>();
  const transcript = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  useEffect(() => {
    if (!route.active) {
      setController(undefined);
      return;
    }
    const next = new QaSessionController({
      sessions: props.sessions,
      api: props.api,
      connection: props.connection,
      config,
      storage: window.localStorage,
    });
    setController(next);
    void next.ensureSession();
    return () => next.dispose();
  }, [config, props.api, props.connection, props.sessions, route.active]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => INACTIVE_STATE),
    controller?.getSnapshot ?? (() => INACTIVE_STATE),
  );

  useEffect(() => {
    if (!route.active) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.dataset.dshQaSurface = "active";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("#dsh-qa-prompt")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      delete document.body.dataset.dshQaSurface;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [route.active]);

  useLayoutEffect(() => {
    const element = transcript.current;
    if (element !== null && nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [state.messages]);

  if (!route.active) return null;

  const status = statusText(state);
  const empty = state.messages.length === 0;
  return (
    <main
      className="dsh-qa-surface"
      aria-label={config.branding.title}
      tabIndex={-1}
      onKeyDown={trapKeys}
    >
      {config.ui.showHeader ? (
        <header className="dsh-qa-header">
          <div
            className="dsh-qa-header__inner"
            style={{ maxWidth: config.ui.maxContentWidth }}
          >
            {config.branding.logoUrl === null ? null : (
              <img
                className="dsh-qa-header__logo"
                src={config.branding.logoUrl}
                alt=""
              />
            )}
            <div className="dsh-qa-header__text">
              <h1>{config.branding.title}</h1>
              {config.branding.subtitle === "" ? null : (
                <p>{config.branding.subtitle}</p>
              )}
            </div>
            {config.ui.showReset && config.session.policy !== "fixed" ? (
              <button
                type="button"
                className="dsh-qa-button dsh-qa-button--secondary"
                disabled={
                  controller === undefined || state.phase === "creating"
                }
                onClick={() => void controller?.reset()}
              >
                New chat
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      <div
        ref={transcript}
        className="dsh-qa-transcript"
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            96;
        }}
      >
        <div
          className="dsh-qa-transcript__inner"
          style={{ maxWidth: config.ui.maxContentWidth }}
        >
          {empty ? (
            <section
              className="dsh-qa-welcome"
              aria-labelledby="dsh-qa-welcome-title"
            >
              <h2 id="dsh-qa-welcome-title">
                {config.branding.welcomeMessage}
              </h2>
              {config.suggestedQuestions.length > 0 ? (
                <div
                  className="dsh-qa-suggestions"
                  aria-label="Suggested questions"
                >
                  {config.suggestedQuestions.map((question) => (
                    <button
                      type="button"
                      key={question}
                      disabled={!state.canSend}
                      onClick={() => void controller?.send(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            state.messages.map((message) => (
              <QaMessage
                key={message.id}
                message={message}
                renderMarkdown={config.ui.renderMarkdown}
                showTimestamp={config.ui.showTimestamps}
              />
            ))
          )}
          {state.error === null ? null : (
            <div className="dsh-qa-error" role="alert">
              <span>{state.error}</span>
              {state.phase === "error" ? (
                <button
                  type="button"
                  onClick={() => void controller?.ensureSession()}
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="dsh-qa-footer">
        <div
          className="dsh-qa-footer__inner"
          style={{ maxWidth: config.ui.maxContentWidth }}
        >
          <div className="dsh-qa-status" aria-live="polite" aria-atomic="true">
            {status}
          </div>
          <QaComposer
            placeholder={config.branding.placeholder}
            canSend={state.canSend}
            canStop={state.canStop}
            running={state.phase === "running"}
            showStop={config.ui.showStop}
            onSend={(text) => controller?.send(text) ?? Promise.resolve(false)}
            onStop={() => controller?.stop() ?? Promise.resolve()}
          />
        </div>
      </footer>
    </main>
  );
}
