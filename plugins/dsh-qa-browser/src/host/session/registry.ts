/**
 * The pages one session has open.
 *
 * A tab is the runtime's own stable identity for a page, so the id is minted
 * here and the record is registered before anything is read from the page. The
 * observed history, the ref table and the revision counter live with it,
 * because all three answer a question about one page and no other.
 */
import { QaBrowserError } from "../../errors.js";
import type { ElementRefRecord } from "../../types.js";
import type { SessionKernel } from "./kernel.js";
import {
  MAX_HISTORY_ENTRIES,
  tabId,
  type SessionRecord,
  type TabRecord,
} from "./records.js";

export async function createTab(
  kernel: SessionKernel,
  record: SessionRecord,
): Promise<TabRecord> {
  const page = await record.context.newPage();
  const url = page.url();
  const tab: TabRecord = {
    id: tabId(),
    page,
    viewport: { ...kernel.options.config.viewport },
    history: { entries: [url], index: 0 },
    url,
    title: "",
    status: "ready",
    revision: 0,
    refs: new Map(),
    policyRefusals: [],
    queue: Promise.resolve(),
    disposers: [],
  };
  // Nothing may await between the page existing and it being findable: a
  // request the fresh page makes is attributed by looking its page up here,
  // and a refusal that arrives in between would be filed against no tab at
  // all. So the record goes in first and the title, which needs a round trip
  // to the page, is filled after it.
  record.tabs.set(tab.id, tab);
  tab.disposers.push(
    page.onChanged(() => {
      void refreshTab(kernel, tab, true);
    }),
    page.onClosed(() => onPageClosed(kernel, record, tab)),
  );
  // A page that cannot report its title is still a page; refusing to create
  // the tab over it would leave a running page with no way to see it.
  tab.title = await page.title().catch(() => "");
  return tab;
}

export function onPageClosed(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
): void {
  if (record.tabs.get(tab.id) !== tab) return;
  disposeTabListeners(tab);
  tab.status = "closed";
  record.tabs.delete(tab.id);
  if (record.selectedTabId === tab.id) {
    record.selectedTabId = record.tabs.keys().next().value ?? null;
  }
}

export async function refreshTab(
  kernel: SessionKernel,
  tab: TabRecord,
  bumpRevision: boolean,
): Promise<void> {
  if (tab.status === "closed") return;
  try {
    const url = tab.page.url();
    const title = await tab.page.title();
    // A page that moved without an action asking for it — a click, a form
    // post, a script redirect — is a navigation the chrome must be able to
    // walk back to.
    if (url !== tab.url) recordNavigation(tab, url, "new");
    tab.url = url;
    tab.title = title;
    if (bumpRevision) advanceRevision(tab);
    if (tab.status === "loading") tab.status = "ready";
  } catch {
    // A simultaneous close owns the final state.
  }
}

export function recordNavigation(
  tab: TabRecord,
  url: string,
  direction: "new" | "back" | "forward" | "reload",
): void {
  const history = tab.history;
  if (url === history.entries[history.index]) return;
  if (direction === "back") {
    history.index = Math.max(0, history.index - 1);
  } else if (direction === "forward") {
    history.index = Math.min(history.entries.length - 1, history.index + 1);
  }
  if (url !== history.entries[history.index]) {
    history.entries = history.entries.slice(0, history.index + 1);
    history.entries.push(url);
    history.index = history.entries.length - 1;
  }
  const excess = history.entries.length - MAX_HISTORY_ENTRIES;
  if (excess > 0) {
    history.entries = history.entries.slice(excess);
    history.index = Math.max(0, history.index - excess);
  }
}

/** The tab whose page dialled a request, or nothing when it has no page. */
export function tabForPage(
  record: SessionRecord,
  pageId: string | undefined,
): TabRecord | undefined {
  if (pageId === undefined) return undefined;
  for (const tab of record.tabs.values()) {
    if (tab.page.id === pageId) return tab;
  }
  return undefined;
}

export function requireRef(tab: TabRecord, ref: string): ElementRefRecord {
  const target = tab.refs.get(ref);
  if (target === undefined || target.revision !== tab.revision) {
    throw new QaBrowserError(
      "BROWSER_STALE_REF",
      "The page changed after this ref was created. Take a fresh browser_snapshot.",
    );
  }
  return target;
}

export function advanceRevision(tab: TabRecord): void {
  tab.revision += 1;
  tab.refs.clear();
}

export function disposeTabListeners(tab: TabRecord): void {
  for (const dispose of tab.disposers.splice(0).reverse()) dispose();
}
