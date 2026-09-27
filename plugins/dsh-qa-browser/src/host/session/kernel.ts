import type { ResolvedQaBrowserConfig } from "../../config.js";
import { QaBrowserError } from "../../errors.js";
import type {
  BrowserPanelTab,
  BrowserSessionInfo,
  BrowserTabInfo,
} from "../../types.js";
import type { BrowserNetworkPolicy } from "../policy.js";
import type { BrowserProvider } from "../providers/contract.js";
import type { SessionRecord, TabRecord } from "./records.js";

export interface BrowserRuntimeLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const silentBrowserLogger: BrowserRuntimeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface QaBrowserSessionManagerOptions {
  readonly config: ResolvedQaBrowserConfig;
  readonly provider: BrowserProvider;
  readonly policy: BrowserNetworkPolicy;
  readonly logger?: BrowserRuntimeLogger;
  readonly now?: () => number;
  readonly startIdleTimer?: boolean;
}

/**
 * The state one browser runtime holds, and the questions about it that need no
 * other module: which sessions and tabs exist, who is allowed to drive them,
 * and what a record looks like from the outside.
 *
 * Everything above it — the lifecycle, the tab registry, the transport, the
 * refusal channel — is a function that takes this kernel, so the map of
 * sessions has exactly one owner while the responsibilities that read it are
 * separate files.
 */
export class SessionKernel {
  readonly sessions = new Map<string, SessionRecord>();
  readonly creating = new Map<string, Promise<SessionRecord>>();
  readonly options: QaBrowserSessionManagerOptions;
  readonly logger: BrowserRuntimeLogger;
  readonly now: () => number;
  disposed = false;

  constructor(options: QaBrowserSessionManagerOptions) {
    this.options = options;
    this.logger = options.logger ?? silentBrowserLogger;
    this.now = options.now ?? Date.now;
  }

  requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw new QaBrowserError(
        "BROWSER_SESSION_NOT_FOUND",
        "Browser session has not been started.",
      );
    }
    if (record.status === "crashed") {
      throw new QaBrowserError(
        "BROWSER_CRASHED",
        "Browser page state was lost after a crash.",
      );
    }
    return record;
  }

  requireTab(record: SessionRecord, id: string): TabRecord {
    const tab = record.tabs.get(id);
    if (tab === undefined) {
      throw new QaBrowserError(
        "BROWSER_TAB_NOT_FOUND",
        "Browser tab was not found.",
      );
    }
    return tab;
  }

  assertAvailable(): void {
    if (this.disposed) {
      throw new QaBrowserError(
        "BROWSER_CONTEXT_CLOSED",
        "Browser runtime is closed.",
      );
    }
    if (!this.options.config.enabled) {
      throw new QaBrowserError(
        "BROWSER_DISABLED",
        "Browser runtime is disabled.",
      );
    }
  }

  validSessionId(sessionId: string): string {
    const value = sessionId.trim();
    if (value === "") {
      throw new QaBrowserError(
        "BROWSER_SESSION_NOT_FOUND",
        "DSH session id must not be empty.",
      );
    }
    return value;
  }

  validClientId(clientId: string): string {
    const value = clientId.trim();
    if (value === "" || value.length > 128) {
      throw new QaBrowserError(
        "BROWSER_HUMAN_CONTROL_NOT_OWNER",
        "Browser panel client id is invalid.",
      );
    }
    return value;
  }

  currentControl(record: SessionRecord): SessionRecord["control"] {
    if (
      record.control.owner === "human" &&
      record.control.leaseExpiresAt <= this.now()
    ) {
      record.control = { owner: "agent", leaseExpiresAt: null };
    }
    return record.control;
  }

  assertAgentControl(record: SessionRecord): void {
    if (this.currentControl(record).owner === "human") {
      throw new QaBrowserError(
        "BROWSER_HUMAN_CONTROL_ACTIVE",
        "A user currently controls this Browser session. Retry after control is released.",
      );
    }
  }

  assertHumanControl(record: SessionRecord, clientId: string): void {
    const ownerId = this.validClientId(clientId);
    const control = this.currentControl(record);
    if (control.owner !== "human" || control.clientId !== ownerId) {
      throw new QaBrowserError(
        "BROWSER_HUMAN_CONTROL_NOT_OWNER",
        "This Browser panel does not own human control.",
      );
    }
  }

  touch(record: SessionRecord): void {
    record.lastActivityAt = this.now();
    if (record.status === "idle") record.status = "ready";
  }

  sessionInfo(record: SessionRecord): BrowserSessionInfo {
    return {
      sessionId: record.sessionId,
      status: record.status,
      selectedTabId: record.selectedTabId,
      tabIds: [...record.tabs.keys()],
      control: { ...this.currentControl(record) },
      profileName: null,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }

  tabInfo(tab: TabRecord): BrowserTabInfo {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      revision: tab.revision,
      viewport: { ...tab.viewport },
    };
  }

  panelTabInfo(tab: TabRecord): BrowserPanelTab {
    return {
      ...this.tabInfo(tab),
      history: {
        back: tab.history.index,
        forward: tab.history.entries.length - 1 - tab.history.index,
      },
      policyRefusals: [...tab.policyRefusals],
    };
  }
}
