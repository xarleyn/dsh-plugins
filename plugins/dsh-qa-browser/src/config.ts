import path from "node:path";

import z from "@deepseek-ai/schemastery";

import type { QaBrowserRuntimeMode } from "./types.js";

export interface QaBrowserConfig {
  readonly enabled?: boolean;
  readonly runtime?: {
    readonly provider?: "playwright";
    readonly mode?: QaBrowserRuntimeMode;
    readonly executablePath?: string | null;
    readonly browserChannel?: string;
    readonly cdpEndpoint?: string | null;
    readonly allowRemoteCdpEndpoint?: boolean;
    readonly headless?: boolean;
    readonly chromiumSandbox?: boolean;
    readonly actionTimeoutMs?: number;
    readonly navigationTimeoutMs?: number;
    readonly idleTimeoutMinutes?: number;
  };
  readonly session?: {
    readonly contextScope?: "session";
    readonly maxTabs?: number;
  };
  readonly viewport?: {
    readonly width?: number;
    readonly height?: number;
    readonly deviceScaleFactor?: number;
  };
  readonly snapshots?: {
    readonly mode?: "interactive" | "document";
    readonly maxChars?: number;
    readonly returnDeltaAfterActions?: boolean;
  };
  readonly capabilities?: {
    readonly core?: boolean;
    readonly vision?: boolean;
    readonly coordinateInput?: boolean;
    readonly devtools?: boolean;
    readonly network?: boolean;
    readonly trace?: boolean;
    readonly storage?: boolean;
    readonly downloads?: boolean;
    readonly uploads?: boolean;
    readonly unsafeEvaluate?: boolean;
  };
  readonly ui?: {
    readonly autoRevealOnAgentActivity?: boolean;
    readonly focusOnAutoReveal?: boolean;
  };
  readonly humanControl?: {
    readonly enabled?: boolean;
    readonly leaseSeconds?: number;
  };
  readonly security?: {
    readonly network?: {
      readonly allowedSchemes?: string[];
      readonly allowLoopback?: boolean;
      readonly allowPrivateNetworks?: boolean;
      readonly allowHosts?: string[];
      readonly denyHosts?: string[];
      readonly denyMetadataEndpoints?: boolean;
      readonly denyDshOrigin?: boolean;
      readonly dshOrigins?: string[];
    };
  };
}

export interface ResolvedQaBrowserConfig {
  readonly enabled: boolean;
  readonly runtime: {
    readonly provider: "playwright";
    readonly mode: QaBrowserRuntimeMode;
    readonly executablePath: string | null;
    readonly browserChannel: string;
    readonly cdpEndpoint: string | null;
    readonly headless: boolean;
    readonly chromiumSandbox: boolean;
    readonly actionTimeoutMs: number;
    readonly navigationTimeoutMs: number;
    readonly idleTimeoutMs: number;
  };
  readonly session: {
    readonly contextScope: "session";
    readonly maxTabs: number;
  };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
  };
  readonly snapshots: {
    readonly mode: "interactive" | "document";
    readonly maxChars: number;
    readonly returnDeltaAfterActions: boolean;
  };
  readonly capabilities: {
    readonly core: boolean;
    readonly vision: boolean;
    readonly coordinateInput: boolean;
    readonly devtools: boolean;
    readonly network: boolean;
    readonly trace: boolean;
    readonly storage: boolean;
    readonly downloads: boolean;
    readonly uploads: boolean;
    readonly unsafeEvaluate: boolean;
  };
  readonly ui: {
    readonly autoRevealOnAgentActivity: boolean;
    readonly focusOnAutoReveal: boolean;
  };
  readonly humanControl: {
    readonly enabled: boolean;
    readonly leaseSeconds: number;
    readonly leaseMs: number;
  };
  readonly security: {
    readonly network: {
      readonly allowedSchemes: readonly string[];
      readonly allowLoopback: boolean;
      readonly allowPrivateNetworks: boolean;
      readonly allowHosts: readonly string[];
      readonly denyHosts: readonly string[];
      readonly denyMetadataEndpoints: boolean;
      readonly denyDshOrigin: boolean;
      readonly dshOrigins: readonly string[];
    };
  };
}

