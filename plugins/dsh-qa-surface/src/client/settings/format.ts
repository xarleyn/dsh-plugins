/**
 * Pure presentation helpers of the QA Surface settings card.
 *
 * Kept out of the components so the wording and the draft parsing are
 * unit-testable without a DOM, and so every place that renders the same value
 * renders it identically. Nothing here may reach the Host config surface: the
 * card bundle must not pull schemastery into the page.
 */

import type { QaSurfaceConfig } from "../../types.js";

/** A control's label with the sentence explaining what it does. */
export interface DescribedOption {
  readonly label: string;
  readonly hint: string;
}

/**
 * Header badge: the route the page answers on, or that the surface is off.
 * The route is the one fact an operator scanning the plugin list looks for.
 */
export function badgeText(
  enabled: boolean | undefined,
  routePath: string | undefined,
): string {
  if (enabled === false) return "Выключено";
  return routePath === undefined || routePath === "" ? "/qa" : routePath;
}

/** Wording of the session-policy control. */
export function describeSessionPolicy(
  policy: string | undefined,
): DescribedOption {
  switch (policy) {
    case "new-on-load":
      return {
        label: "Новый чат при каждой загрузке",
        hint: "Каждый заход начинается с пустой беседы; прошлые чаты остаются в истории хоста.",
      };
    case "fixed":
      return {
        label: "Один фиксированный чат",
        hint: "Все посетители работают в одной заранее созданной сессии.",
      };
    case "browser-persistent":
      return {
        label: "Чат закреплён за браузером",
        hint: "Перезагрузка страницы возвращает ту же беседу этого браузера.",
      };
    default:
      return {
        label: "Чат закреплён за браузером",
        hint: "Перезагрузка страницы возвращает ту же беседу этого браузера.",
      };
  }
}

/** Wording of the sandbox-mode control. */
export function describeSandbox(mode: string | undefined): DescribedOption {
  switch (mode) {
    case "workspace-write":
      return {
        label: "Запись в рабочее пространство",
        hint: "Допустима только вместе с персональными рабочими пространствами аккаунтов.",
      };
    default:
      return {
        label: "Только чтение",
        hint: "Инструменты не могут изменить рабочую директорию сессии.",
      };
  }
}

/**
 * Parse a numeric control's draft text.
 * @param text - raw input value.
 * @param min - lowest accepted value, clamped into range on commit.
 * @param max - highest accepted value, clamped into range on commit.
 * @returns the integer, or null when the field is empty or not numeric (the
 * caller leaves the stored value alone rather than writing a NaN).
 */
export function parseNumberDraft(
  text: string,
  min: number,
  max: number,
): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Parse a one-entry-per-line list control's draft text. Questions and phrases
 * are free copy, so a comma inside an entry must stay part of that entry.
 */
