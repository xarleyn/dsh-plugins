import z from "@deepseek-ai/schemastery";

export interface UserCorrectionMinerConfig {
  readonly enabled?: boolean;
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
