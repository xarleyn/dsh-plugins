import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import type {
  Browser,
  BrowserContext,
  BrowserType,
  LaunchOptions,
  Page,
} from "playwright";

import { browserErrorMessage, QaBrowserError } from "../../errors.js";
import type {
  BrowserContextHandle,
  BrowserContextOptions,
  BrowserPageHandle,
  BrowserProvider,
  BrowserProviderStartOptions,
  ProviderNavigationResult,
} from "./contract.js";

type PlaywrightModule = typeof import("playwright");
type PlaywrightLoader = () => Promise<PlaywrightModule>;

function systemBrowserCandidates(): readonly string[] {
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter(
      (value): value is string => typeof value === "string" && value !== "",
    );
    return roots.flatMap((root) => [
      `${root}\\Google\\Chrome\\Application\\chrome.exe`,
      `${root}\\Chromium\\Application\\chrome.exe`,
      `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function launchCandidates(
  chromium: BrowserType,
  options: BrowserProviderStartOptions,
): readonly LaunchOptions[] {
  if (options.executablePath !== null) {
    if (!existsSync(options.executablePath)) {
      throw new QaBrowserError(
        "BROWSER_START_FAILED",
        "Configured Chromium executable does not exist.",
      );
    }
    return [
      { executablePath: options.executablePath, headless: options.headless },
    ];
  }

  const candidates: LaunchOptions[] = [];
  const discovered = chromium.executablePath();
  if (existsSync(discovered)) {
    candidates.push({ executablePath: discovered, headless: options.headless });
  }
  if (options.browserChannel !== "chromium") {
    candidates.push({
      channel: options.browserChannel,
      headless: options.headless,
    });
  }
  for (const executablePath of systemBrowserCandidates()) {
    if (existsSync(executablePath)) {
      candidates.push({ executablePath, headless: options.headless });
    }
  }
  if (candidates.length === 0) candidates.push({ headless: options.headless });
  return candidates;
}

class PlaywrightPageHandle implements BrowserPageHandle {
  constructor(
    private readonly page: Page,
    private readonly blockedRequests: WeakMap<Page, unknown>,
  ) {}

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title();
  }

  async navigate(
    request: Parameters<BrowserPageHandle["navigate"]>[0],
  ): Promise<ProviderNavigationResult> {
    this.blockedRequests.delete(this.page);
    try {
      await this.page.goto(request.url, {
        waitUntil: request.waitUntil ?? "domcontentloaded",
      });
    } catch (error) {
      const policyError = this.blockedRequests.get(this.page);
      this.blockedRequests.delete(this.page);
      if (policyError !== undefined) throw policyError;
      throw error;
    }
    return { url: this.page.url(), title: await this.page.title() };
  }

  async setViewport(
    viewport: Parameters<BrowserPageHandle["setViewport"]>[0],
  ): Promise<void> {
    await this.page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
  }

  screenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: "png", animations: "disabled" });
  }

  async close(): Promise<void> {
    if (!this.page.isClosed())
      await this.page.close({ runBeforeUnload: false });
  }

  onChanged(listener: () => void): () => void {
    this.page.on("domcontentloaded", listener);
    this.page.on("load", listener);
    return () => {
      this.page.off("domcontentloaded", listener);
      this.page.off("load", listener);
    };
  }

  onClosed(listener: () => void): () => void {
    this.page.on("close", listener);
    return () => this.page.off("close", listener);
  }
}

class PlaywrightContextHandle implements BrowserContextHandle {
  readonly id = `context_${randomUUID().replaceAll("-", "")}`;
  private closed = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly blockedRequests: WeakMap<Page, unknown>,
  ) {}

  async newPage(): Promise<BrowserPageHandle> {
    if (this.closed) {
      throw new QaBrowserError(
        "BROWSER_CONTEXT_CLOSED",
        "Browser context is closed.",
      );
    }
    return new PlaywrightPageHandle(
      await this.context.newPage(),
      this.blockedRequests,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close();
  }
}

/** Lazy, shared Chromium process. No browser download is ever triggered here. */
export class PlaywrightBrowserProvider implements BrowserProvider {
  private browser: Browser | undefined;
  private starting: Promise<void> | undefined;
  private readonly contexts = new Map<string, PlaywrightContextHandle>();
  private readonly crashListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly loadPlaywright: PlaywrightLoader = async () =>
      await import("playwright"),
  ) {}

  async start(options: BrowserProviderStartOptions): Promise<void> {
    if (this.browser?.isConnected()) return;
    this.starting ??= this.launch(options);
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async launch(options: BrowserProviderStartOptions): Promise<void> {
    const playwright = await this.loadPlaywright();
    const failures: string[] = [];
    for (const candidate of launchCandidates(playwright.chromium, options)) {
      try {
        const browser = await playwright.chromium.launch(candidate);
        browser.once("disconnected", () => {
          if (this.browser !== browser) return;
          this.browser = undefined;
          this.contexts.clear();
          const error = new QaBrowserError(
            "BROWSER_CRASHED",
            "Chromium disconnected.",
          );
          for (const listener of this.crashListeners) listener(error);
        });
        this.browser = browser;
        return;
      } catch (error) {
        failures.push(browserErrorMessage(error));
      }
    }
    throw new QaBrowserError(
      "BROWSER_START_FAILED",
      `Chromium could not be started. ${failures.at(-1) ?? "No executable candidate was available."}`,
    );
  }

  async createContext(
    options: BrowserContextOptions,
  ): Promise<BrowserContextHandle> {
    const browser = this.browser;
    if (browser === undefined || !browser.isConnected()) {
      throw new QaBrowserError(
        "BROWSER_START_FAILED",
        "Chromium is not running.",
      );
    }
    const context = await browser.newContext({
      viewport: {
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor: options.viewport.deviceScaleFactor,
      acceptDownloads: false,
    });
    context.setDefaultTimeout(options.actionTimeoutMs);
    context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
    const blockedRequests = new WeakMap<Page, unknown>();
    await context.route("**/*", async (route) => {
      try {
        await options.validateRequest(route.request().url());
        await route.continue();
      } catch (error) {
        try {
          blockedRequests.set(route.request().frame().page(), error);
        } catch {
          // A service-worker request has no frame. It is still aborted below.
        }
        await route.abort("blockedbyclient");
      }
    });
    const handle = new PlaywrightContextHandle(context, blockedRequests);
    this.contexts.set(handle.id, handle);
    return handle;
  }

  async closeContext(id: string): Promise<void> {
    const context = this.contexts.get(id);
    if (context === undefined) return;
    this.contexts.delete(id);
    await context.close();
  }

  async stop(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    const contexts = [...this.contexts.values()];
    this.contexts.clear();
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (browser !== undefined) await browser.close();
  }

  onCrash(listener: (error: Error) => void): () => void {
    this.crashListeners.add(listener);
    return () => this.crashListeners.delete(listener);
  }
}
