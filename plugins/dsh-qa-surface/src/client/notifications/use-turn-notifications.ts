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

  // The offer is a single question per browser: asked when the desktop channel
  // is still allowed by the deployment, unanswered, and the browser has not
  // decided yet.
  const offered =
    notifications.enabled &&
    notifications.allowOs &&
    !prefs.osOffered &&
    readNotificationPermission() === "default";

  // Waving a notice off while the offer is on screen is the answer to the
  // offer too: it never returns to ask a second time.
  const dismiss = useCallback(
    (key: string) => {
      setItems((previous) => previous.filter((item) => item.key !== key));
      if (offered) savePrefs({ ...prefs, osOffered: true });
    },
    [offered, prefs, savePrefs],
  );

  // Answering the offer writes the choice where it belongs: on the account once
  // there is one, so it survives into another browser, and in this browser's own
  // store otherwise. The browser keeps its own copy either way — what it decides
  // is that the question has been asked here, which is a fact about this
  // browser's permission prompt rather than about the person.
  const enableDesktop = useCallback(() => {
    void requestNotificationPermission().then((permission) => {
      const granted = permission === "granted";
      savePrefs({ ...prefs, osEnabled: granted, osOffered: true });
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
