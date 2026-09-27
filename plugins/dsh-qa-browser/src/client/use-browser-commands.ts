/**
 * Every way the operator can ask the runtime to do something.
 *
 * The panel is a remote control: each handler below resolves the tab it acts on,
 * puts one call on the wire through `runRemote`, and lets the poll bring the
 * picture back. Nothing here renders — the chrome is told what may be pressed by
 * `panel-view.ts`, and this module owns what happens when a control is used.
 */
import {
  useCallback,
  useMemo,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaSurfacePanelOwnerProps } from "@yadsh/dsh-qa-surface/client/panels";

import type { BrowserPanelRemote } from "./BrowserPanel.js";
import type { BrowserMenuItem } from "./chrome.js";
import type { PanelView } from "./panel-view.js";
import { keyboardShortcut } from "./panel-runtime.js";
import { normalizeAddress } from "./url.js";

export interface BrowserCommandsInput {
  readonly browserRemote: BrowserPanelRemote;
  readonly clientId: string;
  readonly coordinateInputEnabled: boolean;
  readonly owner: QaSurfacePanelOwnerProps;
  readonly refresh: (forceFrame: boolean) => Promise<void>;
  readonly runRemote: (
    call: () => Promise<RemoteResult<unknown>>,
  ) => Promise<void>;
  readonly setError: (message: string | null) => void;
  readonly view: PanelView;
}

export function useBrowserCommands({
  browserRemote,
  clientId,
  coordinateInputEnabled,
  owner,
  refresh,
  runRemote,
  setError,
  view,
}: BrowserCommandsInput) {
  const interactive = view.canDrive;
  const selected = view.selected;
  const sessionId = owner.sessionId;
  const token = owner.qaToken;
  const stage = useRef<HTMLDivElement | null>(null);
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stage.current = node;
  }, []);

  const takeControl = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() =>
      browserRemote.panelTakeControl(token, sessionId, clientId),
    );
  }, [clientId, browserRemote, runRemote, sessionId, token]);

  const releaseControl = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() =>
      browserRemote.panelReleaseControl(token, sessionId, clientId),
    );
  }, [clientId, browserRemote, runRemote, sessionId, token]);

  const openTab = useCallback(() => {
    if (sessionId === null) return;
    void runRemote(() => browserRemote.panelNewTab(token, sessionId, clientId));
  }, [clientId, browserRemote, runRemote, sessionId, token]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (sessionId === null) return;
      void runRemote(() =>
        browserRemote.panelCloseTab(token, sessionId, tabId, clientId),
      );
    },
    [clientId, browserRemote, runRemote, sessionId, token],
  );

  const selectTab = useCallback(
    (tabId: string) => {
      if (sessionId === null) return;
      void runRemote(() =>
        browserRemote.panelSelectTab(token, sessionId, tabId, clientId),
      );
    },
    [clientId, browserRemote, runRemote, sessionId, token],
  );

  const navigateTo = useCallback(
    (target: string) => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        browserRemote.panelNavigate(
          token,
          sessionId,
          selected.id,
          clientId,
          target,
        ),
      );
    },
    [clientId, browserRemote, runRemote, selected, sessionId, token],
  );

  const history = useCallback(
    (action: "back" | "forward" | "reload") => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        browserRemote.panelHistory(
          token,
          sessionId,
          selected.id,
          clientId,
          action,
        ),
      );
    },
    [clientId, browserRemote, runRemote, selected, sessionId, token],
  );

  const resize = useCallback(
    (width: number, height: number) => {
      if (sessionId === null || selected === undefined) return;
      void runRemote(() =>
        browserRemote.panelViewport(
          token,
          sessionId,
          selected.id,
          clientId,
          width,
          height,
        ),
      );
    },
    [clientId, browserRemote, runRemote, selected, sessionId, token],
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
        browserRemote.panelPointer(
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
      browserRemote,
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
          browserRemote.panelText(
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
          browserRemote.panelKey(token, sessionId, selected.id, clientId, key),
        );
      }
    },
    [
      clientId,
      interactive,
      browserRemote,
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
        browserRemote.panelText(token, sessionId, selected.id, clientId, text),
      );
    },
    [
      clientId,
      interactive,
      browserRemote,
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
        browserRemote.panelScroll(
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
      browserRemote,
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

  return {
    bindStage,
    closeTab,
    history,
    keyDown,
    menuItems,
    openTab,
    paste,
    pointer,
    releaseControl,
    resize,
    selectTab,
    submitAddress,
    takeControl,
    wheel,
  };
}
