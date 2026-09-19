import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type { Bitrix24Flags } from "./config.js";

/**
 * Capabilities this provider can offer, one per Bitrix24 webhook scope. `scopes`
 * is the set of scopes that grant it; the provider intersects them with the
 * scopes the connected webhook actually reports, and `flag` is the operator
 * switch for this deployment.
 *
 * Labels live here so the host, the Settings card, and package verification all
 * describe a capability the same way.
 */
export type Bitrix24Capability =
  | "crm.read"
  | "crm.comment.write"
  | "chat.read"
  | "openlines.read"
  | "user.read"
  | "department.read"
  | "tasks.read"
  | "calendar.read"
  | "disk.read";

export interface Bitrix24CapabilityDefinition {
  readonly capability: Bitrix24Capability;
  readonly flag: Exclude<keyof Bitrix24Flags, "enabled">;
  readonly scopes: readonly string[];
  readonly label: string;
  readonly hint: string;
}

export const BITRIX_CAPABILITIES: readonly Bitrix24CapabilityDefinition[] =
  Object.freeze([
    {
      capability: "crm.read",
      flag: "crmRead",
      scopes: ["crm"],
      label: "Читать CRM",
      hint: "Лиды, сделки, контакты, компании, дела, таймлайн, товарные строки",
    },
    {
      capability: "crm.comment.write",
      flag: "crmCommentWrite",
      scopes: ["crm"],
      label: "Комментировать CRM",
      hint:
        "Комментарий в таймлайн лида, сделки, контакта или компании " +
        "(единственная операция записи). Вебхук со скоупом crm умеет писать " +
        "и сам — гейт здесь только конфиг-флаг и политика доступа.",
    },
    {
      capability: "chat.read",
      flag: "chatRead",
      scopes: ["im"],
      label: "Читать чаты",
      hint: "Чаты, сообщения, участники и поиск по переписке",
    },
    {
      capability: "openlines.read",
      flag: "openlinesRead",
      scopes: ["imopenlines"],
      label: "Читать открытые линии",
      hint: "Диалоги с клиентами из открытых линий и их история",
    },
    {
      capability: "user.read",
      flag: "userRead",
      scopes: ["user", "user_basic", "user_brief"],
      label: "Читать сотрудников",
      hint: "Свой профиль и поиск сотрудников по имени, e-mail, отделу",
    },
    {
      capability: "department.read",
      flag: "departmentRead",
      scopes: ["department"],
      label: "Читать структуру компании",
      hint: "Подразделения, родительские отделы и руководители",
    },
    {
      capability: "tasks.read",
      flag: "tasksRead",
      scopes: ["task"],
      label: "Читать задачи",
      hint: "Задачи по фильтрам и полная карточка задачи",
    },
    {
      capability: "calendar.read",
      flag: "calendarRead",
      scopes: ["calendar"],
      label: "Читать календарь",
      hint: "События календаря и занятость сотрудников",
    },
    {
      capability: "disk.read",
      flag: "diskRead",
      scopes: ["disk"],
      label: "Читать файлы Диска",
      hint: "Поиск по файлам и папкам, включая текст внутри документов",
    },
  ]);

/**
 * What a list operation returns in `result`, so every list tool can answer with
 * the same `items` envelope:
 *
 * - `self` — `result` is the array itself;
 * - `map` — `result` is an object keyed by id, values are the items;
 * - any other value — the name of the key inside `result` that holds the array.
 */
export type BitrixListShape = "self" | "map" | (string & {});

export interface BitrixOperationDefinition {
  readonly capability: IntegrationCapability;
  /** REST method as called over the webhook, without the `.json` suffix. */
  readonly method: string;
  readonly list?: BitrixListShape;
  /**
   * Security classification for the managed service credential. Bitrix24 has
   * no project tree, so the resource a service call has to stay inside is the
   * portal itself: every boundary-required operation names the `"portals"`
   * kind, and the profile's `resources.portals` has to name the portal host.
   */
  readonly security: OperationSecurityMetadata;
}

/** A read of the connected identity alone: no resource, nothing personal. */
const IDENTITY_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

