/**
 * The browser and the contexts inside it.
 *
 * One DSH session is one isolated context: the provider is started on the first
 * request for a session, the context is dialled through the policy gate from
 * then on, and the context is what a close, an idle eviction or a crash of the
 * browser leaves nothing of behind.
 */
import { QaBrowserError } from "../../errors.js";
import type { BrowserSessionInfo } from "../../types.js";
import type { SessionKernel } from "./kernel.js";
import { createTab, disposeTabListeners, tabForPage } from "./registry.js";
import { notePolicyRefusal } from "./refusals.js";
import type { SessionRecord } from "./records.js";

export async function ensureSession(
  kernel: SessionKernel,
  sessionId: string,
): Promise<BrowserSessionInfo> {
  kernel.assertAvailable();
  const id = kernel.validSessionId(sessionId);
  const existing = kernel.sessions.get(id);
  if (existing !== undefined && kernel.isLost(existing)) {
    kernel.sessions.delete(id);
  } else if (existing !== undefined && existing.status !== "starting") {
    kernel.touch(existing);
    return kernel.sessionInfo(existing);
  }
  // A record that is still starting is one a creation is building — it is
  // registered early so refusals can find it — so this caller joins that
  // creation instead of answering with a session that has no tab yet.

  let pending = kernel.creating.get(id);
  if (pending === undefined) {
    pending = createSession(kernel, id);
    kernel.creating.set(id, pending);
  }
  try {
    return kernel.sessionInfo(await pending);
  } finally {
    if (kernel.creating.get(id) === pending) kernel.creating.delete(id);
  }
}

export function getSession(
  kernel: SessionKernel,
  sessionId: string,
): BrowserSessionInfo | null {
  const record = kernel.sessions.get(sessionId);
  return record === undefined ? null : kernel.sessionInfo(record);
}

export async function closeSession(
  kernel: SessionKernel,
  sessionId: string,
): Promise<void> {
  const pending = kernel.creating.get(sessionId);
  if (pending !== undefined) await pending.catch(() => undefined);
  const record = kernel.sessions.get(sessionId);
  if (record === undefined) return;
  kernel.sessions.delete(sessionId);
  record.status = "closed";
  for (const tab of record.tabs.values()) disposeTabListeners(tab);
  record.tabs.clear();
  record.selectedTabId = null;
  await kernel.options.provider.closeContext(record.context.id);
  kernel.logger.info("browser.session-closed", { sessionId });
}

export async function closeIdleSessions(
  kernel: SessionKernel,
  now = kernel.now(),
): Promise<number> {
  const expired = [...kernel.sessions.values()].filter(
    (record) =>
      record.activeActions === 0 &&
      kernel.currentControl(record).owner === "agent" &&
      now - record.lastActivityAt >=
        kernel.options.config.runtime.idleTimeoutMs,
  );
  await Promise.all(
    expired.map((record) => closeSession(kernel, record.sessionId)),
  );
  if (expired.length > 0) {
    kernel.logger.info("browser.contexts-evicted", { count: expired.length });
  }
  return expired.length;
}

export function handleProviderCrash(kernel: SessionKernel, error: Error): void {
  const lost =
    error instanceof QaBrowserError && error.code === "BROWSER_CONNECTION_LOST";
  for (const record of kernel.sessions.values()) {
    record.status = lost ? "disconnected" : "crashed";
    record.selectedTabId = null;
    for (const tab of record.tabs.values()) {
      disposeTabListeners(tab);
      tab.status = "closed";
    }
    record.tabs.clear();
  }
  kernel.logger.error(lost ? "browser.connection-lost" : "browser.crashed", {
    error: error.message,
  });
}

async function createSession(
  kernel: SessionKernel,
  sessionId: string,
): Promise<SessionRecord> {
  await kernel.options.provider.start(kernel.options.config.runtime);
  const now = kernel.now();
  const context = await kernel.options.provider.createContext({
    sessionId,
    viewport: kernel.options.config.viewport,
    actionTimeoutMs: kernel.options.config.runtime.actionTimeoutMs,
    navigationTimeoutMs: kernel.options.config.runtime.navigationTimeoutMs,
    validateRequest: async (url, request) => {
      // The provider asks this before every request it dials — the document,
      // a redirect, an asset, an API call — so a destination it refuses is
      // recorded here rather than surfacing only inside Chromium as a
      // request that never completed. The page it names is the tab the
      // operator is looking at when it fails.
      try {
        await kernel.options.policy.assertAllowed(url);
        await kernel.options.policy.assertUnchangedResolution(url);
      } catch (error) {
        const record = kernel.sessions.get(sessionId);
        notePolicyRefusal(
          kernel,
          record,
          record === undefined ? undefined : tabForPage(record, request.pageId),
          url,
          request.kind,
          error,
        );
        throw error;
      }
    },
  });
  const record: SessionRecord = {
    sessionId,
    context,
    tabs: new Map(),
    status: "starting",
    selectedTabId: null,
    createdAt: now,
    lastActivityAt: now,
    activeActions: 0,
    policyRefusals: [],
    control: { owner: "agent", leaseExpiresAt: null },
  };
  // Registered before the first tab exists, because the context is already
  // dialling: the page this session is about to open can be refused while it
  // is being built, and a refusal nobody can look up is a refusal the panel
  // never shows. The window is the same reason the tab is registered before
  // its title is read.
  kernel.sessions.set(sessionId, record);
  try {
    const tab = await createTab(kernel, record);
    record.selectedTabId = tab.id;
    record.status = "ready";
    kernel.logger.info("browser.session-created", {
      sessionId,
      contextId: context.id,
    });
    return record;
  } catch (error) {
    // A session that could not open its first tab is not a session: leaving
    // it in the map would answer the panel with a dead browser.
    kernel.sessions.delete(sessionId);
    await kernel.options.provider
      .closeContext(context.id)
      .catch(() => undefined);
    throw error;
  }
}
