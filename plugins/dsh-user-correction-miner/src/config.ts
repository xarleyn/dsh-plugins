import z from "@deepseek-ai/schemastery";

export interface UserCorrectionMinerConfig {
  readonly enabled?: boolean;
  readonly retention?: {
    readonly maxRecordsPerWorkspace?: number;
  };
  readonly live?: {
    readonly maxPendingSessions?: number;
    readonly maxPendingEventsPerSession?: number;
    readonly pendingTtlMs?: number;
  };
  readonly analysis?: {
    readonly maxContextEvents?: number;
    readonly maxContextBytes?: number;
  };
  readonly privacy?: {
    readonly redactSecrets?: boolean;
    readonly persistRawMessages?: boolean;
    readonly maxStoredTextChars?: number;
  };
}

export interface ResolvedUserCorrectionMinerConfig {
  readonly enabled: boolean;
  readonly retention: {
    readonly maxRecordsPerWorkspace: number;
  };
  readonly live: {
    readonly maxPendingSessions: number;
    readonly maxPendingEventsPerSession: number;
    readonly pendingTtlMs: number;
  };
  readonly analysis: {
    readonly maxContextEvents: number;
    readonly maxContextBytes: number;
  };
  readonly privacy: {
    readonly redactSecrets: boolean;
    readonly persistRawMessages: boolean;
    readonly maxStoredTextChars: number;
  };
}

export const DEFAULT_CONFIG: ResolvedUserCorrectionMinerConfig = {
  enabled: true,
  retention: {
    maxRecordsPerWorkspace: 1_000,
  },
  live: {
    maxPendingSessions: 256,
    maxPendingEventsPerSession: 32,
    pendingTtlMs: 30 * 60 * 1_000,
  },
  analysis: {
    maxContextEvents: 20,
    maxContextBytes: 32_768,
  },
  privacy: {
    redactSecrets: true,
    persistRawMessages: false,
    maxStoredTextChars: 512,
  },
};

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function resolveConfig(config: UserCorrectionMinerConfig = {}): ResolvedUserCorrectionMinerConfig {
  return {
    enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
    retention: {
      maxRecordsPerWorkspace: positiveInteger(
        "retention.maxRecordsPerWorkspace",
        config.retention?.maxRecordsPerWorkspace,
        DEFAULT_CONFIG.retention.maxRecordsPerWorkspace,
      ),
    },
    live: {
      maxPendingSessions: positiveInteger(
        "live.maxPendingSessions",
        config.live?.maxPendingSessions,
        DEFAULT_CONFIG.live.maxPendingSessions,
      ),
      maxPendingEventsPerSession: positiveInteger(
        "live.maxPendingEventsPerSession",
        config.live?.maxPendingEventsPerSession,
        DEFAULT_CONFIG.live.maxPendingEventsPerSession,
      ),
      pendingTtlMs: positiveInteger(
        "live.pendingTtlMs",
        config.live?.pendingTtlMs,
        DEFAULT_CONFIG.live.pendingTtlMs,
      ),
    },
    analysis: {
      maxContextEvents: positiveInteger(
        "analysis.maxContextEvents",
        config.analysis?.maxContextEvents,
        DEFAULT_CONFIG.analysis.maxContextEvents,
      ),
      maxContextBytes: positiveInteger(
        "analysis.maxContextBytes",
        config.analysis?.maxContextBytes,
        DEFAULT_CONFIG.analysis.maxContextBytes,
      ),
    },
    privacy: {
      redactSecrets: config.privacy?.redactSecrets ?? DEFAULT_CONFIG.privacy.redactSecrets,
      persistRawMessages:
        config.privacy?.persistRawMessages ?? DEFAULT_CONFIG.privacy.persistRawMessages,
      maxStoredTextChars: positiveInteger(
        "privacy.maxStoredTextChars",
        config.privacy?.maxStoredTextChars,
        DEFAULT_CONFIG.privacy.maxStoredTextChars,
      ),
    },
  };
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  retention: z
    .object({
      maxRecordsPerWorkspace: z.number().default(DEFAULT_CONFIG.retention.maxRecordsPerWorkspace),
    })
    .default(DEFAULT_CONFIG.retention),
  live: z
    .object({
      maxPendingSessions: z.number().default(DEFAULT_CONFIG.live.maxPendingSessions),
      maxPendingEventsPerSession: z.number().default(
        DEFAULT_CONFIG.live.maxPendingEventsPerSession,
      ),
      pendingTtlMs: z.number().default(DEFAULT_CONFIG.live.pendingTtlMs),
    })
    .default(DEFAULT_CONFIG.live),
  analysis: z
    .object({
      maxContextEvents: z.number().default(DEFAULT_CONFIG.analysis.maxContextEvents),
      maxContextBytes: z.number().default(DEFAULT_CONFIG.analysis.maxContextBytes),
    })
    .default(DEFAULT_CONFIG.analysis),
  privacy: z
    .object({
      redactSecrets: z.boolean().default(DEFAULT_CONFIG.privacy.redactSecrets),
      persistRawMessages: z.boolean().default(DEFAULT_CONFIG.privacy.persistRawMessages),
      maxStoredTextChars: z.number().default(DEFAULT_CONFIG.privacy.maxStoredTextChars),
    })
    .default(DEFAULT_CONFIG.privacy),
});
