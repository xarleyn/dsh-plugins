import { randomUUID } from "node:crypto";

import type {
  BrowserPolicyRefusal,
  BrowserSessionInfo,
  BrowserTabInfo,
  BrowserViewport,
  ElementRefRecord,
} from "../../types.js";
import type {
  BrowserContextHandle,
  BrowserPageHandle,
} from "../providers/contract.js";

/**
 * The URLs one tab has been watched visiting, with the position it currently
 * sits at. Chromium exposes no "is there a history entry behind this page"
 * question, so the runtime keeps what it observed: every navigation it performs
 * or sees committed is an entry, which is also what a browser's own back and
 * forward buttons act on. A page the browser visited without the runtime
 * watching (a redirect that replaced an entry) is recorded as a fresh entry
 * instead of guessing, so the arrows never claim a page that is not there.
 */
export interface TabHistory {
  entries: string[];
  index: number;
}

export interface TabRecord {
  readonly id: string;
  readonly page: BrowserPageHandle;
  readonly viewport: BrowserViewport;
  readonly history: TabHistory;
  url: string;
  title: string;
  status: BrowserTabInfo["status"];
  revision: number;
  readonly refs: Map<string, ElementRefRecord>;
  /**
   * What the policy refused for the page this tab is showing. It lives here
   * rather than on the session because the panel explains the page in front of
   * the operator, and a second tab failing silently is its own problem.
   */
  policyRefusals: BrowserPolicyRefusal[];
  queue: Promise<void>;
  disposers: (() => void)[];
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly context: BrowserContextHandle;
  readonly tabs: Map<string, TabRecord>;
  status: BrowserSessionInfo["status"];
  selectedTabId: string | null;
  readonly createdAt: number;
  lastActivityAt: number;
  activeActions: number;
  /**
   * Refusals that belong to no tab: a request the context dialled without a
   * page behind it, such as one a service worker makes. Everything else is
   * kept on the tab whose page made the request.
   */
  policyRefusals: BrowserPolicyRefusal[];
  control:
    | { owner: "agent"; leaseExpiresAt: null }
    | { owner: "human"; clientId: string; leaseExpiresAt: number };
}

/**
 * Destinations one page can report before the list stops growing. A page that
 * fails on more hosts than this is past explaining with a list: the first ones
 * are the ones the operator would act on anyway, and a stable list beats one
 * whose entries shuffle as the page keeps failing.
 */
export const MAX_POLICY_REFUSALS = 8;

/** How many observed entries one tab remembers; the oldest fall off the back. */
export const MAX_HISTORY_ENTRIES = 50;

/**
 * The host a refused request aimed at, for the operator's message. A URL the
 * policy could not parse at all has no host, so the raw string is trimmed to
 * something a panel can render instead of being dropped.
 */
export function refusalHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return url.slice(0, 200);
  }
}

export function tabId(): string {
  return `tab_${randomUUID().replaceAll("-", "")}`;
}
