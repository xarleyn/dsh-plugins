import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { HostDescriptionSource } from "@deepseek-ai/dsh-client-connection/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { QaSessionState } from "../types.js";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import { QaSessionController } from "./QaSessionController.js";
import type { QaSecureSession, QaSessions, QaSessionsApi } from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";

const noopSubscribe = () => () => undefined;

export interface QaSurfaceFace {
  readonly route: QaRouteController;
  readonly config: QaConfigController;
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly connection: HostDescriptionSource;
  readonly secureSession: QaSecureSession;
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
  if (state.phase === "creating") return "Подключаюсь…";
  if (state.phase === "reconnecting")
    return "Связь потерялась. Подключаюсь снова…";
  if (state.phase === "running") return "Скребу по сусекам…";
  return null;
}

function titleFromMessages(state: QaSessionState): string | null {
  const firstUser = state.messages.find((message) => message.role === "user");
  if (firstUser === undefined) return null;
  const title = firstUser.text.replace(/\s+/gu, " ").trim();
  if (title === "") return null;
  if (title.length <= 52) return title;
  return `${title.slice(0, 51).trimEnd()}…`;
}

function modeLabel(agentPreset: string | null): string {
  if (agentPreset === null) return "Режим вопросов";
  const name = agentPreset
    .replace(/[-_]+/gu, " ")
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  return `Режим «${name}»`;
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
      secureSession: props.secureSession,
      config,
      storage: window.localStorage,
    });
    setController(next);
    void next.ensureSession();
    return () => next.dispose();
  }, [
    config,
    props.api,
    props.connection,
    props.secureSession,
    props.sessions,
    route.active,
  ]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => QA_SESSION_IDLE_STATE),
    controller?.getSnapshot ?? (() => QA_SESSION_IDLE_STATE),
  );
  const listState = useSyncExternalStore(
    props.sessions.list.subscribe,
    props.sessions.list.getSnapshot,
    props.sessions.list.getSnapshot,
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
  const conversationTitle = titleFromMessages(state);
  const showSidebar = config.ui.showSessionList && controller !== undefined;
  const allowNewChat =
    config.session.policy !== "fixed" &&
    (!config.lockdown.enabled || config.lockdown.allowSessionReset);
  const chatRows = showSidebar
    ? buildChatRows(
        controller?.chatIds() ?? [],
        listState.byId,
        controller?.activeSessionId() ?? null,
      )
    : [];
  return (
    <main
      className="dsh-qa-surface"
      data-phase={state.phase}
      aria-label={config.branding.title}
      tabIndex={-1}
      onKeyDown={trapKeys}
    >
      {showSidebar ? (
        <QaSidebar
          rows={chatRows}
          title={config.branding.title}
          logoUrl={config.branding.logoUrl}
          stateKey={`${config.session.storageKey}:v1:${config.route.path}`}
          showNewChat={allowNewChat}
          busy={state.phase === "creating"}
          onSwitch={(sessionId) => void controller?.switchTo(sessionId)}
          onNewChat={() => void controller?.startDraft()}
          onDelete={(sessionId) => void controller?.deleteChat(sessionId)}
        />
      ) : null}
      <div className="dsh-qa-body">
        {config.ui.showHeader ? (
          <header className="dsh-qa-header">
            <div className="dsh-qa-header__inner">
              <div className="dsh-qa-header__title-row">
                {config.branding.logoUrl === null ? null : (
                  <img
                    className="dsh-qa-header__logo"
                    src={config.branding.logoUrl}
                    alt=""
                  />
                )}
                {conversationTitle === null ? null : (
                  <h1 title={conversationTitle}>{conversationTitle}</h1>
                )}
                <span className="dsh-qa-header__mode">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="3.25" r="1.5" />
                    <circle cx="4" cy="11.75" r="1.5" />
                    <circle cx="12" cy="11.75" r="1.5" />
                    <path d="M8 4.75v2.5m0 0H4v3m4-3h4v3" />
                  </svg>
                  {modeLabel(config.session.agentPreset)}
                </span>
                {config.ui.showReset &&
                config.session.policy !== "fixed" &&
                (!config.lockdown.enabled ||
                  config.lockdown.allowSessionReset) ? (
                  <button
                    type="button"
                    className="dsh-qa-header__reset"
                    disabled={
                      controller === undefined || state.phase === "creating"
                    }
                    onClick={() => void controller?.startDraft()}
                  >
                    Новый чат
                  </button>
                ) : null}
              </div>
              <div className="dsh-qa-header__tabs" aria-label="Вид беседы">
                <span aria-current="page">Чат</span>
              </div>
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
                {config.branding.subtitle === "" ? null : (
                  <p>{config.branding.subtitle}</p>
                )}
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
                    Повторить
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
            <QaComposer
              placeholder={config.branding.placeholder}
              quickQuestions={empty ? config.suggestedQuestions : []}
              canSend={state.canSend}
              canStop={state.canStop}
              running={state.phase === "running"}
              showStop={config.ui.showStop}
              status={status}
              onSend={(text) =>
                controller?.send(text) ?? Promise.resolve(false)
              }
              onStop={() => controller?.stop() ?? Promise.resolve()}
            />
          </div>
        </footer>
      </div>
    </main>
  );
}
