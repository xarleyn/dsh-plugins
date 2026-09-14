import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  QaSurfacePanelDefinition,
  QaSurfacePanelOwnerProps,
  QaSurfacePanelPresentation,
} from "./contract.js";
import type { QaSurfacePanelRegistry } from "./registry.js";

export const QA_PANEL_DEFAULT_RATIO = 0.42;
export const QA_PANEL_MIN_PX = 320;
export const QA_CHAT_MIN_PX = 400;
export const QA_PANEL_MAX_RATIO = 0.7;
export const QA_PANEL_MOBILE_BREAKPOINT_PX = 768;
const RESIZER_PX = 5;

type RenderPanelSlot = PropsRenderSlots<"qa.surface.panel">["renderSlot"];

export function clampQaPanelWidth(width: number, available: number): number {
  const ratioMax = Math.max(QA_PANEL_MIN_PX, available * QA_PANEL_MAX_RATIO);
  const chatMax = Math.max(
    QA_PANEL_MIN_PX,
    available - QA_CHAT_MIN_PX - RESIZER_PX,
  );
  return Math.round(
    Math.min(Math.max(width, QA_PANEL_MIN_PX), ratioMax, chatMax),
  );
}

class PanelErrorBoundary extends Component<
  {
    readonly definition: QaSurfacePanelDefinition;
    readonly children: ReactNode;
  },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: true } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(
      `dsh-qa-surface: panel "${this.props.definition.kind}" failed`,
      error,
    );
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="dsh-qa-extension-panel__fallback" role="alert">
          Панель «{this.props.definition.kind}» недоступна (id:{" "}
          {this.props.definition.id}).
        </div>
      );
    }
    return this.props.children;
  }
}

function MissingPanel({
  definition,
}: {
  readonly definition: QaSurfacePanelDefinition;
}) {
  return (
    <div className="dsh-qa-extension-panel__fallback" role="status">
      Панель «{definition.kind}» недоступна (id: {definition.id}).
    </div>
  );
}

function PanelSlotBody({
  definition,
  owner,
  renderSlot,
}: {
  readonly definition: QaSurfacePanelDefinition;
  readonly owner: QaSurfacePanelOwnerProps;
  readonly renderSlot: RenderPanelSlot;
}) {
  return renderSlot("qa.surface.panel", owner, {
    entryKey: definition.id,
    fallback: <MissingPanel definition={definition} />,
  });
}

function panelTitle(definition: QaSurfacePanelDefinition): string {
  try {
    return definition.title() || definition.kind;
  } catch {
    return definition.kind;
  }
}

function useAvailableWidth(
  root: React.RefObject<HTMLElement>,
  activationKey: string | undefined,
): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    const read = () => setWidth(parent?.clientWidth || window.innerWidth);
    read();
    if (typeof ResizeObserver === "undefined" || parent == null) {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [activationKey, root]);
  return width;
}

export interface QaPanelHostProps {
  readonly panels: QaSurfacePanelRegistry;
  readonly sessionId: string | null;
  readonly renderSlot: RenderPanelSlot;
}

