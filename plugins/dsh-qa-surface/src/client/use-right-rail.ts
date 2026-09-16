import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { QaSource, QaTurnSources } from "../types.js";
import type {
  QaDrawerCompleteness,
  QaRailTab,
} from "./use-session-ui-state.js";

/**
 * The rail-related slice of `useSessionUiState`, declared structurally so the
 * controller consumes exactly what it drives and the rest of the chat-local
 * state (draft text, variant offsets, the turn mark) stays with the surface.
 */
export interface QaRightRailState {
  readonly railOpen: boolean;
  readonly setRailOpen: Dispatch<SetStateAction<boolean>>;
  readonly railTab: QaRailTab;
  readonly setRailTab: Dispatch<SetStateAction<QaRailTab>>;
  readonly drawerSources: readonly QaSource[] | null;
  readonly setDrawerSources: Dispatch<
    SetStateAction<readonly QaSource[] | null>
  >;
  readonly drawerCompleteness: QaDrawerCompleteness | null;
  readonly setDrawerCompleteness: Dispatch<
    SetStateAction<QaDrawerCompleteness | null>
  >;
  readonly drawerDetail: QaSource | null;
  readonly setDrawerDetail: Dispatch<SetStateAction<QaSource | null>>;
  readonly setAgentsOpen: Dispatch<SetStateAction<boolean>>;
}

/** What QaSurface reads and hands to the rail, the panels and the header. */
export interface QaRightRailFacade {
  readonly railOpen: boolean;
  readonly railTab: QaRailTab;
  /** Message-scoped source pin, or null for the whole-chat list. */
  readonly drawerSources: readonly QaSource[] | null;
  readonly drawerCompleteness: QaDrawerCompleteness | null;
  readonly drawerDetail: QaSource | null;
  /** A message footer's sources control: pin the message-scoped subset. */
  readonly openSources: (
    sources: readonly QaSource[],
    complete: boolean,
    incompleteOrigins: QaTurnSources["incompleteOrigins"],
  ) => void;
  /** A message's source chip: show that source's detail instead of a list. */
  readonly openSourceDetail: (source: QaSource) => void;
  /** Back to the whole-chat source list, dropping the pin. */
  readonly showAllSources: () => void;
  /** Closing the rail also discards the pinned sources, as the drawer did. */
  readonly close: () => void;
  /**
   * The header buttons: a second click on the active tab's button closes the
   * rail; opening the sources tab shows the full list, dropping any pin.
   */
  readonly openTab: (tab: QaRailTab) => void;
  /** The rail strip's plain tab switch. */
  readonly selectTab: (tab: QaRailTab) => void;
  /** The agents drawer and the rail are mutually exclusive; this is its side. */
  readonly toggleAgents: () => void;
}

/**
 * Right-rail controller over the chat-local drawer state: every transition
 * between the whole-chat list, a pinned message subset and a single source's
 * detail lives here, so the surface only wires controls to intents. The
 * callbacks stay referentially stable — they close over `useState` setters,
 * whose identities never change.
 */
export function useRightRail(ui: QaRightRailState): QaRightRailFacade {
  const {
    railOpen,
    railTab,
    setRailOpen,
    setRailTab,
    setDrawerSources,
    setDrawerCompleteness,
    setDrawerDetail,
    setAgentsOpen,
  } = ui;

  const openSources = useCallback(
    (
      sources: readonly QaSource[],
      complete: boolean,
      incompleteOrigins: QaTurnSources["incompleteOrigins"],
    ) => {
      setDrawerSources(sources);
      setDrawerCompleteness({
        complete,
        ...(incompleteOrigins === undefined ? {} : { incompleteOrigins }),
      });
      setDrawerDetail(null);
      setRailOpen(true);
      setRailTab("sources");
      setAgentsOpen(false);
    },
    [
      setAgentsOpen,
      setDrawerCompleteness,
      setDrawerDetail,
      setDrawerSources,
      setRailOpen,
      setRailTab,
    ],
  );

  const openSourceDetail = useCallback(
    (source: QaSource) => {
      setDrawerSources(null);
      setDrawerCompleteness(null);
      setDrawerDetail(source);
      setRailOpen(true);
      setRailTab("sources");
      setAgentsOpen(false);
    },
    [
      setAgentsOpen,
      setDrawerCompleteness,
      setDrawerDetail,
      setDrawerSources,
      setRailOpen,
      setRailTab,
    ],
  );

  const showAllSources = useCallback(() => {
    setDrawerSources(null);
    setDrawerCompleteness(null);
    setDrawerDetail(null);
  }, [setDrawerCompleteness, setDrawerDetail, setDrawerSources]);

  const close = useCallback(() => {
    setRailOpen(false);
    setDrawerSources(null);
    setDrawerCompleteness(null);
    setDrawerDetail(null);
  }, [setDrawerCompleteness, setDrawerDetail, setDrawerSources, setRailOpen]);

  const openTab = useCallback(
    (tab: QaRailTab) => {
      if (railOpen && railTab === tab) {
        close();
        return;
      }
      setAgentsOpen(false);
      setRailOpen(true);
      setRailTab(tab);
      if (tab === "sources") showAllSources();
    },
    [
      close,
      railOpen,
      railTab,
      setAgentsOpen,
      setRailOpen,
      setRailTab,
      showAllSources,
    ],
  );

  const selectTab = useCallback(
    (tab: QaRailTab) => {
      setRailTab(tab);
    },
    [setRailTab],
  );

  const toggleAgents = useCallback(() => {
    setAgentsOpen((open) => !open);
    setRailOpen(false);
  }, [setAgentsOpen, setRailOpen]);

  return {
    railOpen,
    railTab,
    drawerSources: ui.drawerSources,
    drawerCompleteness: ui.drawerCompleteness,
    drawerDetail: ui.drawerDetail,
    openSources,
    openSourceDetail,
    showAllSources,
    close,
    openTab,
    selectTab,
    toggleAgents,
  };
}
