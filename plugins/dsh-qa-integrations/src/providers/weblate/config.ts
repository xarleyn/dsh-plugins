import z from "@deepseek-ai/schemastery";

/**
 * One Weblate deployment the operator allows. A user never types a host: the
 * connect form only picks from this list, so the broker cannot be pointed at an
 * arbitrary origin (the specification's SSRF rule). Weblate is usually
 * self-hosted, which is exactly why "did the operator declare this address?"
 * replaces "is this address public?".
 */
export interface WeblateInstance {
  readonly id: string;
  readonly label: string;
  /** Canonical `<origin><path>`, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Deployment switches for the Weblate provider. Every read capability is on by
 * default: the switches bound what this deployment is willing to expose at all,
 * while Weblate's own project and team permissions decide what the connected
 * token may actually read. The provider can only narrow, never widen.
 */
export interface WeblateFlags {
  readonly enabled: boolean;
  /** Development escape hatch; production instances must answer over HTTPS. */
  readonly allowInsecureHttp: boolean;
  readonly instances: readonly WeblateInstance[];
  readonly identityRead: boolean;
  readonly projectsRead: boolean;
  readonly componentsRead: boolean;
  readonly translationsRead: boolean;
  readonly unitsRead: boolean;
  readonly checksRead: boolean;
  readonly commentsRead: boolean;
  readonly suggestionsRead: boolean;
  readonly changesRead: boolean;
  readonly statisticsRead: boolean;
  readonly screenshotsRead: boolean;
  /** Character cap for one source or target string handed to the model. */
  readonly maxTextChars: number;
  /**
   * Rows per page this deployment hands the model, whatever Weblate allows: the
   * provider's own default is 20 and this is the ceiling.
   */
  readonly maxPageSize: number;
  /** Extra attempts for a rate-limited or transient read; writes never retry. */
  readonly retries: number;
}

export const WEBLATE_DEFAULTS: WeblateFlags = Object.freeze({
  enabled: true,
  allowInsecureHttp: false,
  instances: Object.freeze([]),
  identityRead: true,
  projectsRead: true,
  componentsRead: true,
  translationsRead: true,
  unitsRead: true,
  checksRead: true,
  commentsRead: true,
  suggestionsRead: true,
  changesRead: true,
  statisticsRead: true,
  screenshotsRead: true,
  maxTextChars: 4_000,
  maxPageSize: 100,
  retries: 2,
});

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const MAX_INSTANCES = 16;

function configError(message: string): Error {
  return new Error(`weblate integration config: ${message}`);
}

/**
 * Canonicalize one configured instance. Everything here is operator input, so a
 * typo must fail loudly at load: a silently dropped instance would leave users
 * with a provider they cannot connect to and no explanation.
 */
function normalizeInstance(
  input: unknown,
  index: number,
  allowInsecureHttp: boolean,
  seen: Set<string>,
): WeblateInstance {
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
  // Weblate is often mounted under a subpath, so the path stays; a trailing
  // slash would double up when the API root is appended, and the WHATWG URL
  // parser has already folded away any `..` segments.
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
): readonly WeblateInstance[] {
  if (input === undefined || input === null) return WEBLATE_DEFAULTS.instances;
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

/**
 * Config slice of this provider, as it appears under `weblate:` in YAML. The
 * instance list is validated and canonicalized by `resolveWeblateConfig`, which
 * is where a deployment typo fails loudly.
 */
export const weblateConfigSchema = z.object({
  enabled: z.boolean().default(WEBLATE_DEFAULTS.enabled),
  allowInsecureHttp: z.boolean().default(WEBLATE_DEFAULTS.allowInsecureHttp),
  instances: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        baseUrl: z.string(),
      }),
    )
    .default([]),
  identityRead: z.boolean().default(WEBLATE_DEFAULTS.identityRead),
  projectsRead: z.boolean().default(WEBLATE_DEFAULTS.projectsRead),
  componentsRead: z.boolean().default(WEBLATE_DEFAULTS.componentsRead),
  translationsRead: z.boolean().default(WEBLATE_DEFAULTS.translationsRead),
  unitsRead: z.boolean().default(WEBLATE_DEFAULTS.unitsRead),
  checksRead: z.boolean().default(WEBLATE_DEFAULTS.checksRead),
  commentsRead: z.boolean().default(WEBLATE_DEFAULTS.commentsRead),
  suggestionsRead: z.boolean().default(WEBLATE_DEFAULTS.suggestionsRead),
  changesRead: z.boolean().default(WEBLATE_DEFAULTS.changesRead),
  statisticsRead: z.boolean().default(WEBLATE_DEFAULTS.statisticsRead),
  screenshotsRead: z.boolean().default(WEBLATE_DEFAULTS.screenshotsRead),
  maxTextChars: z
    .number()
    .step(1)
    .min(128)
    .default(WEBLATE_DEFAULTS.maxTextChars),
  maxPageSize: z
    .number()
    .step(1)
    .min(1)
    .max(100)
    .default(WEBLATE_DEFAULTS.maxPageSize),
  retries: z.number().step(1).min(0).max(5).default(WEBLATE_DEFAULTS.retries),
}) as unknown as z<Partial<WeblateFlags>>;

export function resolveWeblateConfig(
  input: Partial<WeblateFlags> = {},
): WeblateFlags {
  const allowInsecureHttp =
    input.allowInsecureHttp ?? WEBLATE_DEFAULTS.allowInsecureHttp;
  return Object.freeze({
    enabled: input.enabled ?? WEBLATE_DEFAULTS.enabled,
    allowInsecureHttp,
    instances: normalizeInstances(input.instances, allowInsecureHttp),
    identityRead: input.identityRead ?? WEBLATE_DEFAULTS.identityRead,
    projectsRead: input.projectsRead ?? WEBLATE_DEFAULTS.projectsRead,
    componentsRead: input.componentsRead ?? WEBLATE_DEFAULTS.componentsRead,
    translationsRead:
      input.translationsRead ?? WEBLATE_DEFAULTS.translationsRead,
    unitsRead: input.unitsRead ?? WEBLATE_DEFAULTS.unitsRead,
    checksRead: input.checksRead ?? WEBLATE_DEFAULTS.checksRead,
    commentsRead: input.commentsRead ?? WEBLATE_DEFAULTS.commentsRead,
    suggestionsRead: input.suggestionsRead ?? WEBLATE_DEFAULTS.suggestionsRead,
    changesRead: input.changesRead ?? WEBLATE_DEFAULTS.changesRead,
    statisticsRead: input.statisticsRead ?? WEBLATE_DEFAULTS.statisticsRead,
    screenshotsRead: input.screenshotsRead ?? WEBLATE_DEFAULTS.screenshotsRead,
    maxTextChars: input.maxTextChars ?? WEBLATE_DEFAULTS.maxTextChars,
    maxPageSize: input.maxPageSize ?? WEBLATE_DEFAULTS.maxPageSize,
    retries: input.retries ?? WEBLATE_DEFAULTS.retries,
  });
}

/** The configured instance a stored credential names, or a fail-closed error. */
export function weblateInstance(
  flags: WeblateFlags,
  instanceId: string,
): WeblateInstance | undefined {
  return flags.instances.find((item) => item.id === instanceId);
}