export function QaPanelHost({
  panels,
  sessionId,
  renderSlot,
}: QaPanelHostProps) {
  const snapshot = useSyncExternalStore(
    panels.subscribe,
    panels.getSnapshot,
    panels.getSnapshot,
  );
  const root = useRef<HTMLElement>(null);
  const mounted = useRef(new Set<string>());
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousActive = useRef<string | null>(null);
  const drag = useRef<
    | { readonly pointerId: number; readonly x: number; readonly width: number }
    | undefined
  >(undefined);
  const active = snapshot.definitions.find(
    (definition) => definition.kind === snapshot.activeKind,
  );
  const available = useAvailableWidth(root, active?.id);
  const presentation: QaSurfacePanelPresentation =
    available < QA_PANEL_MOBILE_BREAKPOINT_PX ? "fullscreen" : "side";
  const [width, setWidth] = useState(() =>
    clampQaPanelWidth(
      window.innerWidth * QA_PANEL_DEFAULT_RATIO,
      window.innerWidth,
    ),
  );

  if (active !== undefined) mounted.current.add(active.id);
  const liveIds = new Set(
    snapshot.definitions.map((definition) => definition.id),
  );
  for (const id of mounted.current) {
    if (!liveIds.has(id)) mounted.current.delete(id);
  }

  useEffect(() => {
    if (presentation === "side") {
      setWidth((current) =>
        clampQaPanelWidth(
          current === QA_PANEL_MIN_PX
            ? available * QA_PANEL_DEFAULT_RATIO
            : current,
          available,
        ),
      );
    }
  }, [available, presentation]);

  useLayoutEffect(() => {
    let restoreFrame: number | undefined;
    const wasActive = previousActive.current;
    if (wasActive === null && snapshot.activeKind !== null) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (wasActive !== null && snapshot.activeKind === null) {
      const target = previousFocus.current;
      restoreFrame = requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
        else
          document
            .querySelector<HTMLTextAreaElement>("#dsh-qa-prompt")
            ?.focus();
      });
      previousFocus.current = null;
    }
    previousActive.current = snapshot.activeKind;
    return () => {
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
    };
  }, [snapshot.activeKind]);

  useEffect(() => {
    if (!snapshot.focus || snapshot.activeKind === null) return;
    const frame = requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
      );
      (target ?? root.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.activeKind, snapshot.focus, snapshot.focusRequest]);

  useLayoutEffect(() => {
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (
      focused !== null &&
      focused.closest(".dsh-qa-extension-panel__body[hidden]") !== null
    ) {
      root.current?.focus();
    }
  }, [snapshot.activeKind]);

  if (active === undefined) return null;

  const resizeTo = (next: number) =>
    setWidth(clampQaPanelWidth(next, available));
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    resizeTo(start.width - (event.clientX - start.x));
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleSeparatorKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") resizeTo(width + 16);
    else if (event.key === "ArrowRight") resizeTo(width - 16);
    else if (event.key === "Home") resizeTo(QA_PANEL_MIN_PX);
    else if (event.key === "End") resizeTo(available * QA_PANEL_MAX_RATIO);
    else return;
    event.preventDefault();
  };

  return (
    <>
      {presentation === "side" ? (
        <div
          className="dsh-qa-extension-panel__resizer"
          role="separator"
          aria-label="Изменить ширину панели"
          aria-orientation="vertical"
          aria-valuemin={QA_PANEL_MIN_PX}
          aria-valuemax={clampQaPanelWidth(Number.POSITIVE_INFINITY, available)}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleSeparatorKey}
        />
      ) : null}
      <aside
        ref={root}
        className={`dsh-qa-extension-panel dsh-qa-extension-panel--${presentation}`}
        data-presentation={presentation}
        aria-label={`Панель: ${panelTitle(active)}`}
        tabIndex={-1}
        style={
          presentation === "side"
            ? ({ width: `${width}px` } as CSSProperties)
            : undefined
        }
        onKeyDown={(event) => {
          if (
            presentation === "fullscreen" &&
            event.key === "Escape" &&
            !event.defaultPrevented
          ) {
            event.stopPropagation();
            panels.close({ reason: "user" });
          }
        }}
      >
        <header className="dsh-qa-extension-panel__header">
          <h2>{panelTitle(active)}</h2>
          <button
            type="button"
            className="dsh-qa-extension-panel__close"
            aria-label={`Закрыть панель: ${panelTitle(active)}`}
            onClick={() => panels.close({ reason: "user" })}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </header>
        <div className="dsh-qa-extension-panel__bodies">
          {snapshot.definitions.map((definition) => {
            const visible = definition.kind === snapshot.activeKind;
            if (
              !visible &&
              (!definition.keepMounted || !mounted.current.has(definition.id))
            ) {
              return null;
            }
            const signal = panels.signal(definition.kind);
            if (signal === undefined) return null;
            const owner: QaSurfacePanelOwnerProps = {
              panelId: definition.id,
              panelKind: definition.kind,
              sessionId,
              visible,
              presentation,
              params: panels.params(definition.kind),
              actions: {
                close: () => panels.close({ reason: "extension" }),
                reveal: (options) =>
                  void panels.open(definition.kind, {
                    reason: "extension",
                    focus: options?.focus,
                  }),
              },
              signal,
            };
            return (
              <div
                key={definition.id}
                className="dsh-qa-extension-panel__body"
                hidden={!visible}
                aria-hidden={!visible}
              >
                <PanelErrorBoundary definition={definition}>
                  <PanelSlotBody
                    definition={definition}
                    owner={owner}
                    renderSlot={renderSlot}
                  />
                </PanelErrorBoundary>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
