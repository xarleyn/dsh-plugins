/**
 * Typed CQL builder. The model never sends CQL: it sends fields, and this
 * module turns them into one query, quoting every literal itself. That is the
 * whole reason the provider can keep searching without shipping a
 * `confluence_search_cql` tool.
 */

/** Content types the model may ask for; CQL spells the blog post `blogpost`. */
export const CONTENT_TYPES = Object.freeze(["page", "blogpost"] as const);

/** Orderings the builder knows. `relevance` leaves ordering to Confluence. */
export const ORDER_BY = Object.freeze({
  lastmodified: "lastmodified",
  created: "created",
} as const);

export type ConfluenceOrder = keyof typeof ORDER_BY;

export interface ConfluenceSearchFilter {
  /** Free text; a quoted phrase stays a phrase after escaping. */
  readonly query?: string | undefined;
  /** Space keys, already narrowed by the operator allowlist. */
  readonly spaces?: readonly string[] | undefined;
  /** Content types; defaults to `page` when absent or empty. */
  readonly contentTypes?: readonly string[] | undefined;
  readonly labels?: readonly string[] | undefined;
  /** `me` becomes `currentUser()`; anything else is a quoted account literal. */
  readonly creator?: string | undefined;
  readonly contributor?: string | undefined;
  /** Inclusive lower bound on `lastmodified`, as `YYYY-MM-DD`. */
  readonly modifiedAfter?: string | undefined;
  readonly orderBy?: ConfluenceOrder | undefined;
}

/**
 * Control characters carry no meaning in CQL and would break the one-line query,
 * so they become spaces. Lint refuses a control-character range in a regular
 * expression, hence the plain walk.
 */
function withoutControlChars(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    result += code < 0x20 || code === 0x7f ? " " : char;
  }
  return result;
}

/**
 * One quoted CQL literal. Confluence escapes an embedded quote with a
 * backslash, which is also the only escape its parser understands, so a
 * backslash of our own is escaped first — otherwise a value ending in `\`
 * would escape the closing quote and let the rest of the line be read as CQL.
 */
export function cqlLiteral(value: string): string {
  const flattened = withoutControlChars(value);
  return `"${flattened.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function joinTerms(operator: string, values: readonly string[]): string {
  return `${operator} (${values.join(", ")})`;
}

/**
 * Build one CQL query out of typed fields. Clauses are ANDed in a fixed order,
 * so the same filter always produces the same query — which is what the tests
 * pin and what keeps a cached upstream response honest.
 */
export function buildCql(filter: ConfluenceSearchFilter): string {
  const clauses: string[] = [];
  const types =
    filter.contentTypes === undefined || filter.contentTypes.length === 0
      ? ["page"]
      : filter.contentTypes;
  clauses.push(joinTerms("type in", types));
  if (filter.spaces !== undefined && filter.spaces.length > 0) {
    clauses.push(joinTerms("space in", filter.spaces.map(cqlLiteral)));
  }
  if (filter.labels !== undefined && filter.labels.length > 0) {
    clauses.push(joinTerms("label in", filter.labels.map(cqlLiteral)));
  }
  if (filter.query !== undefined && filter.query !== "") {
    clauses.push(`text ~ ${cqlLiteral(filter.query)}`);
  }
  if (filter.modifiedAfter !== undefined) {
    clauses.push(`lastmodified >= ${cqlLiteral(filter.modifiedAfter)}`);
  }
  if (filter.creator !== undefined) {
    clauses.push(
      filter.creator === "me"
        ? "creator = currentUser()"
        : `creator = ${cqlLiteral(filter.creator)}`,
    );
  }
  if (filter.contributor !== undefined) {
    clauses.push(
      filter.contributor === "me"
        ? "contributor = currentUser()"
        : `contributor = ${cqlLiteral(filter.contributor)}`,
    );
  }
  const query = clauses.join(" AND ");
  if (filter.orderBy === undefined) return query;
  return `${query} ORDER BY ${ORDER_BY[filter.orderBy]} DESC`;
}
