/**
 * Draft completeness of the operator card's list rows.
 *
 * Every list editor commits the whole array at its parent path, and the Host
 * re-validates that array when it resolves the config: a profile without an id,
 * an instance or a resource boundary fails `resolveManagedServiceCredentials`,
 * and an instance without a usable address fails the provider's own resolver —
 * so one unfinished row takes the *whole* write down with it. The card keeps a
 * row that is not filled in yet as a local draft, says what it is still
 * missing, and writes only the rows the Host can take.
 * @module client/operator-drafts
 */

/** The fields an instance row needs before the Host takes it. */
export interface InstanceDraftLike {
  readonly id: string;
  readonly label?: string;
  readonly baseUrl: string;
  /**
   * Which product answers at the address, on the deployments that distinguish
   * one (Jira, Confluence). Deliberately not part of completeness: an absent
   * value is what the Host resolver reads as `cloud`, so a row that names no
   * product is still one the Host takes.
   */
  readonly deploymentType?: string | undefined;
}

/** The fields a managed-credential profile row needs. */
export interface ProfileDraftLike {
  readonly id: string;
  readonly provider: string;
  readonly instance: string;
  readonly resources: ReadonlyArray<readonly [string, string]>;
}

/** Id rule of the Host (`service-credentials/config.ts`, `providers/<id>/config.ts`). */
const ROW_ID = /^[a-z0-9][a-z0-9-]*$/u;

/** Absolute http(s) address, the only shape a provider resolver accepts. */
const HTTP_URL = /^https?:\/\/[^\s/]+/u;

/** What an instance row is still missing; empty when the Host would take it. */
export function instanceDraftMissing(
  row: InstanceDraftLike,
): readonly string[] {
  const missing: string[] = [];
  const id = row.id.trim();
  if (id === "") missing.push("id");
  else if (!ROW_ID.test(id)) {
    missing.push("id строчными латинскими буквами, цифрами и дефисом");
  }
  const baseUrl = row.baseUrl.trim();
  if (baseUrl === "") missing.push("адрес");
  else if (!HTTP_URL.test(baseUrl)) missing.push("абсолютный адрес http(s)://");
  return missing;
}

/** What a profile row is still missing; empty when the Host would take it. */
export function profileDraftMissing(row: ProfileDraftLike): readonly string[] {
  const missing: string[] = [];
  const id = row.id.trim();
  if (id === "") missing.push("id");
  else if (!ROW_ID.test(id)) {
    missing.push("id строчными латинскими буквами, цифрами и дефисом");
  }
  if (row.provider.trim() === "") missing.push("провайдер");
  if (row.instance.trim() === "") missing.push("инстанс");
  const boundary = row.resources.some(
    ([key, value]) => key.trim() !== "" && value.trim() !== "",
  );
  if (!boundary) missing.push("ограничение ресурсов");
  return missing;
}

/**
 * What the card says about a row it has not committed: the missing fields, or —
 * when nothing is missing and the Host still did not take the row — that the
 * write did not land, which is the one thing the operator must never be left
 * guessing about.
 */
export function draftNote(missing: readonly string[]): string {
  if (missing.length === 0) return "не сохранено — Хост не принял запись";
  return `не сохранено — нужно: ${missing.join(", ")}`;
}
