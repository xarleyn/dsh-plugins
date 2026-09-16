export type BrowserSessionStatus =
  "starting" | "ready" | "idle" | "crashed" | "closed";

export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
}

export type BrowserControlState =
  | { readonly owner: "agent"; readonly leaseExpiresAt: null }
  | {
      readonly owner: "human";
      readonly clientId: string;
      readonly leaseExpiresAt: number;
    };

export interface BrowserSessionInfo {
  readonly sessionId: string;
  readonly status: BrowserSessionStatus;
  readonly selectedTabId: string | null;
  readonly tabIds: readonly string[];
  readonly control: BrowserControlState;
  readonly profileName: string | null;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

export interface BrowserTabInfo {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly status: "loading" | "ready" | "failed" | "closed";
  readonly revision: number;
  readonly viewport: BrowserViewport;
}

/**
 * How far the tab's observed history reaches in either direction. It counts
 * what the runtime has watched this tab visit, which is what a browser chrome
 * needs to enable its back and forward controls; the agent's own tab listing
 * stays free of it, because a tool that never greys a button has no use for
 * the depth.
 */
export interface BrowserPanelTabHistory {
  readonly back: number;
  readonly forward: number;
}

/** A tab as the QA panel sees it: tab state plus the depth its chrome shows. */
export interface BrowserPanelTab extends BrowserTabInfo {
  readonly history: BrowserPanelTabHistory;
}

export interface BrowserNavigationRequest {
  readonly url: string;
  readonly waitUntil?: "commit" | "domcontentloaded" | "load";
}

export interface BrowserActionResult {
  readonly ok: boolean;
  readonly sessionId: string;
  readonly tabId: string;
  readonly revision: number;
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  readonly navigation?: {
    readonly from?: string;
    readonly to?: string;
  };
}

export type BrowserSnapshotMode = "interactive" | "document";

export type LocatorPlan =
  | {
      readonly type: "role";
      readonly role: string;
      readonly name?: string;
      readonly exact?: boolean;
      readonly nth?: number;
    }
  | {
      readonly type: "label";
      readonly label: string;
      readonly exact?: boolean;
      readonly nth?: number;
    }
  | {
      readonly type: "placeholder";
      readonly value: string;
      readonly exact?: boolean;
      readonly nth?: number;
    }
  | { readonly type: "testId"; readonly value: string; readonly nth?: number }
  | {
      readonly type: "text";
      readonly value: string;
      readonly exact?: boolean;
      readonly nth?: number;
    }
  | { readonly type: "css-fallback"; readonly selector: string };

export interface ElementFingerprint {
  readonly role?: string;
  readonly name?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly text?: string;
  readonly testId?: string;
}

export interface ElementRefRecord {
  readonly ref: string;
  readonly tabId: string;
  readonly revision: number;
  readonly locator: LocatorPlan;
  readonly fingerprint: ElementFingerprint;
}

export interface SnapshotLine {
  readonly ref?: string;
  readonly role: string;
  readonly name: string;
  readonly text?: string;
}

export interface BrowserSnapshot {
  readonly sessionId: string;
  readonly tabId: string;
  readonly revision: number;
  readonly url: string;
  readonly title: string;
  readonly mode: BrowserSnapshotMode;
  readonly lines: readonly SnapshotLine[];
  readonly text: string;
  readonly truncated: boolean;
}

export interface BrowserSnapshotOptions {
  readonly mode?: BrowserSnapshotMode;
  readonly maxChars?: number;
}

export type BrowserFormValue = string | boolean | readonly string[];

export interface BrowserWaitRequest {
  readonly timeMs?: number;
  readonly url?: string;
  readonly text?: string;
  readonly ref?: string;
  readonly state?: "visible" | "hidden";
  readonly timeoutMs?: number;
}

/** Read-only state exposed to the authenticated QA Surface panel. */
export interface BrowserPanelState {
  readonly session: BrowserSessionInfo | null;
  readonly tabs: readonly BrowserPanelTab[];
  readonly humanControlEnabled: boolean;
  readonly humanControlLeaseSeconds: number;
  readonly autoRevealOnAgentActivity: boolean;
  readonly focusOnAutoReveal: boolean;
  /**
   * Whether this deployment forwards pointer input at all. The panel greys its
   * viewport out with a reason instead of failing one click at a time.
   */
  readonly coordinateInputEnabled: boolean;
}

/** The history actions the panel's own toolbar can ask for. */
export type BrowserPanelHistoryAction = "back" | "forward" | "reload";

export type BrowserHumanPointerAction = "move" | "click" | "down" | "up";

export interface BrowserHumanPointerRequest {
  readonly action: BrowserHumanPointerAction;
  readonly x: number;
  readonly y: number;
  readonly button?: "left" | "middle" | "right";
  readonly clickCount?: 1 | 2;
}

/** Bounded on-demand viewport image carried over the existing DSH Remote. */
export interface BrowserPanelFrame {
  readonly tabId: string;
  readonly revision: number;
  readonly url: string;
  readonly title: string;
  readonly mediaType: "image/png";
  readonly bytes: number;
  readonly data: string;
}