/**
 * A read of CRM entities, tasks or the department tree. Bitrix24 scopes these
 * by portal rather than by project, so the boundary the call has to stay
 * inside is the portal the profile names — which is what a service account is
 * for, because it can see far more than the user it stands in for.
 */
const PORTAL_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read that stays personal even though it is "only" a read: message
 * histories, call transcripts, employee directories with e-mails and phones,
 * calendars and disk files carry private conversations, contact data and
 * other people's uploaded bytes — exactly what a shared account must not hand
 * one user on another's behalf.
 */
const SENSITIVE_READ = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/** The timeline comment is the provider's one write; never service-reachable. */
const WRITE = {
  effect: "write",
  sensitivity: "normal",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `requiredCapability` — is the
 * permission surface.
 */
export const BITRIX_OPERATIONS: Readonly<
  Record<string, BitrixOperationDefinition>
> = Object.freeze({
  "crm.search": {
    capability: "crm.read",
    method: "crm.item.list",
    list: "items",
    security: PORTAL_READ,
  },
  "crm.timelineCommentAdd": {
    capability: "crm.comment.write",
    method: "crm.timeline.comment.add",
    security: WRITE,
  },
  "crm.get": {
    capability: "crm.read",
    method: "crm.item.get",
    security: PORTAL_READ,
  },
  "crm.fields": {
    capability: "crm.read",
    method: "crm.item.fields",
    security: PORTAL_READ,
  },
  "crm.funnels": {
    capability: "crm.read",
    method: "crm.category.list",
    list: "categories",
    security: PORTAL_READ,
  },
  "crm.statuses": {
    capability: "crm.read",
    method: "crm.status.list",
    list: "self",
    security: PORTAL_READ,
  },
  "crm.activities": {
    capability: "crm.read",
    method: "crm.activity.list",
    list: "self",
    security: PORTAL_READ,
  },
  "crm.activity": {
    capability: "crm.read",
    method: "crm.activity.get",
    security: PORTAL_READ,
  },
  "crm.timeline": {
    capability: "crm.read",
    method: "crm.timeline.comment.list",
    list: "self",
    security: PORTAL_READ,
  },
  "crm.stageHistory": {
    capability: "crm.read",
    method: "crm.stagehistory.list",
    list: "items",
    security: PORTAL_READ,
  },
  "crm.productRows": {
    capability: "crm.read",
    method: "crm.item.productrow.list",
    list: "productRows",
    security: PORTAL_READ,
  },
  /**
   * A duplicate search is a lookup of a contact by someone's phone number or
   * e-mail: through a shared account it would answer "who owns this number"
   * to anyone the deployment lent the credential to, so it stays personal.
   */
  "crm.duplicates": {
    capability: "crm.read",
    method: "crm.duplicate.findbycomm",
    security: SENSITIVE_READ,
  },
  "crm.requisites": {
    capability: "crm.read",
    method: "crm.requisite.list",
    list: "self",
    security: PORTAL_READ,
  },
  /**
   * A call transcript is the text of a recorded phone call — a private
   * conversation, not a CRM record, and it stays personal the same way chat
   * messages do.
   */
  "crm.callTranscript": {
    capability: "crm.read",
    method: "crm.activity.call.getTranscript",
    security: SENSITIVE_READ,
  },
  "user.current": {
    capability: "user.read",
    method: "user.current",
    security: IDENTITY_READ,
  },
  /**
   * Bitrix24 documents `user.search` inconsistently (the parameter table wants
   * FIND inside `FILTER`, every example puts filter keys at the top level), so
   * the catalog calls `user.get` instead: `FILTER` there has one documented
   * shape and `NAME_SEARCH` gives the same accelerated name search.
   */
  /**
   * The employee directory answers with e-mail addresses and phone numbers of
   * everyone on the portal; a shared account asking for it is a people lookup,
   * so the directory stays personal. `user.current` above reads only the
   * identity the credential itself carries.
   */
  "user.list": {
    capability: "user.read",
    method: "user.get",
    list: "self",
    security: SENSITIVE_READ,
  },
  "user.fields": {
    capability: "user.read",
    method: "user.fields",
    security: IDENTITY_READ,
  },
  "user.departments": {
    capability: "department.read",
    method: "department.get",
    list: "self",
    security: PORTAL_READ,
  },
  "chat.search": {
    capability: "chat.read",
    method: "im.search.chat.list",
    list: "self",
    security: SENSITIVE_READ,
  },
  "chat.messages": {
    capability: "chat.read",
    method: "im.dialog.messages.get",
    security: SENSITIVE_READ,
  },
  "chat.messageSearch": {
    capability: "chat.read",
    method: "im.dialog.messages.search",
    security: SENSITIVE_READ,
  },
  "chat.recent": {
    capability: "chat.read",
    method: "im.recent.get",
    list: "self",
    security: SENSITIVE_READ,
  },
  "chat.users": {
    capability: "chat.read",
    method: "im.search.user.list",
    list: "map",
    security: SENSITIVE_READ,
  },
  "chat.find": {
    capability: "chat.read",
    method: "im.chat.get",
    security: SENSITIVE_READ,
  },
  "chat.participants": {
    capability: "chat.read",
    method: "im.chat.user.list",
    list: "self",
    security: SENSITIVE_READ,
  },
  "chat.userData": {
    capability: "chat.read",
    method: "im.user.list.get",
    list: "self",
    security: SENSITIVE_READ,
  },
  "openlines.dialog": {
    capability: "openlines.read",
    method: "imopenlines.dialog.get",
    security: SENSITIVE_READ,
  },
  "openlines.history": {
    capability: "openlines.read",
    method: "imopenlines.session.history.get",
    security: SENSITIVE_READ,
  },
  "tasks.list": {
    capability: "tasks.read",
    method: "tasks.task.list",
    list: "tasks",
    security: PORTAL_READ,
  },
  "tasks.get": {
    capability: "tasks.read",
    method: "tasks.task.get",
    security: PORTAL_READ,
  },
  "tasks.history": {
    capability: "tasks.read",
    method: "tasks.task.history.list",
    list: "list",
    security: PORTAL_READ,
  },
  "tasks.results": {
    capability: "tasks.read",
    method: "tasks.task.result.list",
    list: "self",
    security: PORTAL_READ,
  },
  /**
   * The only operation with a positional body: Bitrix24 documents that
   * `task.elapseditem.getlist` takes `[taskId, order, filter, select, params]`
   * as a JSON array and fails when they arrive as named fields.
   */
  "tasks.elapsed": {
    capability: "tasks.read",
    method: "task.elapseditem.getlist",
    list: "self",
    security: PORTAL_READ,
  },
  /**
   * A calendar answers with the schedules and free/busy patterns of the
   * portal's people; that is presence data about individuals, so it stays
   * personal.
   */
  "calendar.events": {
    capability: "calendar.read",
    method: "calendar.event.get",
    list: "self",
    security: SENSITIVE_READ,
  },
  "calendar.accessibility": {
    capability: "calendar.read",
    method: "calendar.accessibility.get",
    security: SENSITIVE_READ,
  },
  /**
   * Disk reads answer with files the portal's users have uploaded; a shared
   * account reading arbitrary user-uploaded bytes is the same reason CI logs
   * stay personal in the reference providers.
   */
  "disk.search": {
    capability: "disk.read",
    method: "disk.file.search",
    list: "self",
    security: SENSITIVE_READ,
  },
  "disk.file": {
    capability: "disk.read",
    method: "disk.file.get",
    security: SENSITIVE_READ,
  },
  "disk.storages": {
    capability: "disk.read",
    method: "disk.storage.getList",
    list: "self",
    security: SENSITIVE_READ,
  },
  "disk.storageChildren": {
    capability: "disk.read",
    method: "disk.storage.getChildren",
    list: "self",
    security: SENSITIVE_READ,
  },
  "disk.folderChildren": {
    capability: "disk.read",
    method: "disk.folder.getChildren",
    list: "self",
    security: SENSITIVE_READ,
  },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: Bitrix24Flags,
): readonly Bitrix24Capability[] {
  return BITRIX_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const BITRIX24_CAPABILITY_INFO: Readonly<
  Record<Bitrix24Capability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    BITRIX_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<Bitrix24Capability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function bitrix24OperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return BITRIX_OPERATIONS[operation]?.capability;
}
