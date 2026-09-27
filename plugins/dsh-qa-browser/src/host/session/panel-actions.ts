/**
 * What a person at the panel can do, and who is allowed to do it.
 *
 * The session has one driver at a time: the agent holds it by default, a panel
 * takes a lease, and the lease is renewed by heartbeats and expires on its own.
 * Every method here checks that lease before it touches a page, so the two
 * drivers never write to one page at once — and the refusals a human navigation
 * causes are shown in the panel's own error line rather than filed as a banner.
 */
import { QaBrowserError } from "../../errors.js";
import type {
  BrowserActionResult,
  BrowserHumanPointerRequest,
  BrowserNavigationRequest,
  BrowserSessionInfo,
  BrowserViewport,
} from "../../types.js";
import { clampViewport } from "../viewport.js";
import { ensureSession } from "./lifecycle.js";
import {
  createTab,
  disposeTabListeners,
  recordNavigation,
} from "./registry.js";
import { clearPolicyRefusals } from "./refusals.js";
import type { SessionKernel } from "./kernel.js";
import {
  actionResult,
  enqueueHuman,
  finishMutation,
  runHumanSessionMutation,
} from "./transport.js";

export function acquireHumanControl(
  kernel: SessionKernel,
  sessionId: string,
  clientId: string,
): BrowserSessionInfo {
  const record = kernel.requireSession(sessionId);
  const ownerId = kernel.validClientId(clientId);
  if (!kernel.options.config.humanControl.enabled) {
    throw new QaBrowserError(
      "BROWSER_HUMAN_CONTROL_DISABLED",
      "Human control is disabled for this Browser runtime.",
    );
  }
  const control = kernel.currentControl(record);
  if (control.owner === "human" && control.clientId !== ownerId) {
    throw new QaBrowserError(
      "BROWSER_HUMAN_CONTROL_ACTIVE",
      "Another Browser panel currently owns human control.",
    );
  }
  if (record.activeActions > 0 && control.owner === "agent") {
    throw new QaBrowserError(
      "BROWSER_ACTION_FAILED",
      "Wait for the current Browser action to finish, then take control again.",
    );
  }
  record.control = {
    owner: "human",
    clientId: ownerId,
    leaseExpiresAt: kernel.now() + kernel.options.config.humanControl.leaseMs,
  };
  kernel.touch(record);
  return kernel.sessionInfo(record);
}

export function heartbeatHumanControl(
  kernel: SessionKernel,
  sessionId: string,
  clientId: string,
): BrowserSessionInfo {
  const record = kernel.requireSession(sessionId);
  kernel.assertHumanControl(record, clientId);
  record.control = {
    owner: "human",
    clientId,
    leaseExpiresAt: kernel.now() + kernel.options.config.humanControl.leaseMs,
  };
  kernel.touch(record);
  return kernel.sessionInfo(record);
}

export function releaseHumanControl(
  kernel: SessionKernel,
  sessionId: string,
  clientId: string,
): BrowserSessionInfo {
  const record = kernel.requireSession(sessionId);
  const control = kernel.currentControl(record);
  if (control.owner === "agent") return kernel.sessionInfo(record);
  kernel.assertHumanControl(record, clientId);
  record.control = { owner: "agent", leaseExpiresAt: null };
  kernel.touch(record);
  return kernel.sessionInfo(record);
}

export async function humanSelectTab(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
): Promise<void> {
  const record = kernel.requireSession(sessionId);
  kernel.assertHumanControl(record, clientId);
  kernel.requireTab(record, id);
  record.selectedTabId = id;
  kernel.touch(record);
}

export async function humanNavigate(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  request: BrowserNavigationRequest,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    const from = tab.page.url();
    // The panel's own navigation answers with the refusal in its error line,
    // so it is not recorded as a banner too: the banner exists for the
    // refusals the person in front of the panel never sees.
    clearPolicyRefusals(record, tab);
    await kernel.options.policy.assertAllowed(request.url);
    const result = await tab.page.navigate(request);
    await kernel.options.policy.assertAllowed(result.url);
    tab.url = result.url;
    tab.title = result.title;
    recordNavigation(tab, result.url, "new");
    tab.status = "ready";
    return finishMutation(kernel, record, tab, "Human navigation completed.", {
      from,
      to: result.url,
    });
  });
}

