/**
 * The address policy shared by every provider: the operator declares the
 * endpoints a deployment may be dialled at, a stored credential only names one
 * of them, and a user never types a host — the connect form picks from the
 * list, so the broker cannot be pointed at an arbitrary origin (the
 * specification's SSRF rule) and a credential minted for a site cannot be spent
 * against another.
 *
 * Canonicalization is the same question for every upstream — which id forms
 * are legal, whether an address may be plain HTTP, how `<origin><path>` is
 * folded — so one implementation answers it and a provider supplies only the
 * words its config error carries and, when it differs from the shared shape,
 * the extra row members it resolves itself.
 */

/** The id shape every provider list shares. */
export const ENDPOINT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/** How many endpoints one deployment may declare. */
export const MAX_ENDPOINTS = 16;

/** One allowed endpoint, canonicalized: `<origin><path>`, no trailing slash. */
export interface EndpointAddress {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
}

export interface EndpointListPolicy<T extends object = Record<never, never>> {
  /** The failure factory of the provider's config module. */
  readonly error: (message: string) => Error;
  /** The config field carrying the list, as a load failure names it. */
  readonly field: string;
  /** The noun a development exception is explained in. */
  readonly noun: string;
  /** How many endpoints one deployment may declare. */
  readonly max?: number;
  /**
   * Provider-specific members of one row, resolved after the shared ones —
   * e.g. which product answers at the address.
   */
  readonly extra?: (record: Record<string, unknown>, index: number) => T;
}

/**
 * Validate and canonicalize the operator's endpoint list. Everything here is
 * operator input, so a typo must fail loudly at load: a silently dropped entry
 * would leave users with a provider they cannot connect to and no explanation.
 */
export function resolveEndpointList<T extends object = Record<never, never>>(
  input: unknown,
  allowInsecureHttp: boolean,
  policy: EndpointListPolicy<T>,
): readonly (EndpointAddress & T)[] {
  const { error, field, noun } = policy;
  const max = policy.max ?? MAX_ENDPOINTS;
  if (input === undefined || input === null) return Object.freeze([]);
  if (!Array.isArray(input)) throw error(`${field} must be a list`);
  if (input.length > max) {
    throw error(`${field} accepts at most ${max} entries`);
  }
  const seen = new Set<string>();
  const rows: (EndpointAddress & T)[] = input.map(
    (entry: unknown, index: number) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw error(`${field}[${index}] must be a mapping`);
      }
      const record = entry as Record<string, unknown>;
      const id = typeof record["id"] === "string" ? record["id"].trim() : "";
      if (!ENDPOINT_ID.test(id)) {
        throw error(
          `${field}[${index}].id must be lowercase latin, digits or dashes`,
        );
      }
      if (seen.has(id)) throw error(`${field}[${index}].id is a duplicate`);
      seen.add(id);
      const raw =
        typeof record["baseUrl"] === "string" ? record["baseUrl"] : "";
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        throw error(`${field}[${index}].baseUrl must be an absolute URL`);
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw error(`${field}[${index}].baseUrl must use HTTP or HTTPS`);
      }
      if (url.protocol === "http:" && !allowInsecureHttp) {
        throw error(
          `${field}[${index}].baseUrl needs HTTPS; set allowInsecureHttp for a development ${noun}`,
        );
      }
      if (url.username !== "" || url.password !== "" || url.search !== "") {
        throw error(
          `${field}[${index}].baseUrl must carry no credentials or query`,
        );
      }
      // A trailing slash would double up when the API root is appended; the
      // WHATWG URL parser has already folded away any `..` segments.
      const path = url.pathname.replace(/\/+$/u, "");
      const label =
        typeof record["label"] === "string" ? record["label"].trim() : "";
      return Object.freeze({
        id,
        label: label === "" ? url.host : label,
        baseUrl: `${url.origin}${path}`,
        ...policy.extra?.(record, index),
      }) as EndpointAddress & T;
    },
  );
  return Object.freeze(rows);
}

/** The configured endpoint an id names, or undefined. */
export function findEndpoint<T extends EndpointAddress>(
  endpoints: readonly T[],
  id: string,
): T | undefined {
  return endpoints.find((endpoint) => endpoint.id === id);
}
