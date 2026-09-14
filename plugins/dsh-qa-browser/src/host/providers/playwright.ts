import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import type {
  Browser,
  BrowserContext,
  BrowserType,
  LaunchOptions,
  Locator,
  Page,
} from "playwright";

import { browserErrorMessage, QaBrowserError } from "../../errors.js";
import type {
  BrowserFormValue,
  BrowserSnapshotMode,
  BrowserWaitRequest,
  LocatorPlan,
} from "../../types.js";
import type {
  BrowserContextHandle,
  BrowserContextOptions,
  BrowserPageHandle,
  BrowserProvider,
  BrowserProviderStartOptions,
  ProviderNavigationResult,
  ProviderSnapshotNode,
} from "./contract.js";

type PlaywrightModule = typeof import("playwright");
type PlaywrightLoader = () => Promise<PlaywrightModule>;

interface PolicyBlockState {
  readonly byPage: WeakMap<Page, unknown>;
  sequence: number;
  lastError?: unknown;
}

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
  const common = {
    headless: options.headless,
    chromiumSandbox: options.chromiumSandbox,
  } satisfies LaunchOptions;
  if (options.executablePath !== null) {
    if (!existsSync(options.executablePath)) {
      throw new QaBrowserError(
        "BROWSER_START_FAILED",
        "Configured Chromium executable does not exist.",
      );
    }
    return [
      { executablePath: options.executablePath, ...common },
    ];
  }

  const candidates: LaunchOptions[] = [];
  const discovered = chromium.executablePath();
  if (existsSync(discovered)) {
    candidates.push({ executablePath: discovered, ...common });
  }
  if (options.browserChannel !== "chromium") {
    candidates.push({
      channel: options.browserChannel,
      ...common,
    });
  }
  for (const executablePath of systemBrowserCandidates()) {
    if (existsSync(executablePath)) {
      candidates.push({ executablePath, ...common });
    }
  }
  if (candidates.length === 0) candidates.push(common);
  return candidates;
}

class PlaywrightPageHandle implements BrowserPageHandle {
  constructor(
    private readonly page: Page,
    private readonly blockedRequests: PolicyBlockState,
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
    this.blockedRequests.byPage.delete(this.page);
    const blockSequence = this.blockedRequests.sequence;
    try {
      await this.page.goto(request.url, {
        waitUntil: request.waitUntil ?? "domcontentloaded",
      });
    } catch (error) {
      const policyError = this.blockedRequests.byPage.get(this.page);
      this.blockedRequests.byPage.delete(this.page);
      if (policyError !== undefined) throw policyError;
      if (this.blockedRequests.sequence !== blockSequence) {
        throw this.blockedRequests.lastError;
      }
      if (/ERR_BLOCKED_BY_CLIENT/iu.test(browserErrorMessage(error))) {
        throw new QaBrowserError(
          "BROWSER_REDIRECT_BLOCKED",
          "Browser navigation was stopped because a redirect or subrequest violated the network policy.",
          { cause: error },
        );
      }
      throw error;
    }
    return { url: this.page.url(), title: await this.page.title() };
  }

