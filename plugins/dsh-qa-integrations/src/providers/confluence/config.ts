import z from "@deepseek-ai/schemastery";

/**
 * One Confluence site the operator allows. A user never types a host: the
 * connect form only picks from this list, so the broker cannot be pointed at an
 * arbitrary origin.
 *
 * The address is the site origin a Confluence Cloud deployment answers on
 * (`https://company.atlassian.net`). Deployments that reach Confluence through
 * the Atlassian gateway for scoped API tokens configure that base instead
 * (`https://api.atlassian.com/ex/confluence/<cloudId>`); both spell the same
 * relative `/wiki/...` paths, so the provider needs no mode switch.
 */
export interface ConfluenceInstance {
  readonly id: string;
  readonly label: string;
  /** Canonical `<origin><path>`, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Deployment switches for the Confluence provider. Read capabilities are on by
 * default; unlike GitLab there is nothing to narrow them per user, because an
 * Atlassian API token cannot report the scopes it was granted — the connected
 * account's own Confluence permissions decide on every call, and a permission
 * the account lacks answers as a deny.
 */
export interface ConfluenceFlags {
  readonly enabled: boolean;
  /** Development escape hatch; production instances must answer over HTTPS. */
  readonly allowInsecureHttp: boolean;
  readonly instances: readonly ConfluenceInstance[];
  readonly identityRead: boolean;
  readonly spacesRead: boolean;
  readonly searchRead: boolean;
  readonly contentRead: boolean;
  readonly commentsRead: boolean;
  readonly attachmentsRead: boolean;
  readonly versionsRead: boolean;
  /**
   * Space keys the agent may see, upper-cased. An empty list means every space
   * the connected account can read. A non-empty list narrows search, space
   * listings and every direct page read alike, so a page in a space outside it
   * is refused even when the account may open it.
   */
  readonly allowedSpaces: readonly string[];
  /** Page body handed to the model when the tool asks for no budget. */
  readonly defaultBodyChars: number;
  /** Ceiling for the body budget a tool argument may ask for. */
  readonly maxBodyChars: number;
  /** Rows per answer for every listing, and the cap on a requested `limit`. */
  readonly maxResults: number;
  /** Parent comments whose replies one call may fetch. */
  readonly maxReplyParents: number;
  /** Extra attempts for a rate-limited or transient read; writes never retry. */
  readonly retries: number;
}

export const CONFLUENCE_DEFAULTS: ConfluenceFlags = Object.freeze({
  enabled: true,
  allowInsecureHttp: false,
  instances: Object.freeze([]),
  identityRead: true,
  spacesRead: true,
  searchRead: true,
  contentRead: true,
  commentsRead: true,
  attachmentsRead: true,
  versionsRead: true,
  allowedSpaces: Object.freeze([]),
  defaultBodyChars: 20_000,
  maxBodyChars: 60_000,
  maxResults: 50,
  maxReplyParents: 10,
  retries: 2,
});

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const SPACE_KEY = /^[A-Z0-9][A-Z0-9_-]{0,254}$/u;
const MAX_INSTANCES = 16;
const MAX_ALLOWED_SPACES = 64;

function configError(message: string): Error {
  return new Error(`confluence integration config: ${message}`);
}

/**
 * Canonicalize one configured site. Everything here is operator input, so a
 * typo must fail loudly at load: a silently dropped instance would leave users
 * with a provider they cannot connect to and no explanation.
 */
function normalizeInstance(
  input: unknown,
  index: number,
  allowInsecureHttp: boolean,
  seen: Set<string>,
): ConfluenceInstance {
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
  const raw = typeof record["baseUrl"] === "string" ? record["baseUrl"] : "";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw configError(`instances[${index}].baseUrl must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw configError(`instances[${index}].baseUrl must use HTTP or HTTPS`);
  }
  if (url.protocol === "http:" && !allowInsecureHttp) {
    throw configError(
      `instances[${index}].baseUrl needs HTTPS; set allowInsecureHttp for a development instance`,
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    throw configError(
      `instances[${index}].baseUrl must carry no credentials or query`,
    );
  }
  // A trailing slash would double up when the API root is appended; the WHATWG
  // URL parser has already folded away any `..` segments.
  const path = url.pathname.replace(/\/+$/u, "");
  const label =
    typeof record["label"] === "string" ? record["label"].trim() : "";
  return Object.freeze({
    id,
    label: label === "" ? url.host : label,
    baseUrl: `${url.origin}${path}`,
  });
}

function normalizeInstances(
  input: unknown,
  allowInsecureHttp: boolean,
): readonly ConfluenceInstance[] {
  if (input === undefined || input === null)
    return CONFLUENCE_DEFAULTS.instances;
  if (!Array.isArray(input)) throw configError("instances must be a list");
  if (input.length > MAX_INSTANCES) {
    throw configError(`instances accepts at most ${MAX_INSTANCES} entries`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    input.map((entry, index) =>
      normalizeInstance(entry, index, allowInsecureHttp, seen),
    ),
  );
}

/** Space keys are upper-cased once, so a policy comparison is a plain equality. */
function normalizeAllowedSpaces(input: unknown): readonly string[] {
  if (input === undefined || input === null) {
    return CONFLUENCE_DEFAULTS.allowedSpaces;
  }
  if (!Array.isArray(input)) throw configError("allowedSpaces must be a list");
  if (input.length > MAX_ALLOWED_SPACES) {
    throw configError(
      `allowedSpaces accepts at most ${MAX_ALLOWED_SPACES} entries`,
    );
  }
  const seen = new Set<string>();
  for (const entry of input) {
    const key = typeof entry === "string" ? entry.trim().toUpperCase() : "";
    if (!SPACE_KEY.test(key)) {
      throw configError("allowedSpaces entries must be space keys");
    }
    seen.add(key);
  }
  return Object.freeze([...seen]);
}

/**
 * Config slice of this provider, as it appears under `confluence:` in YAML. The
 * instance list is validated and canonicalized by `resolveConfluenceConfig`,
 * which is where a deployment typo fails loudly.
 */
export const confluenceConfigSchema = z.object({
  enabled: z.boolean().default(CONFLUENCE_DEFAULTS.enabled),
  allowInsecureHttp: z.boolean().default(CONFLUENCE_DEFAULTS.allowInsecureHttp),
  instances: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        baseUrl: z.string(),
      }),
    )
    .default([]),
  identityRead: z.boolean().default(CONFLUENCE_DEFAULTS.identityRead),
  spacesRead: z.boolean().default(CONFLUENCE_DEFAULTS.spacesRead),
  searchRead: z.boolean().default(CONFLUENCE_DEFAULTS.searchRead),
  contentRead: z.boolean().default(CONFLUENCE_DEFAULTS.contentRead),
  commentsRead: z.boolean().default(CONFLUENCE_DEFAULTS.commentsRead),
  attachmentsRead: z.boolean().default(CONFLUENCE_DEFAULTS.attachmentsRead),
  versionsRead: z.boolean().default(CONFLUENCE_DEFAULTS.versionsRead),
  allowedSpaces: z.array(z.string()).default([]),
  defaultBodyChars: z
    .number()
    .step(1)
    .min(512)
    .max(1_000_000)
    .default(CONFLUENCE_DEFAULTS.defaultBodyChars),
  maxBodyChars: z
    .number()
    .step(1)
    .min(512)
    .max(1_000_000)
    .default(CONFLUENCE_DEFAULTS.maxBodyChars),
  maxResults: z
    .number()
    .step(1)
    .min(1)
    .max(250)
    .default(CONFLUENCE_DEFAULTS.maxResults),
  maxReplyParents: z
    .number()
    .step(1)
    .min(0)
    .max(25)
    .default(CONFLUENCE_DEFAULTS.maxReplyParents),
  retries: z
    .number()
    .step(1)
    .min(0)
    .max(5)
    .default(CONFLUENCE_DEFAULTS.retries),
}) as unknown as z<Partial<ConfluenceFlags>>;

export function resolveConfluenceConfig(
  input: Partial<ConfluenceFlags> = {},
): ConfluenceFlags {
  const allowInsecureHttp =
    input.allowInsecureHttp ?? CONFLUENCE_DEFAULTS.allowInsecureHttp;
  const defaultBodyChars =
    input.defaultBodyChars ?? CONFLUENCE_DEFAULTS.defaultBodyChars;
  const maxBodyChars = input.maxBodyChars ?? CONFLUENCE_DEFAULTS.maxBodyChars;
  if (maxBodyChars < defaultBodyChars) {
    // A ceiling below the default would make every page read answer with a
    // budget the deployment contradicts itself about.
    throw configError("maxBodyChars must be at least defaultBodyChars");
  }
  return Object.freeze({
    enabled: input.enabled ?? CONFLUENCE_DEFAULTS.enabled,
    allowInsecureHttp,
    instances: normalizeInstances(input.instances, allowInsecureHttp),
    identityRead: input.identityRead ?? CONFLUENCE_DEFAULTS.identityRead,
    spacesRead: input.spacesRead ?? CONFLUENCE_DEFAULTS.spacesRead,
    searchRead: input.searchRead ?? CONFLUENCE_DEFAULTS.searchRead,
    contentRead: input.contentRead ?? CONFLUENCE_DEFAULTS.contentRead,
    commentsRead: input.commentsRead ?? CONFLUENCE_DEFAULTS.commentsRead,
    attachmentsRead:
      input.attachmentsRead ?? CONFLUENCE_DEFAULTS.attachmentsRead,
    versionsRead: input.versionsRead ?? CONFLUENCE_DEFAULTS.versionsRead,
    allowedSpaces: normalizeAllowedSpaces(input.allowedSpaces),
    defaultBodyChars,
    maxBodyChars,
    maxResults: input.maxResults ?? CONFLUENCE_DEFAULTS.maxResults,
    maxReplyParents:
      input.maxReplyParents ?? CONFLUENCE_DEFAULTS.maxReplyParents,
    retries: input.retries ?? CONFLUENCE_DEFAULTS.retries,
  });
}

/** The configured site a stored credential names, or a fail-closed error. */
export function confluenceInstance(
  flags: ConfluenceFlags,
  instanceId: string,
): ConfluenceInstance | undefined {
  return flags.instances.find((item) => item.id === instanceId);
}

/** Whether a space key passes the operator allowlist; an empty list allows all. */
export function spaceAllowed(
  flags: ConfluenceFlags,
  key: string | undefined,
): boolean {
  if (flags.allowedSpaces.length === 0) return true;
  if (key === undefined) return false;
  return flags.allowedSpaces.includes(key.trim().toUpperCase());
}