export const QA_BROWSER_DEFAULTS: ResolvedQaBrowserConfig = {
  enabled: true,
  runtime: {
    provider: "playwright",
    mode: "launch",
    executablePath: null,
    browserChannel: "chromium",
    cdpEndpoint: null,
    headless: true,
    chromiumSandbox: true,
    actionTimeoutMs: 15_000,
    navigationTimeoutMs: 30_000,
    idleTimeoutMs: 30 * 60_000,
  },
  session: {
    contextScope: "session",
    maxTabs: 12,
  },
  viewport: {
    width: 1_440,
    height: 900,
    deviceScaleFactor: 1,
  },
  snapshots: {
    mode: "interactive",
    maxChars: 30_000,
    returnDeltaAfterActions: true,
  },
  capabilities: {
    core: true,
    vision: true,
    coordinateInput: true,
    devtools: false,
    network: false,
    trace: false,
    storage: false,
    downloads: true,
    uploads: false,
    unsafeEvaluate: false,
  },
  ui: {
    autoRevealOnAgentActivity: true,
    focusOnAutoReveal: false,
  },
  humanControl: {
    enabled: true,
    leaseSeconds: 30,
    leaseMs: 30_000,
  },
  security: {
    network: {
      allowedSchemes: ["http", "https"],
      allowLoopback: true,
      allowPrivateNetworks: false,
      allowHosts: [],
      denyHosts: [],
      denyMetadataEndpoints: true,
      denyDshOrigin: true,
      dshOrigins: [],
    },
  },
};

const nullableString = z.union([z.string(), z.const(null)]);

export const QaBrowserConfigSchema: z<QaBrowserConfig> = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .description("Enable the Browser runtime."),
    runtime: z
      .object({
        provider: z.union(["playwright"] as const).default("playwright"),
        mode: z
          .union(["launch", "attach"] as const)
          .default("launch")
          .description(
            "launch starts its own Chromium; attach joins a Chromium someone else started, over its DevTools endpoint.",
          ),
        executablePath: nullableString.default(null),
        browserChannel: z.string().default("chromium"),
        cdpEndpoint: nullableString.default(null),
        allowRemoteCdpEndpoint: z
          .boolean()
          .default(false)
          .description(
            "Let runtime.cdpEndpoint name a host outside this machine. A DevTools endpoint is full control of the browser, so the default keeps it on loopback. Refused under runtime.mode launch, which has no endpoint to open.",
          ),
        headless: z.boolean().default(true),
        chromiumSandbox: z
          .boolean()
          .default(true)
          .description(
            "Keep the Chromium process sandbox enabled. Disable only in a separately hardened container.",
          ),
        actionTimeoutMs: z.number().default(15_000),
        navigationTimeoutMs: z.number().default(30_000),
        idleTimeoutMinutes: z.number().default(30),
      })
      .description(
        "How Chromium is obtained — its own process, or an existing one over CDP — and the timeouts it runs under.",
      ),
    session: z
      .object({
        contextScope: z.union(["session"] as const).default("session"),
        maxTabs: z.number().default(12),
      })
      .description("Per-DSH-session isolation and tab limits."),
    viewport: z
      .object({
        width: z.number().default(1_440),
        height: z.number().default(900),
        deviceScaleFactor: z.number().default(1),
      })
      .description("Default viewport for newly created tabs."),
    snapshots: z
      .object({
        mode: z
          .union(["interactive", "document"] as const)
          .default("interactive"),
        maxChars: z.number().default(30_000),
        returnDeltaAfterActions: z.boolean().default(true),
      })
      .description("Semantic snapshot limits."),
    capabilities: z
      .object({
        core: z.boolean().default(true),
        vision: z.boolean().default(true),
        coordinateInput: z.boolean().default(true),
        devtools: z.boolean().default(false),
        network: z.boolean().default(false),
        trace: z.boolean().default(false),
        storage: z.boolean().default(false),
        downloads: z.boolean().default(true),
        uploads: z.boolean().default(false),
        unsafeEvaluate: z.boolean().default(false),
      })
      .description("Browser capability gates."),
    ui: z
      .object({
        autoRevealOnAgentActivity: z.boolean().default(true),
        focusOnAutoReveal: z.boolean().default(false),
      })
      .description("QA Surface Browser panel behavior."),
    humanControl: z
      .object({
        enabled: z.boolean().default(true),
        leaseSeconds: z.number().default(30),
      })
      .description("Explicit human takeover lease for the QA Browser panel."),
    security: z
      .object({
        network: z
          .object({
            allowedSchemes: z.array(z.string()).default(["http", "https"]),
            allowLoopback: z.boolean().default(true),
            allowPrivateNetworks: z.boolean().default(false),
            allowHosts: z.array(z.string()).default([]),
            denyHosts: z.array(z.string()).default([]),
            denyMetadataEndpoints: z.boolean().default(true),
            denyDshOrigin: z.boolean().default(true),
            dshOrigins: z.array(z.string()).default([]),
          })
          .description("Server-enforced Browser network policy."),
      })
      .description("Browser security boundaries."),
  })
  .description("Session-scoped QA Browser runtime.");

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizedStrings(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
}

