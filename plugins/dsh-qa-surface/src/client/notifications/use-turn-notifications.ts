import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
  ResolvedQaSurfaceConfig,
} from "../../types.js";
import type { StorageLike } from "../types.js";
import {
  isPageFocused,
  planTurnNotice,
  raiseDesktopNotice,
  readNotificationPermission,
  requestNotificationPermission,
  type QaTurnNoticeItem,
} from "./notification-dispatcher.js";
import {
  readNotificationPrefs,
  resolveNoticeChannels,
  writeNotificationPrefs,
  type QaNotificationPrefs,
} from "./preferences.js";
import {
  settleTurnCompletions,
  type QaChatActivity,
  type QaTurnSighting,
} from "./turn-completion-source.js";

/** Lines the stack holds; an older one is dropped rather than pushed away. */
const MAX_NOTICES = 3;

export interface QaTurnNotificationsInput {
  /** The sidebar's own rows: this browser's chats with their running state. */
  readonly chats: readonly QaChatActivity[];
  readonly notifications: ResolvedQaSurfaceConfig["notifications"];
  readonly storage: StorageLike | undefined;
  readonly storageKey: string;
  /**
   * The signed-in reader's own channels and the write that changes them.
   * Absent on a stand without accounts, where the browser's own answer is the
   * only one there is to ask.
   */
  readonly account?: {
    readonly notifications: QaAccountNotifications;
    readonly onSave: (
      input: QaAccountNotificationsInput,
    ) => Promise<string | null>;
  };
  /**
   * The link is down, so the rows this page holds are the ones the drop left and
   * no run read among them is this reader's news. The flag goes back off with the
   * link, which is sooner than the host list is read again; the reading named
   * `stale` is what carries the rest of that gap.
   */
  readonly paused: boolean;
  readonly activeSessionId: string | null;
  readonly onSwitch: (sessionId: string) => void;
}

export interface QaTurnNotifications {
  readonly items: readonly QaTurnNoticeItem[];
  readonly onOpen: (sessionId: string) => void;
  readonly onDismiss: (key: string) => void;
  readonly onEnableDesktop?: () => void;
}

/**
 * Turn-completion notices for the chats this page owns: watch the sidebar's
 * rows, and when one of them stops running after this page watched that run
 * begin, say so in the channels the reader and the deployment allow.
 */
