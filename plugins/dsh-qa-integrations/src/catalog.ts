import type { Bitrix24Flags, IntegrationCapability } from "./types.js";

/**
 * One capability per Bitrix24 scope. `scopes` is the set of webhook scopes that
 * grant it; the provider intersects them with the scopes the connected webhook
 * actually reports, and `flag` is the operator switch for this deployment.
 *
 * Labels live here so the host, the Settings card, and package verification all
 * describe a capability the same way.
 */
export interface Bitrix24CapabilityDefinition {
  readonly capability: IntegrationCapability;
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
}

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
  },
  "crm.get": { capability: "crm.read", method: "crm.item.get" },
  "crm.fields": { capability: "crm.read", method: "crm.item.fields" },
  "crm.funnels": {
    capability: "crm.read",
    method: "crm.category.list",
    list: "categories",
  },
  "crm.statuses": {
    capability: "crm.read",
    method: "crm.status.list",
    list: "self",
  },
  "crm.activities": {
    capability: "crm.read",
    method: "crm.activity.list",
    list: "self",
  },
  "crm.activity": { capability: "crm.read", method: "crm.activity.get" },
  "crm.timeline": {
    capability: "crm.read",
    method: "crm.timeline.comment.list",
    list: "self",
  },
  "crm.stageHistory": {
    capability: "crm.read",
    method: "crm.stagehistory.list",
    list: "items",
  },
  "crm.productRows": {
    capability: "crm.read",
    method: "crm.item.productrow.list",
    list: "productRows",
  },
  "crm.duplicates": {
    capability: "crm.read",
    method: "crm.duplicate.findbycomm",
  },
  "user.current": { capability: "user.read", method: "user.current" },
  /**
   * Bitrix24 documents `user.search` inconsistently (the parameter table wants
   * FIND inside `FILTER`, every example puts filter keys at the top level), so
   * the catalog calls `user.get` instead: `FILTER` there has one documented
   * shape and `NAME_SEARCH` gives the same accelerated name search.
   */
  "user.list": { capability: "user.read", method: "user.get", list: "self" },
  "user.departments": {
    capability: "department.read",
    method: "department.get",
    list: "self",
  },
  "chat.search": {
    capability: "chat.read",
    method: "im.search.chat.list",
    list: "self",
  },
  "chat.messages": {
    capability: "chat.read",
    method: "im.dialog.messages.get",
  },
  "chat.messageSearch": {
    capability: "chat.read",
    method: "im.dialog.messages.search",
  },
  "chat.recent": {
    capability: "chat.read",
    method: "im.recent.get",
    list: "self",
  },
  "chat.users": {
    capability: "chat.read",
    method: "im.search.user.list",
    list: "map",
  },
  "openlines.dialog": {
    capability: "openlines.read",
    method: "imopenlines.dialog.get",
  },
  "openlines.history": {
    capability: "openlines.read",
    method: "imopenlines.session.history.get",
  },
  "tasks.list": {
    capability: "tasks.read",
    method: "tasks.task.list",
    list: "tasks",
  },
  "tasks.get": { capability: "tasks.read", method: "tasks.task.get" },
  "calendar.events": {
    capability: "calendar.read",
    method: "calendar.event.get",
    list: "self",
  },
  "calendar.accessibility": {
    capability: "calendar.read",
    method: "calendar.accessibility.get",
  },
  "disk.search": {
    capability: "disk.read",
    method: "disk.file.search",
    list: "self",
  },
  "disk.file": { capability: "disk.read", method: "disk.file.get" },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: Bitrix24Flags,
): readonly IntegrationCapability[] {
  return BITRIX_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}