/** The endpoint forms Playwright will dial for us. */
const CDP_ENDPOINT_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

/**
 * Whether a CDP endpoint names this machine rather than somewhere reachable.
 *
 * Only `localhost` itself and the loopback literals count. A `*.localhost` name
 * is *intended* to be loopback, but this host is never resolved here — Playwright
 * dials it through the system resolver, where ndots and a search domain can turn
 * `browser.localhost` into a query for `browser.localhost.example.corp` and hand
 * back a real address. A name whose meaning the runtime cannot check is not a
 * proof, so such an endpoint needs `allowRemoteCdpEndpoint` written down.
 *
 * The check runs on `URL.hostname`, which is the stronger form of the rule: the
 * parser has already turned `http://2130706433`, `http://127.1` and
 * `http://127.0.0.1.` into `127.0.0.1`, so an accepted oddity is an address the
 * resolver has no part in, while userinfo and any host it hides are separated
 * out. A trailing dot after a *name* is kept rather than stripped: `localhost.`
 * is not the literal but a DNS query, and whether its answer is loopback depends
 * on the resolver and on libc — glibc reads it from `/etc/hosts`, musl sends it
 * out.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();
  if (host === "localhost") return true;
  if (host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}

/**
 * The DevTools endpoint to attach to, or nothing in launch mode.
 *
 * A CDP endpoint is not a read-only handle: whoever holds it drives the browser
 * and reads every page inside it, past this plugin's own network policy. So the
 * default reaches only this machine, and a host beyond it needs the switch
 * flipped on purpose — the same reason the browser's own pages are gated.
 *
 * What the gate bounds is the address written down, which is the whole handle for
 * a `ws`/`wss` endpoint and the first hop for an `http`/`https` one: Playwright
 * asks that URL for `/json/version` and dials the `webSocketDebuggerUrl` the
 * answer names. A loopback HTTP server can therefore point the session at a
 * browser elsewhere — which is why the endpoint is only trusted as far as whoever
 * owns that port trusts it, and why a deployment that must pin the dialed address
 * writes a `ws` URL.
 */
