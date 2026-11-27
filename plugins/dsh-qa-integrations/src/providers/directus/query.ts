import { invalid, optionalInteger, optionalText } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import type { DirectusCollection } from "./config.js";

export const FILTER_OPERATORS = ["eq", "contains", "gte", "lte"] as const;
const MAX_PAGE_SIZE = 25;
const MAX_OFFSET = 5000;

export function itemPath(
  collection: DirectusCollection,
  value: unknown,
): string {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) {
    invalid("id", "expected a numeric, UUID or slug identifier");
  }
  return `/items/${collection.name}/${id}`;
}

export function listQuery(
  collection: DirectusCollection,
  input: Readonly<Record<string, unknown>>,
) {
  const limit =
    optionalInteger(input["limit"], "limit", 1, MAX_PAGE_SIZE) ?? MAX_PAGE_SIZE;
  const offset = optionalInteger(input["offset"], "offset", 0, MAX_OFFSET) ?? 0;
  const sort =
    optionalText(input["sort"], "sort", 1, 65) ?? collection.primaryKey;
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!collection.fields.includes(sortField))
    invalid("sort", "expected an allowed field");
  const query = new URLSearchParams({
    fields: collection.fields.join(","),
    limit: String(limit),
    offset: String(offset),
    sort:
      sortField === collection.primaryKey
        ? sort
        : `${sort},${collection.primaryKey}`,
  });
  addFilters(query, collection, input["filters"]);
  return { query, limit, offset };
}

export function countQuery(collection: DirectusCollection, filters: unknown) {
  const query = new URLSearchParams({
    "aggregate[count]": collection.primaryKey,
  });
  addFilters(query, collection, filters);
  return query;
}

function addFilters(
  query: URLSearchParams,
  collection: DirectusCollection,
  filters: unknown,
): void {
  if (filters !== undefined) {
    if (!Array.isArray(filters) || filters.length > 4)
      invalid("filters", "expected up to four conditions");
    const conditions = filters.map((filter: unknown) => {
      if (
        filter === null ||
        typeof filter !== "object" ||
        Array.isArray(filter)
      )
        invalid("filters");
      const { field, op, value } = filter as Record<string, unknown>;
      if (typeof field !== "string" || !collection.fields.includes(field))
        invalid("filters.field");
      if (
        !FILTER_OPERATORS.some((operator) => operator === op) ||
        typeof op !== "string"
      )
        invalid("filters.op");
      if (!(
        (typeof value === "string" && value.length <= 256) ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
      ))
        invalid("filters.value");
      if (op === "contains" && typeof value !== "string")
        invalid("filters.value", "contains needs text");
      return { [field]: { [`_${op}`]: value } };
    });
    if (conditions.length > 0)
      query.set("filter", JSON.stringify({ _and: conditions }));
  }
}

export function directusCount(value: unknown, primaryKey: string): number {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new IntegrationError(
      "ProviderUnavailable",
      "Unexpected Directus count response",
    );
  }
  const raw = directusRecord(directusRecord(value[0])["count"])[primaryKey];
  const count =
    typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : raw;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new IntegrationError(
      "ProviderUnavailable",
      "Unexpected Directus count response",
    );
  }
  return count;
}

export function directusRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new IntegrationError(
      "ProviderUnavailable",
      "Unexpected Directus response",
    );
  }
  return value as Record<string, unknown>;
}

/** Limit model output even when an upstream view adds unsolicited fields. */
export function projectItem(
  collection: DirectusCollection,
  value: unknown,
  pageSize = 1,
): Record<string, unknown> {
  const record = directusRecord(value);
  itemPath(collection, record[collection.primaryKey]);
  const maxLength = Math.min(
    512,
    Math.floor(24_000 / (pageSize * collection.fields.length)),
  );
  return Object.fromEntries(
    collection.fields.flatMap<[string, string | number | boolean | null]>(
      (field) => {
        const cell = Object.hasOwn(record, field) ? record[field] : undefined;
        if (typeof cell === "string") {
          return [
            [
              field,
              field === collection.primaryKey || cell.length <= maxLength
                ? cell
                : `${cell.slice(0, maxLength - 1)}…`,
            ],
          ];
        }
        return cell === null ||
          typeof cell === "number" ||
          typeof cell === "boolean"
          ? [[field, cell]]
          : [];
      },
    ),
  );
}

export function nextOffset(
  offset: number,
  rows: number,
  limit: number,
): number | null {
  return rows === limit && offset + rows <= MAX_OFFSET ? offset + rows : null;
}