export function parseLineList(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Parse a list control whose entries may also be comma-separated. */
export function parseCommaList(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** One declared identity field as the operator writes it. */
export interface IdentityFieldDraft {
  readonly key: string;
  readonly label: string;
}

/** Identity keys are lowercase labels; the same shape the Host enforces. */
const IDENTITY_KEY = /^[a-z][a-z0-9_-]{0,31}$/u;

/** Longest accepted display label of one identity field (Host rule). */
const IDENTITY_LABEL_MAX = 40;

/**
 * Parse the identity-field control: one `key = подпись` entry per line. A
 * missing label falls back to the key, and an entry whose key cannot exist on
 * the Host is dropped here rather than refused as a whole write.
 */
export function parseIdentityFields(text: string): IdentityFieldDraft[] {
  const fields: IdentityFieldDraft[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const [rawKey = "", ...rest] = line.split("=");
    const key = rawKey.trim().toLowerCase();
    if (!IDENTITY_KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    const label = rest.join("=").trim().slice(0, IDENTITY_LABEL_MAX);
    fields.push({ key, label: label === "" ? key : label });
  }
  return fields;
}

/** Render declared identity fields back into the control's draft text. */
export function formatIdentityFields(
  fields: readonly IdentityFieldDraft[] | undefined,
): string {
  return (fields ?? [])
    .map((field) => `${field.key} = ${field.label}`)
    .join("\n");
}

/**
 * Prerequisites `accounts.perUserWorkspace` cannot run without. The Host
 * refuses the configuration while any of them is unmet, and the sandbox mode
 * is the one entry the card must write together with the flag: both
 * `workspace-write` alone and per-user workspaces alone are refused.
 */
export function perUserWorkspaceGaps(config: QaSurfaceConfig): string[] {
  const gaps: string[] = [];
  if (config.accounts?.enabled !== true) gaps.push("включены аккаунты");
  if ((config.session?.workspaceId ?? null) === null)
    gaps.push("задан session.workspaceId");
  if (config.session?.policy === "fixed")
    gaps.push("политика сессии не «фиксированный чат»");
  if (config.lockdown?.enabled !== true) gaps.push("включена блокировка");
  if (config.lockdown?.enforceFixedWorkspace !== true)
    gaps.push("включён lockdown.enforceFixedWorkspace");
  if (config.lockdown?.sandboxMode !== "workspace-write")
    gaps.push("sandboxMode = «запись в рабочее пространство»");
  return gaps;
}

/**
 * Whether the raw user layer carries this path, which is what marks a field
 * overridden — a value equal to the composition default is still an override.
 * @param user - raw user section from the settings snapshot.
 * @param path - path from the section root.
 * @returns true when every segment exists in the user layer.
 */
export function isOverridden(user: unknown, path: readonly string[]): boolean {
  let cursor: unknown = user;
  for (const segment of path) {
    if (
      typeof cursor !== "object" ||
      cursor === null ||
      Array.isArray(cursor)
    ) {
      return false;
    }
    const record = cursor as Record<string, unknown>;
    if (!Object.hasOwn(record, segment)) return false;
    cursor = record[segment];
  }
  return true;
}

/** Top-level keys the user layer carries; the reset-all action clears exactly these. */
export function overriddenKeys(user: unknown): string[] {
  if (typeof user !== "object" || user === null || Array.isArray(user)) {
    return [];
  }
  return Object.keys(user as Record<string, unknown>).sort();
}

/**
 * Read a path out of a settings section.
 * @param value - section root (the snapshot's effective value or user layer).
 * @param path - path from the section root.
 * @returns the value found, or undefined when any segment is absent.
 */
export function readPath(value: unknown, path: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Empty in every form the resolver accepts: absent, null, or an empty string. */
function isEmptySetting(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Whether two settings values are the same as the Host would store them. */
function isSameSetting(left: unknown, right: unknown): boolean {
  if (isEmptySetting(left) && isEmptySetting(right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Whether a settled mutation left the section holding what it asked for.
 *
 * The scope resolves a Host-rejected write instead of rejecting it — it
 * reloads Host state and returns — so acceptance is confirmed here. The
 * namespace revision advances on every committed change, and a write that
 * changed nothing is indistinguishable from a refusal; in that one case the
 * section itself answers whether the value already stood.
 * @param entries - writes the mutation asked for.
 * @param cleared - paths the mutation asked to clear.
 * @param snapshot - the scope snapshot as it stands after the settlement.
 * @returns true when the mutation's intent is visible in the section.
 */
export function mutationLanded(
  entries: readonly {
    readonly path: readonly string[];
    readonly value: unknown;
  }[],
  cleared: readonly (readonly string[])[],
  snapshot: { readonly value: unknown; readonly user: unknown },
): boolean {
  for (const entry of entries) {
    if (!isSameSetting(readPath(snapshot.value, entry.path), entry.value)) {
      return false;
    }
  }
  for (const path of cleared) {
    if (isOverridden(snapshot.user, path)) return false;
  }
  return true;
}

/** Wall-clock stamp of the last Host answer, for the status line. */
export function formatClock(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Count with the Russian form of its noun: 1 ключ, 2 ключа, 5 ключей.
 * @param count - counted value.
 * @param forms - singular, few, and many forms of the noun.
 * @returns the counted noun as the copy renders it.
 */
export function pluralRu(
  count: number,
  forms: readonly [string, string, string],
): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${String(count)} ${forms[2]}`;
  if (mod10 === 1) return `${String(count)} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4) return `${String(count)} ${forms[1]}`;
  return `${String(count)} ${forms[2]}`;
}

/** Thousands separator so long byte budgets stay readable. */
export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("ru-RU");
}