export function useQaTurnNotifications(
  input: QaTurnNotificationsInput,
): QaTurnNotifications {
  const {
    chats,
    notifications,
    storage,
    storageKey,
    account,
    paused,
    activeSessionId,
    onSwitch,
  } = input;
  const seen = useRef(new Map<string, QaTurnSighting>());
  const [items, setItems] = useState<readonly QaTurnNoticeItem[]>([]);
  const [prefs, setPrefs] = useState<QaNotificationPrefs>(() =>
    readNotificationPrefs(storage, storageKey),
  );
  // Memoized because the watcher below re-runs on any change to it, and a fresh
  // object per render would have it re-reading the chat list on every keystroke.
  const channels = useMemo(
    () => resolveNoticeChannels({ account: account?.notifications, prefs }),
    [account, prefs],
  );

  // The record is merged onto what this page last wrote, not onto the snapshot a
  // callback was built with: the browser answers its prompt on its own schedule,
  // and the page keeps rendering while it waits. What the ref carries is this
  // page's own writes — a second tab on the same key still overwrites them, and
  // settling the two against each other is not this ref's job.
  const written = useRef(prefs);
  const savePrefs = useCallback(
    (
      patch: (previous: QaNotificationPrefs) => Partial<QaNotificationPrefs>,
    ) => {
      const next = { ...written.current, ...patch(written.current) };
      written.current = next;
      setPrefs(next);
      writeNotificationPrefs(storage, storageKey, next);
    },
    [storage, storageKey],
  );

  useEffect(() => {
    const completions = settleTurnCompletions(seen.current, chats, { paused });
    if (completions.length === 0) return;
    const focused = isPageFocused();
    const permission = readNotificationPermission();
    const added: QaTurnNoticeItem[] = [];
    for (const completion of completions) {
      const planned = planTurnNotice(completion, {
        switches: notifications,
        channels,
        permission,
        focused,
        activeSessionId,
      });
      if (planned === null) continue;
      if (planned.desktop) raiseDesktopNotice(completion);
      if (planned.inApp) added.push(planned.item);
    }
    if (added.length === 0) return;
    setItems((previous) =>
      [...added.reverse(), ...previous].slice(0, MAX_NOTICES),
    );
  }, [channels, activeSessionId, chats, notifications, paused]);

  // Opening a chat by any other means is an answer to its notice.
  useEffect(() => {
    if (activeSessionId === null) return;
    setItems((previous) =>
      previous.some((item) => item.sessionId === activeSessionId)
        ? previous.filter((item) => item.sessionId !== activeSessionId)
        : previous,
    );
  }, [activeSessionId]);

  const open = useCallback(
    (sessionId: string) => {
      setItems((previous) =>
        previous.some((item) => item.sessionId === sessionId)
          ? previous.filter((item) => item.sessionId !== sessionId)
          : previous,
      );
      onSwitch(sessionId);
    },
    [onSwitch],
  );

  // The browser's answer about this origin and the reader's answer about the
  // channel are separate questions, and the switch is for whichever is still
  // open. An unanswered browser is asked by the click, and `osOffered` marks in
  // this browser's own store that it has been asked once. A granted browser has
  // no question left to ask, and its answer says nothing about the channel: the
  // reader's own answer is the record the click would have to change, and
  // anonymously this browser holds all of it — without the action, a reader who
  // allowed the prompt in another tab has no way in.
  //
  // Both branches then stand on the reader's answer, and both read it from
  // `channels.desktop`: the account's once there is one, this browser's
  // otherwise — the same record delivery is decided by. Where it says the channel
  // is on this page has nothing to offer, the browser having answered or not, and
  // that is what keeps an action labelled «включить» from writing `false` over a
  // channel the reader already switched on. A permission taken back in the address
  // bar is the reader's own doing and is put back there: the record still says on,
  // so delivery resumes the moment the origin is allowed again. A signed-in reader
  // has the browser asked in the settings section instead, which offers its button
  // whenever the browser still owes its answer.
  //
  // The browser's half is read per render and subscribed to nowhere, so what
  // brings the action back is the next line this page renders — not the reader
  // returning to the tab.
  const permission = readNotificationPermission();
  const unansweredBrowser =
    permission === "default" && !prefs.osOffered && !channels.desktop;
  const offered =
    notifications.enabled &&
    notifications.allowOs &&
    (unansweredBrowser ||
      (permission === "granted" && account === undefined && !channels.desktop));

  // Waving a notice off clears the stack. Where the offer under it is the
  // browser's own unanswered prompt it is also the answer to that prompt: the
  // mark exists so that no tab of this stand asks this browser the same question
  // twice. Where the origin is already granted the cross says nothing about the
  // channel, and the action returns with the next line — on a stand without
  // accounts it is the only way that channel has of being switched on.
  const dismiss = useCallback(
    (key: string) => {
      setItems((previous) => previous.filter((item) => item.key !== key));
      if (offered && unansweredBrowser) savePrefs(() => ({ osOffered: true }));
    },
    [offered, unansweredBrowser, savePrefs],
  );

  // Answering the offer writes the choice on both carriers that can hold it: on
  // the account once there is one, so it survives into another browser, and in
  // this browser's own store always — anonymously that copy is the whole record,
  // and signed in the account outranks it, see `resolveNoticeChannels`. The copy
  // here is what an anonymous form reads after a sign-out, consequence and all, and
  // «carries the switch a signed-in reader threw into the anonymous form» measures
  // it. What this browser marks for itself is that it stopped being asked, which is
  // a fact about this browser's question rather than about the person: a click that
  // found the origin already granted marks nothing, because there was no question
  // there to ask.
  const enableDesktop = useCallback(() => {
    const askedTheBrowser = readNotificationPermission() === "default";
    void requestNotificationPermission().then((answer) => {
      const granted = answer === "granted";
      savePrefs((previous) => ({
        osEnabled: granted,
        osOffered: previous.osOffered || askedTheBrowser,
      }));
      if (account === undefined) return;
      void account.onSave({
        inApp: account.notifications.inApp,
        desktop: granted,
      });
    });
  }, [account, savePrefs]);

  return {
    items,
    onOpen: open,
    onDismiss: dismiss,
    ...(offered ? { onEnableDesktop: enableDesktop } : {}),
  };
}
