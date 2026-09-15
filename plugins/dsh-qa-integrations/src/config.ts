import path from "node:path";
import z from "@deepseek-ai/schemastery";
import type {
  Bitrix24Flags,
  QaIntegrationsConfig,
  ResolvedQaIntegrationsConfig,
} from "./types.js";

/**
 * Every read scope is on by default: a capability is offered to the agent only
 * when the connected webhook was actually granted the matching Bitrix24 scope,
 * so these switches bound what this deployment allows, they do not grant it.
 */
const BITRIX24_DEFAULTS: Bitrix24Flags = {
  enabled: true,
  crmRead: true,
  chatRead: true,
  openlinesRead: true,
  userRead: true,
  departmentRead: true,
  tasksRead: true,
  calendarRead: true,
  diskRead: true,
};

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
      openlinesRead: z.boolean().default(true),
      userRead: z.boolean().default(true),
      departmentRead: z.boolean().default(true),
      tasksRead: z.boolean().default(true),
      calendarRead: z.boolean().default(true),
      diskRead: z.boolean().default(true),
    })
    .default(BITRIX24_DEFAULTS),
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
  const bitrix24 = input.bitrix24 ?? {};
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
      enabled: bitrix24.enabled ?? BITRIX24_DEFAULTS.enabled,
      crmRead: bitrix24.crmRead ?? BITRIX24_DEFAULTS.crmRead,
      chatRead: bitrix24.chatRead ?? BITRIX24_DEFAULTS.chatRead,
      openlinesRead: bitrix24.openlinesRead ?? BITRIX24_DEFAULTS.openlinesRead,
      userRead: bitrix24.userRead ?? BITRIX24_DEFAULTS.userRead,
      departmentRead:
        bitrix24.departmentRead ?? BITRIX24_DEFAULTS.departmentRead,
      tasksRead: bitrix24.tasksRead ?? BITRIX24_DEFAULTS.tasksRead,
      calendarRead: bitrix24.calendarRead ?? BITRIX24_DEFAULTS.calendarRead,
      diskRead: bitrix24.diskRead ?? BITRIX24_DEFAULTS.diskRead,
    }),
  });
}
