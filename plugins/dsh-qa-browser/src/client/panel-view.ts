/**
 * Everything the panel draws, derived from the one state the Host polls.
 *
 * The container used to answer the same question twice — which tab is selected,
 * who holds the lease, which refusals to show, what the address field reads —
 * once in the render body and once in the code that fetched the frame, and the
 * two answers could disagree for a flush. Here each fact is computed once from
 * `BrowserPanelState`, so a component that renders the view cannot drift from
 * the component that decided to re-read it.
 *
 * Nothing in this module touches the wire or React: it is a function of the
 * polled state plus the two flags the operator's input owns (is the address
 * field being edited, and what has been typed into it).
 */
import type {
  BrowserPanelState,
  BrowserPanelTab,
  BrowserPolicyRefusal,
  BrowserSessionInfo,
} from "../types.js";

/** The viewport a panel still waiting for its first state draws. */
export const DEFAULT_VIEWPORT = { width: 1_280, height: 720 } as const;

export interface PanelViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * The control surface, as much of it as the state decides: what the entry
 * offers, whether it may be pressed, and which way it moves the lease. The
 * caller owns the callback, because only it knows the remote to call.
 */
export interface PanelControlEntry {
  /** "release" hands the page back to the agent. */
  readonly action: "take" | "release";
  readonly label: string;
  readonly disabled: boolean;
}

export interface PanelAddressDraft {
  /** True while the operator is typing in the address field. */
  readonly editing: boolean;
  /** What they typed; ignored unless `editing`. */
  readonly value: string | null;
}

export interface PanelView {
  readonly session: BrowserSessionInfo | null;
  /** The tab the session points at, or `undefined` until one exists. */
  readonly selected: BrowserPanelTab | undefined;
  /** True when *this* panel holds the human lease. */
  readonly ownsControl: boolean;
  /** True when this panel may drive the page at all. */
  readonly canDrive: boolean;
  /** Every refusal worth showing, page-scoped first, from one list. */
  readonly refusals: readonly BrowserPolicyRefusal[];
  /** The entry whose message explains the list, or `undefined` if none. */
  readonly leadRefusal: BrowserPolicyRefusal | undefined;
  /** The one-line headline, or `null` when nothing was refused. */
  readonly refusalHeadline: string | null;
  readonly statusLine: string;
  /** Who is driving, said the way the stage's chip says it. */
  readonly ownerLabel: string;
  /** What the address field shows: the draft while typing, the tab otherwise. */
  readonly address: string;
  readonly viewport: PanelViewport;
  readonly tabCount: number;
  /** The control entry inside the actions menu; always offered. */
  readonly menuControl: PanelControlEntry;
  /** The status-bar chip, which is absent when the deployment disables it. */
  readonly chipControl: PanelControlEntry | null;
  readonly emptyMessage: string;
}

/** The tab the session selected, or `undefined` when there is not one yet. */
export function selectedTab(
  state: BrowserPanelState | null,
): BrowserPanelTab | undefined {
  const selectedId = state?.session?.selectedTabId;
  if (selectedId === null || selectedId === undefined) return undefined;
  return state?.tabs.find((candidate) => candidate.id === selectedId);
}

/**
 * The lease and the content-input switch, which two different surfaces ask
 * about: the lease decides whether keys, text and scroll are forwarded, and the
 * switch decides whether pointer gestures may be forwarded at all.
 */
export function ownsLease(
  session: BrowserSessionInfo | null,
  clientId: string,
): boolean {
  return (
    session?.control.owner === "human" && session.control.clientId === clientId
  );
}

/**
 * The page's refusals, listed once.
 *
 * A refusal is recorded where it was seen: a request the page made belongs to
 * the tab, an entry with no page at all (a navigation the policy stopped before
 * Chromium opened anything) belongs to the session. Both are the same kind of
 * fact for the reader, so they are one list here rather than two concatenations
 * at the call site; the tab's entries come first because they explain the page
 * in front of the operator.
 */
export function collectRefusals(
  state: BrowserPanelState | null,
  selected: BrowserPanelTab | undefined,
): readonly BrowserPolicyRefusal[] {
  const fromTab = selected?.policyRefusals ?? [];
  const fromSession = state?.policyRefusals ?? [];
  if (fromSession.length === 0) return fromTab;
  if (fromTab.length === 0) return fromSession;
  return [...fromTab, ...fromSession];
}

/** The refusal whose own text is worth quoting, preferring the blocked page. */
export function leadRefusal(
  refusals: readonly BrowserPolicyRefusal[],
): BrowserPolicyRefusal | undefined {
  return refusals.find((entry) => entry.kind === "document") ?? refusals[0];
}

