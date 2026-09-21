import z from "@deepseek-ai/schemastery";
import { scopedConfigError } from "../../errors.js";

/**
 * One operator-declared Bitrix24 portal. A personal connection names its
 * portal implicitly, through the webhook URL; a managed service credential
 * needs the portal named by the deployment, because the profile binds to it —
 * the registry matches a profile to a connection by this host.
 */
export interface Bitrix24Instance {
  readonly id: string;
  readonly label: string;
  /** Portal hostname (lowercase, no scheme, no path), e.g. company.bitrix24.ru. */
  readonly portal: string;
}

/**
 * Deployment switches for the Bitrix24 provider. Every read scope is on by
 * default: a capability is offered to the agent only when the connected webhook
 * was actually granted the matching Bitrix24 scope, so these switches bound what
 * this deployment allows, they do not grant it. The write switch
 * (`crmCommentWrite`) is off by default and rides the same `crm` scope the read
 * switch uses — Bitrix24 has no read-only webhook scope.
 */
export interface Bitrix24Flags {
  readonly enabled: boolean;
  readonly crmRead: boolean;
  /**
   * Mounts the provider's only write tool, the timeline comment. A `crm`-scoped
   * webhook can write on its own, so this switch — not the scope probe — is
   * what bounds the deployment; the capability also starts policy-denied.
   */
  readonly crmCommentWrite: boolean;
  readonly chatRead: boolean;
  readonly openlinesRead: boolean;
  readonly userRead: boolean;
  readonly departmentRead: boolean;
  readonly tasksRead: boolean;
  readonly calendarRead: boolean;
  readonly diskRead: boolean;
  readonly instances: readonly Bitrix24Instance[];
}

export const BITRIX24_DEFAULTS: Bitrix24Flags = Object.freeze({
  enabled: true,
  crmRead: true,
  crmCommentWrite: false,
  chatRead: true,
  openlinesRead: true,
  userRead: true,
  departmentRead: true,
  tasksRead: true,
  calendarRead: true,
  diskRead: true,
  instances: Object.freeze([]),
});

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const MAX_INSTANCES = 16;

const configError = scopedConfigError("bitrix24 integration config");

/**
 * Accept either a bare hostname or a full portal URL and keep the lowercase
 * hostname: the value is compared with the host a webhook URL reports, so
 * `https://company.bitrix24.ru/` and `company.bitrix24.ru` must land on one
 * string. A typo has to fail the config load loudly — a silently mangled
 * portal would leave service profiles no connection can ever match.
 */
function normalizePortal(input: unknown, index: number): string {
  const raw = typeof input === "string" ? input.trim() : "";
  let host = raw;
  if (raw.includes("://")) {
    try {
      host = new URL(raw).hostname;
    } catch {
      throw configError(`instances[${index}].portal must be a valid URL`);
    }
  }
  const normalized = host.toLowerCase();
  if (
    normalized === "" ||
    normalized.includes("/") ||
    normalized.includes("?") ||
    normalized.includes("@")
  ) {
    throw configError(
      `instances[${index}].portal must be a bare hostname such as company.bitrix24.ru`,
    );
  }
  return normalized;
}

function normalizeInstance(
  input: unknown,
  index: number,
  seen: Set<string>,
): Bitrix24Instance {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw configError(`instances[${index}] must be a mapping`);
  }
  const record = input as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? record["id"].trim() : "";
  if (!INSTANCE_ID.test(id)) {
    throw configError(
      `instances[${index}].id must be lowercase latin, digits or dashes`,
    );
  }
  if (seen.has(id)) throw configError(`instances[${index}].id is a duplicate`);
  seen.add(id);
  const rawLabel = typeof record["label"] === "string" ? record["label"] : "";
  const label = rawLabel.trim();
  return Object.freeze({
    id,
    label: label === "" ? id : label,
    portal: normalizePortal(record["portal"], index),
  });
}

function normalizeInstances(input: unknown): readonly Bitrix24Instance[] {
  if (input === undefined || input === null) {
    return BITRIX24_DEFAULTS.instances;
  }
  if (!Array.isArray(input)) throw configError("instances must be a list");
  if (input.length > MAX_INSTANCES) {
    throw configError(`instances accepts at most ${MAX_INSTANCES} entries`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    input.map((entry, index) => normalizeInstance(entry, index, seen)),
  );
}

/** Config slice of this provider, as it appears under `bitrix24:` in YAML. */
export const bitrix24ConfigSchema = z.object({
  enabled: z.boolean().default(BITRIX24_DEFAULTS.enabled),
  crmRead: z.boolean().default(BITRIX24_DEFAULTS.crmRead),
  crmCommentWrite: z.boolean().default(BITRIX24_DEFAULTS.crmCommentWrite),
  chatRead: z.boolean().default(BITRIX24_DEFAULTS.chatRead),
  openlinesRead: z.boolean().default(BITRIX24_DEFAULTS.openlinesRead),
  userRead: z.boolean().default(BITRIX24_DEFAULTS.userRead),
  departmentRead: z.boolean().default(BITRIX24_DEFAULTS.departmentRead),
  tasksRead: z.boolean().default(BITRIX24_DEFAULTS.tasksRead),
  calendarRead: z.boolean().default(BITRIX24_DEFAULTS.calendarRead),
  diskRead: z.boolean().default(BITRIX24_DEFAULTS.diskRead),
  instances: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        portal: z.string(),
      }),
    )
    .default([]),
}) as unknown as z<Partial<Bitrix24Flags>>;

export function resolveBitrix24Config(
  input: Partial<Bitrix24Flags> = {},
): Bitrix24Flags {
  return Object.freeze({
    enabled: input.enabled ?? BITRIX24_DEFAULTS.enabled,
    crmRead: input.crmRead ?? BITRIX24_DEFAULTS.crmRead,
    crmCommentWrite: input.crmCommentWrite ?? BITRIX24_DEFAULTS.crmCommentWrite,
    chatRead: input.chatRead ?? BITRIX24_DEFAULTS.chatRead,
    openlinesRead: input.openlinesRead ?? BITRIX24_DEFAULTS.openlinesRead,
    userRead: input.userRead ?? BITRIX24_DEFAULTS.userRead,
    departmentRead: input.departmentRead ?? BITRIX24_DEFAULTS.departmentRead,
    tasksRead: input.tasksRead ?? BITRIX24_DEFAULTS.tasksRead,
    calendarRead: input.calendarRead ?? BITRIX24_DEFAULTS.calendarRead,
    diskRead: input.diskRead ?? BITRIX24_DEFAULTS.diskRead,
    instances: normalizeInstances(input.instances),
  });
}
