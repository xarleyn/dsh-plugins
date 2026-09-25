import { browserErrorMessage } from "../../errors.js";
import type {
  BrowserActionResult,
  BrowserFormValue,
  BrowserHumanPointerRequest,
  BrowserNavigationRequest,
  BrowserPanelTab,
  BrowserPolicyRefusal,
  BrowserSessionInfo,
  BrowserSnapshot,
  BrowserSnapshotOptions,
  BrowserTabInfo,
  BrowserViewport,
  BrowserWaitRequest,
} from "../../types.js";
import * as agentActions from "./agent-actions.js";
import {
  SessionKernel,
  type QaBrowserSessionManagerOptions,
} from "./kernel.js";
import * as lifecycle from "./lifecycle.js";
import * as panelActions from "./panel-actions.js";
import * as refusals from "./refusals.js";

/**
 * Owns isolated contexts, stable tab ids, per-tab mutation queues and cleanup.
 *
 * The state itself is the kernel; what this class adds is the runtime around
 * it — the crash subscription and the idle sweep it cannot be reduced to
 * either of the two — and the one method per call the host service makes. The
 * work is divided by what it touches: the browser's lifecycle, the pages a
 * session has open, the queue an action travels on, and the refusals the
 * operator is shown.
 */
export class QaBrowserSessionManager {
  private readonly kernel: SessionKernel;
  private readonly crashDisposer: () => void;
  private readonly idleTimer: NodeJS.Timeout | undefined;

  constructor(options: QaBrowserSessionManagerOptions) {
    const kernel = new SessionKernel(options);
    this.kernel = kernel;
    this.crashDisposer = options.provider.onCrash((error) =>
      lifecycle.handleProviderCrash(kernel, error),
    );
    if (options.startIdleTimer === false) {
      this.idleTimer = undefined;
    } else {
      const interval = Math.min(
        60_000,
        Math.max(1_000, options.config.runtime.idleTimeoutMs / 2),
      );
      this.idleTimer = setInterval(() => {
        void this.closeIdleSessions().catch((error: unknown) => {
          kernel.logger.warn("browser.idle-cleanup-failed", {
            error: browserErrorMessage(error),
          });
        });
      }, interval);
      this.idleTimer.unref?.();
    }
  }

  ensureSession(sessionId: string): Promise<BrowserSessionInfo> {
    return lifecycle.ensureSession(this.kernel, sessionId);
  }

  getSession(sessionId: string): BrowserSessionInfo | null {
    return lifecycle.getSession(this.kernel, sessionId);
  }

  closeSession(sessionId: string): Promise<void> {
    return lifecycle.closeSession(this.kernel, sessionId);
  }

  policyRefusals(sessionId: string): readonly BrowserPolicyRefusal[] {
    return refusals.sessionPolicyRefusals(this.kernel, sessionId);
  }

  listTabs(sessionId: string): Promise<readonly BrowserTabInfo[]> {
    return agentActions.listTabs(this.kernel, sessionId);
  }

  listPanelTabs(sessionId: string): Promise<readonly BrowserPanelTab[]> {
    return agentActions.listPanelTabs(this.kernel, sessionId);
  }

  newTab(sessionId: string): Promise<BrowserTabInfo> {
    return agentActions.newTab(this.kernel, sessionId);
  }

  closeTab(sessionId: string, id: string): Promise<void> {
    return agentActions.closeTab(this.kernel, sessionId, id);
  }

  selectTab(sessionId: string, id: string): Promise<void> {
    return agentActions.selectTab(this.kernel, sessionId, id);
  }

  navigate(
    sessionId: string,
    id: string,
    request: BrowserNavigationRequest,
  ): Promise<BrowserActionResult> {
    return agentActions.navigate(this.kernel, sessionId, id, request);
  }

  snapshot(
    sessionId: string,
    id: string,
    options: BrowserSnapshotOptions = {},
  ): Promise<BrowserSnapshot> {
    return agentActions.snapshot(this.kernel, sessionId, id, options);
  }

  click(
    sessionId: string,
    id: string,
    ref: string,
    options: {
      readonly button?: "left" | "middle" | "right";
      readonly clickCount?: 1 | 2;
    } = {},
  ): Promise<BrowserActionResult> {
    return agentActions.click(this.kernel, sessionId, id, ref, options);
  }

  type(
    sessionId: string,
    id: string,
    ref: string,
    text: string,
    options: { readonly clear?: boolean; readonly submit?: boolean } = {},
  ): Promise<BrowserActionResult> {
    return agentActions.type(this.kernel, sessionId, id, ref, text, options);
  }

  fillForm(
    sessionId: string,
    id: string,
    fields: readonly {
      readonly ref: string;
      readonly value: BrowserFormValue;
    }[],
  ): Promise<BrowserActionResult> {
    return agentActions.fillForm(this.kernel, sessionId, id, fields);
  }

  select(
    sessionId: string,
    id: string,
    ref: string,
    value: BrowserFormValue,
  ): Promise<BrowserActionResult> {
    return agentActions.select(this.kernel, sessionId, id, ref, value);
  }

  press(
    sessionId: string,
    id: string,
    key: string,
  ): Promise<BrowserActionResult> {
    return agentActions.press(this.kernel, sessionId, id, key);
  }

