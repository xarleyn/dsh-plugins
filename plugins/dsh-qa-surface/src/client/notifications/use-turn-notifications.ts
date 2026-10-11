import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
  ResolvedQaSurfaceConfig,
} from "../../types.js";
import type { StorageLike } from "../types.js";
import {
  QaDesktopNotices,
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
  scopeNoticesToOwnChats,
  settleTurnCompletions,
  type QaChatActivity,
  type QaTurnSighting,
} from "./turn-completion-source.js";

/** Lines the stack holds; an older one is dropped rather than pushed away. */
const MAX_NOTICES = 3;
const NO_NOTICES: readonly QaTurnNoticeItem[] = Object.freeze([]);
interface NoticeQueue {
  readonly principal: string | null;
  readonly epoch: object;
  readonly items: readonly QaTurnNoticeItem[];
}

export interface QaTurnNotificationsInput {
  /** The sidebar's rows: this browser's chats with their running state. */
  readonly chats: readonly QaChatActivity[];
  /** Authenticated identity, null behind the gate or with accounts disabled. */
  readonly principal: string | null;
  /** False while the controller or host list is still restoring. */
  readonly chatsReady?: boolean;
  /**
   * The chats this account owns outright, which is narrower than the rows: an
   * admin's shared history lists chats it only reads, and the turn of such a
   * chat is that other account's business. Absent where there is no account to
   * be narrower than — a stand without accounts, whose rows are the browser's
   * own index.
   */
  readonly ownChatIds?: readonly string[];
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
   * The link is down, so no run read among these rows is this reader's news. The
   * flag says nothing about the rows: it goes back off with the link, while the
   * host list is re-read after it and unawaited, so the reading named `stale` is
   * what carries the gap over a live frame whose row has not moved since.
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
 * Turn-completion notices for the chats this reader owns. Of the rows the
 * sidebar shows, only the ones this account owns outright are watched, and when
 * one of them stops running after this page watched that run begin, the reader
 * is told in the channels they and the deployment allow.
 */
export function useQaTurnNotifications(
  input: QaTurnNotificationsInput,
): QaTurnNotifications {
  const {
    chats,
    principal,
    chatsReady = true,
    ownChatIds,
    notifications,
    storage,
    storageKey,
    account,
    paused,
    activeSessionId,
    onSwitch,
  } = input;
  const seen = useRef(new Map<string, QaTurnSighting>());
  const [queue, setQueue] = useState<NoticeQueue>(() => ({
    principal,
    epoch: {},
    items: NO_NOTICES,
  }));
  // Adjust before commit: an effect alone would expose the previous reader's
  // titles for the first committed frame of the replacement account.
  if (queue.principal !== principal) {
    setQueue({ principal, epoch: {}, items: NO_NOTICES });
  }
  const epoch = queue.epoch;
  const [desktopNotices] = useState(() => new QaDesktopNotices());
  const live = useRef<{
    epoch: object;
    ids: ReadonlySet<string>;
    onSwitch: (sessionId: string) => void;
    enabled: boolean;
    desktop: boolean;
  }>();
  const [prefs, setPrefs] = useState<QaNotificationPrefs>(() =>
    readNotificationPrefs(storage, storageKey),
  );
  // Memoized because the watcher below re-runs on any change to it, and a fresh
  // object per render would have it re-reading the chat list on every keystroke.
  const channels = useMemo(
    () => resolveNoticeChannels({ account: account?.notifications, prefs }),
    [account, prefs],
  );
  // Also memoized for the watcher's sake: the rows are the sidebar's, so a
  // render that changed nothing about them must not read the list again.
  const ownedChats = useMemo(
    () => scopeNoticesToOwnChats(chats, ownChatIds),
    [chats, ownChatIds],
  );

  const savePrefs = useCallback(
    (next: QaNotificationPrefs) => {
      setPrefs(next);
      writeNotificationPrefs(storage, storageKey, next);
    },
    [storage, storageKey],
  );

  const ownedIds = useMemo(
    () => new Set(ownedChats.map((chat) => chat.id)),
    [ownedChats],
  );
  const authoritative = chatsReady && !paused;
  const items = useMemo(
    () =>
      queue.principal !== principal
        ? NO_NOTICES
        : authoritative &&
            queue.items.some((item) => !ownedIds.has(item.sessionId))
          ? queue.items.filter((item) => ownedIds.has(item.sessionId))
          : queue.items,
    [queue, principal, authoritative, ownedIds],
  );
  const desktopAllowed =
    notifications.enabled && notifications.allowOs && channels.desktop;

  useLayoutEffect(() => {
    seen.current.clear();
    return () => {
      live.current = undefined;
      desktopNotices.close();
    };
  }, [epoch, desktopNotices]);

  useLayoutEffect(() => {
    live.current = {
      epoch,
      ids: ownedIds,
      onSwitch,
      enabled: notifications.enabled,
      desktop: desktopAllowed,
    };
    if (!desktopAllowed) desktopNotices.close();
    if (authoritative) desktopNotices.keep(ownedIds);
  }, [
    epoch,
    ownedIds,
    onSwitch,
    notifications.enabled,
    desktopAllowed,
    desktopNotices,
    authoritative,
  ]);

  const rewrite = useCallback(
    (
      next: (
        previous: readonly QaTurnNoticeItem[],
      ) => readonly QaTurnNoticeItem[],
    ) => {
      if (live.current?.epoch !== epoch) return;
      setQueue((previous) => {
        if (previous.epoch !== epoch) return previous;
        const items = next(previous.items);
        return items === previous.items ? previous : { ...previous, items };
      });
    },
    [epoch],
  );

  const open = useCallback(
    (sessionId: string) => {
      const page = live.current;
      if (page?.epoch !== epoch || !page.enabled || !page.ids.has(sessionId))
        return;
      rewrite((previous) =>
        previous.filter((item) => item.sessionId !== sessionId),
      );
      desktopNotices.close(sessionId);
      page.onSwitch(sessionId);
    },
    [epoch, rewrite, desktopNotices],
  );

  useEffect(() => {
    if (authoritative)
      rewrite((previous) =>
        previous.some((item) => !ownedIds.has(item.sessionId))
          ? previous.filter((item) => ownedIds.has(item.sessionId))
          : previous,
      );
  }, [authoritative, ownedIds, rewrite]);

  useEffect(() => {
    const completions = settleTurnCompletions(seen.current, ownedChats, {
      paused,
    });
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
      if (planned.desktop)
        raiseDesktopNotice(
          completion,
          (sessionId) => {
            if (live.current?.desktop) open(sessionId);
          },
          desktopNotices,
        );
      if (planned.inApp) added.push(planned.item);
    }
    if (added.length === 0) return;
    const newestFirst = added.reverse();
    rewrite((previous) => [...newestFirst, ...previous].slice(0, MAX_NOTICES));
  }, [
    channels,
    activeSessionId,
    ownedChats,
    notifications,
    paused,
    epoch,
    rewrite,
    open,
    desktopNotices,
  ]);

