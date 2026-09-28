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
  /** The bound chat reports `reconnecting` while the host link is down. */
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
 * rows, and when one of them stops running, say so in the channels the reader
 * and the deployment allow.
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
  const seen = useRef(new Map<string, boolean>());
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

  const savePrefs = useCallback(
    (next: QaNotificationPrefs) => {
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
  // open. An unanswered browser is asked by the click, and `osOffered` marks its
  // one prompt as spent. A granted browser has no prompt left to spend, and its
  // answer says nothing about the channel: the reader's own answer is
  // `osEnabled`, and anonymously this page is the whole record of that channel —
  // without the action a reader who allowed the prompt elsewhere has no way in.
  // A signed-in reader has the settings section for that instead.
  const permission = readNotificationPermission();
  const unansweredBrowser = permission === "default" && !prefs.osOffered;
  const offered =
    notifications.enabled &&
    notifications.allowOs &&
    (unansweredBrowser ||
      (permission === "granted" && account === undefined && !prefs.osEnabled));

  // Waving a notice off clears the stack. Where the offer under it is the
  // browser's own unanswered prompt it is also the answer to that prompt: the
  // mark exists so that one page never asks the same question twice. Where the
  // origin is already granted the cross says nothing about the channel, and the
  // action returns with the next line — on a stand without accounts it is the
  // only way that channel has of being switched on.
  const dismiss = useCallback(
    (key: string) => {
      setItems((previous) => previous.filter((item) => item.key !== key));
      if (offered && unansweredBrowser)
        savePrefs({ ...prefs, osOffered: true });
    },
    [offered, unansweredBrowser, prefs, savePrefs],
  );

  // Answering the offer writes the choice where it belongs: on the account once
  // there is one, so it survives into another browser, and in this browser's own
  // store otherwise. What this browser marks for itself is that its prompt has
  // been spent, which is a fact about the prompt rather than about the person:
  // a click that found the origin already granted spends nothing, so the mark
  // stays out of the way should the reader take the permission back later and
  // the page have to ask.
  const enableDesktop = useCallback(() => {
    const spendsThePrompt = readNotificationPermission() === "default";
    void requestNotificationPermission().then((answer) => {
      const granted = answer === "granted";
      savePrefs({
        ...prefs,
        osEnabled: granted,
        osOffered: prefs.osOffered || spendsThePrompt,
      });
      if (account === undefined) return;
      void account.onSave({
        inApp: account.notifications.inApp,
        desktop: granted,
      });
    });
  }, [account, prefs, savePrefs]);

  return {
    items,
    onOpen: open,
    onDismiss: dismiss,
    ...(offered ? { onEnableDesktop: enableDesktop } : {}),
  };
}