function resolveCdpEndpoint(
  raw: QaBrowserConfig,
  mode: QaBrowserRuntimeMode,
): string | null {
  const endpoint = raw.runtime?.cdpEndpoint?.trim() || null;
  if (mode === "launch") {
    if (endpoint !== null) {
      throw new TypeError(
        "dsh-qa-browser: runtime.cdpEndpoint is only used when runtime.mode is attach",
      );
    }
    if (raw.runtime?.allowRemoteCdpEndpoint === true) {
      // The switch opens an endpoint, and this mode has none: a deployment that
      // wrote it would believe it had opened a door that leads nowhere.
      throw new TypeError(
        "dsh-qa-browser: runtime.allowRemoteCdpEndpoint only opens a runtime.cdpEndpoint, and runtime.mode launch has none",
      );
    }
    return null;
  }
  if (endpoint === null) {
    throw new TypeError(
      "dsh-qa-browser: runtime.cdpEndpoint is required when runtime.mode is attach",
    );
  }
  let url: URL | undefined;
  try {
    url = new URL(endpoint);
  } catch {
    // Nothing was parsed: the message below names the forms that work.
  }
  if (
    url === undefined ||
    !CDP_ENDPOINT_PROTOCOLS.has(url.protocol) ||
    url.hostname === ""
  ) {
    throw new TypeError(
      "dsh-qa-browser: runtime.cdpEndpoint must be an HTTP(S) or WS(S) URL, such as http://127.0.0.1:9222",
    );
  }
  if (
    !isLoopbackHost(url.hostname) &&
    !(raw.runtime?.allowRemoteCdpEndpoint ?? false)
  ) {
    throw new TypeError(
      "dsh-qa-browser: runtime.cdpEndpoint names a host outside this machine; set runtime.allowRemoteCdpEndpoint to true to attach to it",
    );
  }
  return endpoint;
}