  hover(
    sessionId: string,
    id: string,
    ref: string,
  ): Promise<BrowserActionResult> {
    return agentActions.hover(this.kernel, sessionId, id, ref);
  }

  scroll(
    sessionId: string,
    id: string,
    deltaY: number,
    ref?: string,
  ): Promise<BrowserActionResult> {
    return agentActions.scroll(this.kernel, sessionId, id, deltaY, ref);
  }

  wait(
    sessionId: string,
    id: string,
    request: BrowserWaitRequest,
  ): Promise<BrowserActionResult> {
    return agentActions.wait(this.kernel, sessionId, id, request);
  }

  history(
    sessionId: string,
    id: string,
    action: "back" | "forward" | "reload",
  ): Promise<BrowserActionResult> {
    return agentActions.history(this.kernel, sessionId, id, action);
  }

  setViewport(
    sessionId: string,
    id: string,
    request: Partial<BrowserViewport>,
  ): Promise<void> {
    return agentActions.setViewport(this.kernel, sessionId, id, request);
  }

  screenshot(sessionId: string, id: string): Promise<Buffer> {
    return agentActions.screenshot(this.kernel, sessionId, id);
  }

  acquireHumanControl(sessionId: string, clientId: string): BrowserSessionInfo {
    return panelActions.acquireHumanControl(this.kernel, sessionId, clientId);
  }

  heartbeatHumanControl(
    sessionId: string,
    clientId: string,
  ): BrowserSessionInfo {
    return panelActions.heartbeatHumanControl(this.kernel, sessionId, clientId);
  }

  releaseHumanControl(sessionId: string, clientId: string): BrowserSessionInfo {
    return panelActions.releaseHumanControl(this.kernel, sessionId, clientId);
  }

  humanSelectTab(
    sessionId: string,
    id: string,
    clientId: string,
  ): Promise<void> {
    return panelActions.humanSelectTab(this.kernel, sessionId, id, clientId);
  }

  humanNavigate(
    sessionId: string,
    id: string,
    clientId: string,
    request: BrowserNavigationRequest,
  ): Promise<BrowserActionResult> {
    return panelActions.humanNavigate(
      this.kernel,
      sessionId,
      id,
      clientId,
      request,
    );
  }

  humanPointer(
    sessionId: string,
    id: string,
    clientId: string,
    request: BrowserHumanPointerRequest,
  ): Promise<BrowserActionResult> {
    return panelActions.humanPointer(
      this.kernel,
      sessionId,
      id,
      clientId,
      request,
    );
  }

  humanKey(
    sessionId: string,
    id: string,
    clientId: string,
    key: string,
  ): Promise<BrowserActionResult> {
    return panelActions.humanKey(this.kernel, sessionId, id, clientId, key);
  }

  humanText(
    sessionId: string,
    id: string,
    clientId: string,
    text: string,
  ): Promise<BrowserActionResult> {
    return panelActions.humanText(this.kernel, sessionId, id, clientId, text);
  }

  humanScroll(
    sessionId: string,
    id: string,
    clientId: string,
    deltaX: number,
    deltaY: number,
  ): Promise<BrowserActionResult> {
    return panelActions.humanScroll(
      this.kernel,
      sessionId,
      id,
      clientId,
      deltaX,
      deltaY,
    );
  }

  humanNewTab(
    sessionId: string,
    clientId: string,
  ): Promise<BrowserActionResult> {
    return panelActions.humanNewTab(this.kernel, sessionId, clientId);
  }

  humanCloseTab(
    sessionId: string,
    id: string,
    clientId: string,
  ): Promise<BrowserActionResult> {
    return panelActions.humanCloseTab(this.kernel, sessionId, id, clientId);
  }

  humanHistory(
    sessionId: string,
    id: string,
    clientId: string,
    action: "back" | "forward" | "reload",
  ): Promise<BrowserActionResult> {
    return panelActions.humanHistory(
      this.kernel,
      sessionId,
      id,
      clientId,
      action,
    );
  }

  humanSetViewport(
    sessionId: string,
    id: string,
    clientId: string,
    request: Partial<BrowserViewport>,
  ): Promise<BrowserActionResult> {
    return panelActions.humanSetViewport(
      this.kernel,
      sessionId,
      id,
      clientId,
      request,
    );
  }

  closeIdleSessions(now = this.kernel.now()): Promise<number> {
    return lifecycle.closeIdleSessions(this.kernel, now);
  }

  async dispose(): Promise<void> {
    const kernel = this.kernel;
    if (kernel.disposed) return;
    kernel.disposed = true;
    if (this.idleTimer !== undefined) clearInterval(this.idleTimer);
    this.crashDisposer();
    // A session whose creation is still running is not in the map yet, so the
    // sweep below would never see the context it is about to register: joining
    // the creations first is what keeps them inside this disposal.
    await Promise.allSettled([...kernel.creating.values()]);
    const ids = [...kernel.sessions.keys()];
    await Promise.allSettled(
      ids.map((sessionId) => lifecycle.closeSession(kernel, sessionId)),
    );
    await kernel.options.provider.stop();
  }
}
