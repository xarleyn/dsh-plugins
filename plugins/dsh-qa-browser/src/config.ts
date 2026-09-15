import path from "node:path";

import z from "@deepseek-ai/schemastery";

export interface QaBrowserConfig {
  readonly enabled?: boolean;
  readonly runtime?: {
    readonly provider?: "playwright";
    readonly executablePath?: string | null;
    readonly browserChannel?: string;
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
    readonly executablePath: string | null;
    readonly browserChannel: string;
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
    executablePath: null,
    browserChannel: "chromium",
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
        executablePath: nullableString.default(null),
        browserChannel: z.string().default("chromium"),
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
      .description("Playwright process and timeout settings."),
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

export function resolveQaBrowserConfig(
  raw: QaBrowserConfig = {},
): ResolvedQaBrowserConfig {
  const executable = raw.runtime?.executablePath?.trim() || null;
  if (executable !== null && !path.isAbsolute(executable)) {
    throw new TypeError(
      "dsh-qa-browser: runtime.executablePath must be absolute",
    );
  }
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
      executablePath: executable,
      browserChannel: raw.runtime?.browserChannel?.trim() || "chromium",
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
      autoRevealOnAgentActivity:
        raw.ui?.autoRevealOnAgentActivity ?? true,
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
