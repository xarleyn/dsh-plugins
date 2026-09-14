export type BrowserSessionStatus =
  "starting" | "ready" | "idle" | "crashed" | "closed";

export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
}

export interface BrowserControlState {
  readonly owner: "agent" | "human";
  readonly leaseExpiresAt: number | null;
}

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
