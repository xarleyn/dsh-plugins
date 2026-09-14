import type { BrowserNavigationRequest, BrowserViewport } from "../../types.js";

export interface BrowserProviderStartOptions {
  readonly executablePath: string | null;
  readonly browserChannel: string;
  readonly headless: boolean;
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

export interface BrowserPageHandle {
  url(): string;
  title(): Promise<string>;
  navigate(
    request: BrowserNavigationRequest,
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
