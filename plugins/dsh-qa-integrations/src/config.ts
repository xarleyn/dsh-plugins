import path from "node:path";
import z from "@deepseek-ai/schemastery";
import type {
  QaIntegrationsConfig,
  ResolvedQaIntegrationsConfig,
} from "./types.js";

export const ConfigSchema: z<QaIntegrationsConfig> = z.object({
  enabled: z.boolean().default(false),
  dataPath: z.string(),
  masterKeyPath: z.string().default("/run/secrets/qa_integrations_master_key"),
  masterKeyVersion: z.number().step(1).min(1).default(1),
  timeoutMs: z.number().step(1).min(1).default(15_000),
  maxResponseBytes: z.number().step(1).min(1).default(2_000_000),
  allowedPortalSuffixes: z
    .array(z.string())
    .default([".bitrix24.ru", ".bitrix24.com", ".bitrix24.eu"]),
  bitrix24: z
    .object({
      enabled: z.boolean().default(true),
      crmRead: z.boolean().default(true),
      chatRead: z.boolean().default(true),
    })
    .default({ enabled: true, crmRead: true, chatRead: true }),
});

export function resolveConfig(
  input: QaIntegrationsConfig = {},
): ResolvedQaIntegrationsConfig {
  const dshHome = process.env.DSH_HOME?.trim();
  const base =
    dshHome === undefined || dshHome === "" ? process.cwd() : dshHome;
  const suffixes = (
    input.allowedPortalSuffixes ?? [
      ".bitrix24.ru",
      ".bitrix24.com",
      ".bitrix24.eu",
    ]
  )
    .map((suffix) => suffix.trim().toLowerCase())
    .filter((suffix) => suffix.startsWith(".") && suffix.length > 1);
  return Object.freeze({
    enabled: input.enabled ?? false,
    dataPath: input.dataPath?.trim() || path.join(base, "qa-integrations.json"),
    masterKeyPath:
      input.masterKeyPath?.trim() || "/run/secrets/qa_integrations_master_key",
    masterKeyVersion: input.masterKeyVersion ?? 1,
    timeoutMs: input.timeoutMs ?? 15_000,
    maxResponseBytes: input.maxResponseBytes ?? 2_000_000,
    allowedPortalSuffixes: Object.freeze(suffixes),
    bitrix24: Object.freeze({
      enabled: input.bitrix24?.enabled ?? true,
      crmRead: input.bitrix24?.crmRead ?? true,
      chatRead: input.bitrix24?.chatRead ?? true,
    }),
  });
}
