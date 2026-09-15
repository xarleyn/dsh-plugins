import type {
  BrowserFormValue,
  BrowserNavigationRequest,
  BrowserSnapshotMode,
  BrowserViewport,
  BrowserWaitRequest,
  ElementFingerprint,
  LocatorPlan,
} from "../../types.js";

export interface BrowserProviderStartOptions {
  readonly executablePath: string | null;
  readonly browserChannel: string;
  readonly headless: boolean;
  readonly chromiumSandbox: boolean;
}

export interface BrowserContextOptions {
  readonly sessionId: string;
  readonly viewport: BrowserViewport;
  readonly actionTimeoutMs: number;
  readonly navigationTimeoutMs: number;
  readonly validateRequest: (url: string) => Promise<void>;
}

export interface ProviderNavigationResult {
  readonly url: string;
  readonly title: string;
}

export interface ProviderSnapshotNode {
  readonly role: string;
  readonly name: string;
  readonly text?: string;
  readonly locator: LocatorPlan;
  readonly fingerprint: ElementFingerprint;
  readonly interactive: boolean;
}

export interface BrowserPageHandle {
  url(): string;
  title(): Promise<string>;
  navigate(
    request: BrowserNavigationRequest,
  ): Promise<ProviderNavigationResult>;
  snapshot(mode: BrowserSnapshotMode): Promise<readonly ProviderSnapshotNode[]>;
  validateLocator(locator: LocatorPlan): Promise<void>;
  click(
    locator: LocatorPlan,
    options?: {
      readonly button?: "left" | "middle" | "right";
      readonly clickCount?: 1 | 2;
    },
  ): Promise<void>;
  type(
    locator: LocatorPlan,
    text: string,
    options?: { readonly clear?: boolean; readonly submit?: boolean },
  ): Promise<void>;
  setValue(locator: LocatorPlan, value: BrowserFormValue): Promise<void>;
  press(key: string): Promise<void>;
  insertText(text: string): Promise<void>;
  pointer(request: {
    readonly action: "move" | "click" | "down" | "up";
    readonly x: number;
    readonly y: number;
    readonly button?: "left" | "middle" | "right";
    readonly clickCount?: 1 | 2;
  }): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
  hover(locator: LocatorPlan): Promise<void>;
  scroll(deltaY: number, locator?: LocatorPlan): Promise<void>;
  wait(
    request: Omit<BrowserWaitRequest, "ref"> & {
      readonly locator?: LocatorPlan;
    },
  ): Promise<void>;
  history(
    action: "back" | "forward" | "reload",
  ): Promise<ProviderNavigationResult>;
  setViewport(viewport: BrowserViewport): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
  onChanged(listener: () => void): () => void;
  onClosed(listener: () => void): () => void;
}

export interface BrowserContextHandle {
  readonly id: string;
  newPage(): Promise<BrowserPageHandle>;
  close(): Promise<void>;
}

export interface BrowserProvider {
  start(options: BrowserProviderStartOptions): Promise<void>;
  stop(): Promise<void>;
  createContext(options: BrowserContextOptions): Promise<BrowserContextHandle>;
  closeContext(id: string): Promise<void>;
  onCrash(listener: (error: Error) => void): () => void;
}