export function resolveQaBrowserConfig(
  raw: QaBrowserConfig = {},
): ResolvedQaBrowserConfig {
  // The mode arrives from a config file, not from a TypeScript caller, so it is
  // checked rather than trusted. An unrecognised value would otherwise fall into
  // the launch path and resolve to a config that says something else.
  const writtenMode: string | undefined = raw.runtime?.mode;
  if (
    writtenMode !== undefined &&
    writtenMode !== "launch" &&
    writtenMode !== "attach"
  ) {
    throw new TypeError(
      `dsh-qa-browser: runtime.mode must be "launch" or "attach", not ${String(writtenMode)}`,
    );
  }
  const mode: QaBrowserRuntimeMode = writtenMode ?? "launch";
  const executable = raw.runtime?.executablePath?.trim() || null;
  if (executable !== null && !path.isAbsolute(executable)) {
    throw new TypeError(
      "dsh-qa-browser: runtime.executablePath must be absolute",
    );
  }
  // Attach borrows a browser this plugin neither starts nor can see, so it has
  // no window to show and must not claim one: `headless: false` in launch mode
  // means "a person may watch and click in that window", and attach mode offers
  // no such thing to the person running the browser.
  if (mode === "attach" && (raw.runtime?.headless ?? true) === false) {
    throw new TypeError(
      "dsh-qa-browser: runtime.headless cannot be false when runtime.mode is attach",
    );
  }
  // The same reasoning covers the knobs that choose and shape a process: under
  // `attach` there is no process to choose or shape, and a deployment that wrote
  // them expects them to hold. Silence here would be a config that lies.
  if (mode === "attach") {
    const channel = raw.runtime?.browserChannel?.trim() ?? "";
    const idle = [
      executable !== null ? "executablePath" : null,
      channel !== "" && channel !== "chromium" ? "browserChannel" : null,
      raw.runtime?.chromiumSandbox === false ? "chromiumSandbox" : null,
    ].filter((name): name is string => name !== null);
    if (idle.length > 0) {
      throw new TypeError(
        `dsh-qa-browser: runtime.${idle.join(" and runtime.")} configure a Chromium this runtime starts, and runtime.mode attach starts none`,
      );
    }
  }
  const cdpEndpoint = resolveCdpEndpoint(raw, mode);
  const allowedSchemes = [
    ...new Set(
      normalizedStrings(raw.security?.network?.allowedSchemes).map((value) =>
        value.endsWith(":") ? value.slice(0, -1) : value,
      ),
    ),
  ];
  return {
    enabled: raw.enabled ?? QA_BROWSER_DEFAULTS.enabled,
    runtime: {
      provider: "playwright",
      mode,
      executablePath: executable,
      browserChannel: raw.runtime?.browserChannel?.trim() || "chromium",
      cdpEndpoint,
      headless: raw.runtime?.headless ?? true,
      chromiumSandbox: raw.runtime?.chromiumSandbox ?? true,
      actionTimeoutMs: clampInteger(
        raw.runtime?.actionTimeoutMs,
        250,
        120_000,
        15_000,
      ),
      navigationTimeoutMs: clampInteger(
        raw.runtime?.navigationTimeoutMs,
        1_000,
        180_000,
        30_000,
      ),
      idleTimeoutMs:
        clampInteger(raw.runtime?.idleTimeoutMinutes, 1, 24 * 60, 30) * 60_000,
    },
    session: {
      contextScope: "session",
      maxTabs: clampInteger(raw.session?.maxTabs, 1, 32, 12),
    },
    viewport: {
      width: clampInteger(raw.viewport?.width, 320, 7_680, 1_440),
      height: clampInteger(raw.viewport?.height, 240, 4_320, 900),
      deviceScaleFactor: Math.min(
        4,
        Math.max(0.5, raw.viewport?.deviceScaleFactor ?? 1),
      ),
    },
    snapshots: {
      mode: raw.snapshots?.mode ?? "interactive",
      maxChars: clampInteger(raw.snapshots?.maxChars, 1_000, 100_000, 30_000),
      returnDeltaAfterActions: raw.snapshots?.returnDeltaAfterActions ?? true,
    },
    capabilities: {
      core: raw.capabilities?.core ?? true,
      vision: raw.capabilities?.vision ?? true,
      coordinateInput: raw.capabilities?.coordinateInput ?? true,
      devtools: raw.capabilities?.devtools ?? false,
      network: raw.capabilities?.network ?? false,
      trace: raw.capabilities?.trace ?? false,
      storage: raw.capabilities?.storage ?? false,
      downloads: raw.capabilities?.downloads ?? true,
      uploads: raw.capabilities?.uploads ?? false,
      unsafeEvaluate: raw.capabilities?.unsafeEvaluate ?? false,
    },
    ui: {
      autoRevealOnAgentActivity: raw.ui?.autoRevealOnAgentActivity ?? true,
      focusOnAutoReveal: raw.ui?.focusOnAutoReveal ?? false,
    },
    humanControl: (() => {
      const leaseSeconds = clampInteger(
        raw.humanControl?.leaseSeconds,
        5,
        300,
        30,
      );
      return {
        enabled: raw.humanControl?.enabled ?? true,
        leaseSeconds,
        leaseMs: leaseSeconds * 1_000,
      };
    })(),
    security: {
      network: {
        allowedSchemes:
          allowedSchemes.length === 0 ? ["http", "https"] : allowedSchemes,
        allowLoopback: raw.security?.network?.allowLoopback ?? true,
        allowPrivateNetworks:
          raw.security?.network?.allowPrivateNetworks ?? false,
        allowHosts: normalizedStrings(raw.security?.network?.allowHosts),
        denyHosts: normalizedStrings(raw.security?.network?.denyHosts),
        denyMetadataEndpoints:
          raw.security?.network?.denyMetadataEndpoints ?? true,
        denyDshOrigin: raw.security?.network?.denyDshOrigin ?? true,
        dshOrigins: (raw.security?.network?.dshOrigins ?? []).map((value) => {
          const origin = new URL(value).origin;
          if (origin === "null") {
            throw new TypeError(
              "dsh-qa-browser: security.network.dshOrigins must contain HTTP(S) origins",
            );
          }
          return origin;
        }),
      },
    },
  };
}
