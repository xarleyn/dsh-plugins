/**
 * TeamCity locator syntax, built server-side.
 *
 * A locator is `<dimension>:<value>,<dimension>:<value>` with parentheses for
 * nested locators, and it has no escape character: a value that contains a
 * comma, a colon or a parenthesis cannot be written plainly, and a half-escaped
 * value would silently become a different query. TeamCity therefore documents
 * the `$base64:` form for arbitrary values, which is what this module uses for
 * anything that does not look like a plain identifier.
 *
 * The model never composes a locator: every tool argument is a validated field
 * that this builder turns into dimensions, so a caller cannot smuggle an extra
 * dimension such as `count` or `agent` into a query.
 */

/**
 * Values that go through as they are. Everything else — a comma, a colon, a
 * parenthesis, a backslash — would change how the locator parses, so it takes
 * the `$base64:` form instead. A `+` is safe here: the query serializer above
 * percent-encodes it, and TeamCity parses the decoded locator.
 */
const SAFE_VALUE = /^[A-Za-z0-9._@+/-]{1,200}$/u;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** One dimension value, plain when it cannot confuse the parser. */
export function locatorValue(value: string): string {
  if (SAFE_VALUE.test(value)) return value;
  const encoded = Buffer.from(value, "utf8").toString("base64url");
  return `($base64:${encoded})`;
}

/** `<name>:<value>` for a single-value dimension. */
export function dimension(name: string, value: string | number): string {
  return `${name}:${locatorValue(String(value))}`;
}

/** `<name>:(<nested locator>)` for a dimension that takes an entity. */
export function nested(name: string, locator: string): string {
  return `${name}:(${locator})`;
}

export function joinDimensions(parts: readonly string[]): string {
  return parts.join(",");
}

/**
 * TeamCity's own date format, in UTC. A bare `YYYY-MM-DD` means midnight UTC,
 * so "since 2026-09-01" includes that day.
 */
export function teamCityDate(value: string): string | undefined {
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+0000`
  );
}

export interface BuildLocatorInput {
  readonly buildTypeId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly branch?: string | undefined;
  readonly status?: string | undefined;
  readonly state?: string | undefined;
  readonly personal?: boolean | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly count?: number | undefined;
  readonly start?: number | undefined;
}

/**
 * The build locator the model's filters map onto. TeamCity applies
 * `defaultFilter:true` unless told otherwise, which hides personal builds
 * entirely; asking for personal builds therefore has to drop that filter, or
 * the query would answer with an empty list instead of the very builds it asked
 * about.
 */
export function buildBuildLocator(input: BuildLocatorInput): string {
  const parts: string[] = [];
  if (input.buildTypeId !== undefined) {
    parts.push(nested("buildType", dimension("id", input.buildTypeId)));
  }
  if (input.projectId !== undefined) {
    parts.push(nested("project", dimension("id", input.projectId)));
  }
  if (input.branch !== undefined) {
    parts.push(nested("branch", dimension("name", input.branch)));
  }
  if (input.status !== undefined) parts.push(dimension("status", input.status));
  if (input.state !== undefined) parts.push(dimension("state", input.state));
  if (input.personal === true) {
    parts.push("personal:true", "defaultFilter:false");
  }
  if (input.since !== undefined) {
    parts.push(dimension("sinceDate", input.since));
  }
  if (input.until !== undefined) {
    parts.push(dimension("untilDate", input.until));
  }
  if (input.count !== undefined) parts.push(dimension("count", input.count));
  if (input.start !== undefined && input.start > 0) {
    parts.push(dimension("start", input.start));
  }
  return joinDimensions(parts);
}