export async function humanPointer(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  request: BrowserHumanPointerRequest,
): Promise<BrowserActionResult> {
  if (!kernel.options.config.capabilities.coordinateInput) {
    throw new QaBrowserError(
      "BROWSER_ACTION_FAILED",
      "Coordinate input is disabled for this Browser runtime.",
    );
  }
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    const x = viewportCoordinate(request.x, tab.viewport.width, "x");
    const y = viewportCoordinate(request.y, tab.viewport.height, "y");
    await tab.page.pointer({ ...request, x, y });
    return finishMutation(
      kernel,
      record,
      tab,
      `Human pointer ${request.action}.`,
    );
  });
}

export async function humanKey(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  key: string,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    await tab.page.press(key);
    return finishMutation(kernel, record, tab, `Human key ${key}.`);
  });
}

export async function humanText(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  text: string,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    await tab.page.insertText(text);
    return finishMutation(kernel, record, tab, "Human text inserted.");
  });
}

export async function humanScroll(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  deltaX: number,
  deltaY: number,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    await tab.page.wheel(finiteDelta(deltaX), finiteDelta(deltaY));
    return finishMutation(kernel, record, tab, "Human viewport scrolled.");
  });
}

/**
 * Open a tab for the human. The agent's own `newTab` asserts agent control,
 * so a panel that merely holds the lease cannot take a tab the agent may be
 * about to drive, and the tab limit stays the deployment's.
 */
export async function humanNewTab(
  kernel: SessionKernel,
  sessionId: string,
  clientId: string,
): Promise<BrowserActionResult> {
  await ensureSession(kernel, sessionId);
  const record = kernel.requireSession(sessionId);
  return runHumanSessionMutation(kernel, record, clientId, async () => {
    if (record.tabs.size >= kernel.options.config.session.maxTabs) {
      throw new QaBrowserError(
        "BROWSER_TOO_MANY_TABS",
        `Browser session reached its ${kernel.options.config.session.maxTabs}-tab limit.`,
      );
    }
    const tab = await createTab(kernel, record);
    record.selectedTabId = tab.id;
    kernel.touch(record);
    return actionResult(record, tab, "Human opened a tab.");
  });
}

export async function humanCloseTab(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  return runHumanSessionMutation(kernel, record, clientId, async () => {
    const tab = kernel.requireTab(record, id);
    const result = actionResult(record, tab, "Human closed the tab.");
    await tab.queue;
    disposeTabListeners(tab);
    tab.status = "closed";
    record.tabs.delete(id);
    if (record.selectedTabId === id) {
      record.selectedTabId = record.tabs.keys().next().value ?? null;
    }
    await tab.page.close();
    kernel.touch(record);
    return result;
  });
}

export async function humanHistory(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  action: "back" | "forward" | "reload",
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    const from = tab.page.url();
    const result = await tab.page.history(action);
    await kernel.options.policy.assertAllowed(result.url);
    tab.url = result.url;
    tab.title = result.title;
    recordNavigation(tab, result.url, action);
    clearPolicyRefusals(record, tab);
    return finishMutation(kernel, record, tab, `Human ${action} completed.`, {
      from,
      to: result.url,
    });
  });
}

/**
 * Resize the emulated viewport from the panel's device controls. The size is
 * clamped here rather than in the caller, so the panel and the agent's
 * `browser_viewport` tool share one set of deployment bounds.
 */
export async function humanSetViewport(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  clientId: string,
  request: Partial<BrowserViewport>,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueHuman(kernel, record, tab, clientId, async () => {
    const viewport = clampViewport(request, tab.viewport);
    await tab.page.setViewport(viewport);
    Object.assign(tab.viewport, viewport);
    return finishMutation(
      kernel,
      record,
      tab,
      `Human set the viewport to ${viewport.width}x${viewport.height}.`,
    );
  });
}

function viewportCoordinate(
  value: number,
  limit: number,
  axis: "x" | "y",
): number {
  if (!Number.isFinite(value) || value < 0 || value >= limit) {
    throw new QaBrowserError(
      "BROWSER_ACTION_FAILED",
      `Pointer ${axis} coordinate is outside the Browser viewport.`,
    );
  }
  return value;
}

function finiteDelta(value: number): number {
  if (!Number.isFinite(value)) {
    throw new QaBrowserError(
      "BROWSER_ACTION_FAILED",
      "Browser scroll delta must be finite.",
    );
  }
  return Math.min(10_000, Math.max(-10_000, value));
}