/**
 * What went wrong, in one line, before any host is named.
 *
 * A page that never opened and a page that opened without its assets are
 * different problems: the first is the model asking for somewhere the policy
 * will not go, the second is a page that looks broken and is not. The operator
 * decides which of them a host entry fixes from that sentence.
 */
export function refusalTitle(
  refusals: readonly BrowserPolicyRefusal[],
): string {
  const blocked = refusals.find((entry) => entry.kind === "document");
  if (blocked !== undefined) {
    return `Политика Browser не пускает на ${blocked.host}`;
  }
  return refusals.length === 1
    ? "Страница загрузилась не полностью: запрос заблокирован политикой Browser"
    : `Страница загрузилась не полностью: заблокировано запросов — ${refusals.length}`;
}

/** One refused destination, said the way a reader asks about it. */
export function refusalKindLabel(entry: BrowserPolicyRefusal): string {
  if (entry.kind === "document") return "переход";
  return entry.count === 1
    ? "запрос страницы"
    : `запросы страницы ×${entry.count}`;
}

/** The status line above the page, or the reason there is none. */
export function statusLine(
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

/**
 * The menu entry and the status-bar chip, from the same three facts: whether
 * the deployment enables human control, who holds the lease, and whether that
 * holder is this panel.
 *
 * They differ in one place on purpose. The chip is a readout, so it says who is
 * driving when the answer is not this panel; the menu entry keeps the action's
 * name, because that is where a person looks for one. Both are disabled while
 * another panel holds the lease, and both move it the same way.
 */
function controlEntries(
  state: BrowserPanelState | null,
  session: BrowserSessionInfo | null,
  ownsControl: boolean,
): {
  readonly menu: PanelControlEntry;
  readonly chip: PanelControlEntry | null;
} {
  const action = ownsControl ? "release" : "take";
  const label = ownsControl ? "Вернуть агенту" : "Взять управление";
  const anotherPanelDrives = !ownsControl && session?.control.owner === "human";
  const enabled = state?.humanControlEnabled === true;
  const menu: PanelControlEntry = {
    action,
    label,
    disabled: !enabled || anotherPanelDrives,
  };
  if (!enabled || session === null) return { menu, chip: null };
  return {
    menu,
    chip: {
      action,
      label: anotherPanelDrives ? "Занято другой панелью" : label,
      disabled: anotherPanelDrives,
    },
  };
}

/** Why the stage has no picture to show. */
function emptyMessage(
  session: BrowserSessionInfo | null,
  loading: boolean,
): string {
  if (session === null) {
    return "Browser ещё не запускался в этой сессии. Нажмите «Взять управление», чтобы открыть страницу самим.";
  }
  return loading
    ? "Получаем изображение…"
    : "Вкладка ещё не открывала страницу.";
}

/**
 * The address field's value.
 *
 * A draft wins while it is being edited, and the selected tab wins otherwise —
 * derived here, during the render, rather than copied into component state by
 * an effect. The effect version settled one flush after the frame it belonged
 * to, which is how a poll that changed the tab could leave the field showing
 * the previous page's URL (it flaked on CI before the test was loosened).
 */
export function addressValue(
  selected: BrowserPanelTab | undefined,
  draft: PanelAddressDraft,
): string {
  if (draft.editing && draft.value !== null) return draft.value;
  const url = selected?.url;
  return url === undefined || url === "" ? "about:blank" : url;
}

/**
 * The whole view: one pass over the polled state, with every decision the panel
 * makes about it. `clientId` is this panel's identity, which is what turns "a
 * human holds the lease" into "the operator at this panel holds it".
 */
export function panelView(
  state: BrowserPanelState | null,
  loading: boolean,
  clientId: string,
  draft: PanelAddressDraft,
): PanelView {
  const session = state?.session ?? null;
  const selected = selectedTab(state);
  const ownsControl = ownsLease(session, clientId);
  const refusals = collectRefusals(state, selected);
  const lead = leadRefusal(refusals);
  const controls = controlEntries(state, session, ownsControl);
  return {
    session,
    selected,
    ownsControl,
    canDrive: ownsControl && session !== null,
    refusals,
    leadRefusal: lead,
    refusalHeadline: lead === undefined ? null : refusalTitle(refusals),
    statusLine: statusLine(state, loading),
    ownerLabel:
      session?.control.owner === "human"
        ? "Управляет пользователь"
        : "Управляет агент",
    address: addressValue(selected, draft),
    viewport: selected?.viewport ?? DEFAULT_VIEWPORT,
    tabCount: state?.tabs.length ?? 0,
    menuControl: controls.menu,
    chipControl: controls.chip,
    emptyMessage: emptyMessage(session, loading),
  };
}