  async snapshot(
    mode: BrowserSnapshotMode,
  ): Promise<readonly ProviderSnapshotNode[]> {
    const selector =
      mode === "interactive"
        ? "button,a[href],input,textarea,select,summary,[role],[contenteditable],h1,h2,h3,h4,h5,h6"
        : "button,a[href],input,textarea,select,summary,[role],[contenteditable],h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,output";
    const raw = await this.page.locator(selector).evaluateAll((elements) => {
      const roleFor = (element: Element): string => {
        const explicit = element.getAttribute("role")?.trim();
        if (explicit) return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button" || tag === "summary") return "button";
        if (/^h[1-6]$/u.test(tag)) return "heading";
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "combobox";
        if (tag === "li") return "listitem";
        if (tag === "input") {
          const type = (element.getAttribute("type") ?? "text").toLowerCase();
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "submit" || type === "button" || type === "reset")
            return "button";
          return "textbox";
        }
        return tag === "p" ? "paragraph" : tag;
      };
      const selectorFor = (element: Element): string => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current.tagName.toLowerCase() !== "html") {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (parent === null) {
            parts.unshift(tag);
            break;
          }
          const siblings = [...parent.children].filter(
            (candidate) => candidate.tagName === current!.tagName,
          );
          const suffix =
            siblings.length <= 1
              ? ""
              : `:nth-of-type(${siblings.indexOf(current) + 1})`;
          parts.unshift(`${tag}${suffix}`);
          current = parent;
        }
        return parts.join(" > ");
      };
      return elements.slice(0, 500).flatMap((element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          return [];
        }
        const label =
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? [...(element.labels ?? [])]
                .map((item) => {
                  const copy = item.cloneNode(true) as Element;
                  for (const control of copy.querySelectorAll(
                    "input,textarea,select,button",
                  )) {
                    control.remove();
                  }
                  return copy.textContent?.replace(/\s+/gu, " ").trim() ?? "";
                })
                .filter(Boolean)
                .join(" ")
            : "";
        const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
        const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
        const testId = element.getAttribute("data-testid")?.trim() ?? "";
        const name =
          [
            element.getAttribute("aria-label")?.trim(),
            label,
            element.getAttribute("alt")?.trim(),
            element.getAttribute("title")?.trim(),
            placeholder,
            text,
          ]
            .find((value) => value !== undefined && value !== "")
            ?.replace(/\s+/gu, " ")
            .trim()
            .slice(0, 300) ?? roleFor(element);
        const role = roleFor(element);
        const interactive =
          [
            "button",
            "link",
            "textbox",
            "checkbox",
            "radio",
            "combobox",
            "option",
            "slider",
            "spinbutton",
            "switch",
            "tab",
            "menuitem",
          ].includes(role) || html.tabIndex >= 0;
        return [
          {
            role,
            name: name || role,
            text: text.slice(0, 500),
            label,
            placeholder,
            testId,
            selector: selectorFor(element),
            interactive,
          },
        ];
      });
    });

    const occurrences = new Map<string, number>();
    return raw.map((node) => {
      const base =
        node.name !== ""
          ? ({
              type: "role",
              role: node.role,
              name: node.name,
              exact: true,
            } as const)
          : node.label !== ""
            ? ({ type: "label", label: node.label, exact: true } as const)
            : node.testId !== ""
              ? ({ type: "testId", value: node.testId } as const)
              : node.placeholder !== ""
                ? ({
                    type: "placeholder",
                    value: node.placeholder,
                    exact: true,
                  } as const)
                : ({ type: "css-fallback", selector: node.selector } as const);
      const key = JSON.stringify(base);
      const nth = occurrences.get(key) ?? 0;
      occurrences.set(key, nth + 1);
      const locator: LocatorPlan =
        base.type === "css-fallback" ? base : { ...base, nth };
      return {
        role: node.role,
        name: node.name,
        ...(node.text === "" ? {} : { text: node.text }),
        locator,
        fingerprint: {
          role: node.role,
          name: node.name,
          ...(node.label === "" ? {} : { label: node.label }),
          ...(node.placeholder === "" ? {} : { placeholder: node.placeholder }),
          ...(node.testId === "" ? {} : { testId: node.testId }),
          ...(node.text === "" ? {} : { text: node.text }),
        },
        interactive: node.interactive,
      };
    });
  }

  async validateLocator(locator: LocatorPlan): Promise<void> {
    const { base, nth } = this.resolveBase(locator);
    const count = await base.count();
    if (count <= nth) {
      throw new QaBrowserError(
        "BROWSER_TARGET_NOT_FOUND",
        `The referenced page element no longer exists (${locator.type}: ${
          locator.type === "label"
            ? locator.label
            : locator.type === "placeholder" || locator.type === "testId"
              ? locator.value
              : locator.type === "role"
                ? `${locator.role}/${locator.name ?? ""}`
                : locator.type
        }).`,
      );
    }
  }

  async click(
    locator: LocatorPlan,
    options: Parameters<BrowserPageHandle["click"]>[1] = {},
  ): Promise<void> {
    await (
      await this.resolved(locator)
    ).click({
      button: options.button ?? "left",
      clickCount: options.clickCount ?? 1,
    });
  }

  async type(
    locator: LocatorPlan,
    text: string,
    options: Parameters<BrowserPageHandle["type"]>[2] = {},
  ): Promise<void> {
    const target = await this.resolved(locator);
    if (options.clear) await target.fill("");
    await target.pressSequentially(text);
    if (options.submit) await target.press("Enter");
  }

  async setValue(locator: LocatorPlan, value: BrowserFormValue): Promise<void> {
    const target = await this.resolved(locator);
    if (typeof value === "boolean") {
      if (value) await target.check();
      else await target.uncheck();
      return;
    }
    if (typeof value !== "string") {
      await target.selectOption([...value]);
      return;
    }
    const tag = await target.evaluate((element) =>
      element.tagName.toLowerCase(),
    );
    if (tag === "select") await target.selectOption(value);
    else await target.fill(value);
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async hover(locator: LocatorPlan): Promise<void> {
    await (await this.resolved(locator)).hover();
  }

  async scroll(deltaY: number, locator?: LocatorPlan): Promise<void> {
    if (locator === undefined) {
      await this.page.mouse.wheel(0, deltaY);
      return;
    }
    await (
      await this.resolved(locator)
    ).evaluate(
      (element, delta) => element.scrollBy({ top: delta, behavior: "instant" }),
      deltaY,
    );
  }

  async wait(
    request: Omit<BrowserWaitRequest, "ref"> & {
      readonly locator?: LocatorPlan;
    },
  ): Promise<void> {
    const timeout = request.timeoutMs;
    if (request.timeMs !== undefined)
      await this.page.waitForTimeout(request.timeMs);
    if (request.url !== undefined)
      await this.page.waitForURL(request.url, { timeout });
    if (request.text !== undefined) {
      await this.page
        .getByText(request.text, { exact: false })
        .first()
        .waitFor({
          state: "visible",
          timeout,
        });
    }
    if (request.locator !== undefined) {
      await (
        await this.resolved(request.locator)
      ).waitFor({
        state: request.state ?? "visible",
        timeout,
      });
    }
  }

  async history(
    action: "back" | "forward" | "reload",
  ): Promise<ProviderNavigationResult> {
    if (action === "back")
      await this.page.goBack({ waitUntil: "domcontentloaded" });
    else if (action === "forward")
      await this.page.goForward({ waitUntil: "domcontentloaded" });
    else await this.page.reload({ waitUntil: "domcontentloaded" });
    return { url: this.page.url(), title: await this.page.title() };
  }

  private resolveBase(locator: LocatorPlan): { base: Locator; nth: number } {
    const nth = locator.type === "css-fallback" ? 0 : (locator.nth ?? 0);
    switch (locator.type) {
      case "role":
        return {
          base: this.page.getByRole(locator.role as never, {
            name: locator.name,
            exact: locator.exact,
          }),
          nth,
        };
      case "label":
        return {
          base: this.page.getByLabel(locator.label, { exact: locator.exact }),
          nth,
        };
      case "placeholder":
        return {
          base: this.page.getByPlaceholder(locator.value, {
            exact: locator.exact,
          }),
          nth,
        };
      case "testId":
        return { base: this.page.getByTestId(locator.value), nth };
      case "text":
        return {
          base: this.page.getByText(locator.value, { exact: locator.exact }),
          nth,
        };
      case "css-fallback":
        return { base: this.page.locator(locator.selector), nth };
    }
  }

  private async resolved(locator: LocatorPlan): Promise<Locator> {
    const { base, nth } = this.resolveBase(locator);
    const count = await base.count();
    if (count <= nth) {
      throw new QaBrowserError(
        "BROWSER_TARGET_NOT_FOUND",
        "The referenced page element no longer exists.",
      );
    }
    return base.nth(nth);
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
    private readonly blockedRequests: PolicyBlockState,
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
    const blockedRequests: PolicyBlockState = {
      byPage: new WeakMap<Page, unknown>(),
      sequence: 0,
    };
    await context.route("**/*", async (route) => {
      try {
        await options.validateRequest(route.request().url());
        await route.continue();
      } catch (error) {
        blockedRequests.sequence += 1;
        blockedRequests.lastError = error;
        try {
          blockedRequests.byPage.set(route.request().frame().page(), error);
        } catch {
          // A service-worker request has no frame. It is still aborted below.
        }
        if (route.request().isNavigationRequest()) {
          // Redirect requests can race with frame replacement. Record the
          // policy error on every page in this isolated session context so the
          // active navigation reports the stable security error, not only
          // Playwright's generic net::ERR_FAILED wrapper.
          for (const page of context.pages()) {
            blockedRequests.byPage.set(page, error);
          }
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