  // Opening a chat by any other means is an answer to its notice.
  useEffect(() => {
    if (activeSessionId === null) return;
    rewrite((previous) =>
      previous.some((item) => item.sessionId === activeSessionId)
        ? previous.filter((item) => item.sessionId !== activeSessionId)
        : previous,
    );
    desktopNotices.close(activeSessionId);
  }, [activeSessionId, rewrite, desktopNotices]);

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
      if (live.current?.epoch !== epoch) return;
      rewrite((previous) => previous.filter((item) => item.key !== key));
      if (offered) savePrefs({ ...prefs, osOffered: true });
    },
    [epoch, offered, prefs, rewrite, savePrefs],
  );

  // Answering the offer writes the choice where it belongs: on the account once
  // there is one, so it survives into another browser, and in this browser's own
  // store otherwise. The browser keeps its own copy either way — what it decides
  // is that the question has been asked here, which is a fact about this
  // browser's permission prompt rather than about the person.
  const enableDesktop = useCallback(() => {
    if (live.current?.epoch !== epoch) return;
    void requestNotificationPermission().then((permission) => {
      if (live.current?.epoch !== epoch || !live.current.enabled) return;
      const granted = permission === "granted";
      savePrefs({ ...prefs, osEnabled: granted, osOffered: true });
      if (account === undefined) return;
      void account.onSave({
        inApp: account.notifications.inApp,
        desktop: granted,
      });
    });
  }, [account, epoch, prefs, savePrefs]);

  return {
    items,
    onOpen: open,
    onDismiss: dismiss,
    ...(offered ? { onEnableDesktop: enableDesktop } : {}),
  };
}
