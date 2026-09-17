import z from "@deepseek-ai/schemastery";

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
});

/** Config slice of this provider, as it appears under `bitrix24:` in YAML. */
export const bitrix24ConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    crmRead: z.boolean().default(true),
    crmCommentWrite: z.boolean().default(false),
    chatRead: z.boolean().default(true),
    openlinesRead: z.boolean().default(true),
    userRead: z.boolean().default(true),
    departmentRead: z.boolean().default(true),
    tasksRead: z.boolean().default(true),
    calendarRead: z.boolean().default(true),
    diskRead: z.boolean().default(true),
  })
  .default(BITRIX24_DEFAULTS);

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
  });
}
