import z from "@deepseek-ai/schemastery";

/**
 * One Test IT installation the operator allows. Test IT ships as Cloud
 * (`<team>.testit.software`) and as an on-premise TMS behind any hostname, so
 * the list is how a deployment says which installations its users may connect
 * to. A user never types a host: the connect form only picks from this list,
 * which is what keeps the broker from dialling an origin nobody declared (the
 * specification's SSRF rule).
 */
export interface TestitInstance {
  readonly id: string;
  readonly label: string;
  /** Canonical `<origin><path>`, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Deployment switches for the Test IT provider. Every read capability is on by
 * default, and the switches bound what this deployment offers rather than grant
 * it: Test IT authorizes each request against the permissions of the user the
 * token belongs to, and a refusal is reported instead of being worked around.
 */
export interface TestitFlags {
  readonly enabled: boolean;
  /** Development escape hatch; production installations must answer over HTTPS. */
  readonly allowInsecureHttp: boolean;
  readonly instances: readonly TestitInstance[];
  readonly projectsRead: boolean;
  readonly sectionsRead: boolean;
  readonly workItemsRead: boolean;
  readonly historyRead: boolean;
  readonly commentsRead: boolean;
  readonly testPlansRead: boolean;
  readonly testRunsRead: boolean;
  readonly testResultsRead: boolean;
  readonly autoTestsRead: boolean;
  readonly attachmentsRead: boolean;
  readonly configurationsRead: boolean;
  /** Rows one list answer holds when the caller names no limit. */
  readonly defaultResults: number;
  /** Hard ceiling for one list answer, whatever the caller asks for. */
  readonly maxResults: number;
  /** Byte budget of one text attachment when the caller names none. */
  readonly defaultAttachmentBytes: number;
  /** Hard ceiling of one text attachment, whatever the caller asks for. */
  readonly maxAttachmentBytes: number;
  /** Timeout for the attachment read; JSON reads use the shared one. */
  readonly attachmentTimeoutMs: number;
  /** Extra attempts for a throttled or transient read. */
  readonly retries: number;
}

export const TESTIT_DEFAULTS: TestitFlags = Object.freeze({
  enabled: true,
  allowInsecureHttp: false,
  instances: Object.freeze([]),
  projectsRead: true,
  sectionsRead: true,
  workItemsRead: true,
  historyRead: true,
  commentsRead: true,
  testPlansRead: true,
  testRunsRead: true,
  testResultsRead: true,
  autoTestsRead: true,
  attachmentsRead: true,
  configurationsRead: true,
  defaultResults: 20,
  maxResults: 100,
  defaultAttachmentBytes: 262_144,
  maxAttachmentBytes: 10_485_760,
  attachmentTimeoutMs: 30_000,
  retries: 2,
});

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const MAX_INSTANCES = 16;

function configError(message: string): Error {
  return new Error(`testit integration config: ${message}`);
}

/**
 * Canonicalize one configured installation. Everything here is operator input,
 * so a typo must fail loudly at load: a silently dropped instance would leave
 * users with a provider they cannot connect to and no explanation.
 */
function normalizeInstance(
  input: unknown,
  index: number,
  allowInsecureHttp: boolean,
  seen: Set<string>,
): TestitInstance {
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
      `instances[${index}].baseUrl needs HTTPS; set allowInsecureHttp for an internal Test IT`,
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    throw configError(
      `instances[${index}].baseUrl must carry no credentials or query`,
    );
  }
  if (url.hash !== "") {
    throw configError(`instances[${index}].baseUrl must carry no fragment`);
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
): readonly TestitInstance[] {
  if (input === undefined || input === null) return TESTIT_DEFAULTS.instances;
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
 * Config slice of this provider, as it appears under `testit:` in YAML. The
 * instance list is canonicalized by `resolveTestitConfig`, which is where a
 * deployment typo fails loudly.
 */
export const testitConfigSchema = z.object({
  enabled: z.boolean().default(TESTIT_DEFAULTS.enabled),
  allowInsecureHttp: z.boolean().default(TESTIT_DEFAULTS.allowInsecureHttp),
  instances: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        baseUrl: z.string(),
      }),
    )
    .default([]),
  projectsRead: z.boolean().default(TESTIT_DEFAULTS.projectsRead),
  sectionsRead: z.boolean().default(TESTIT_DEFAULTS.sectionsRead),
  workItemsRead: z.boolean().default(TESTIT_DEFAULTS.workItemsRead),
  historyRead: z.boolean().default(TESTIT_DEFAULTS.historyRead),
  commentsRead: z.boolean().default(TESTIT_DEFAULTS.commentsRead),
  testPlansRead: z.boolean().default(TESTIT_DEFAULTS.testPlansRead),
  testRunsRead: z.boolean().default(TESTIT_DEFAULTS.testRunsRead),
  testResultsRead: z.boolean().default(TESTIT_DEFAULTS.testResultsRead),
  autoTestsRead: z.boolean().default(TESTIT_DEFAULTS.autoTestsRead),
  attachmentsRead: z.boolean().default(TESTIT_DEFAULTS.attachmentsRead),
  configurationsRead: z.boolean().default(TESTIT_DEFAULTS.configurationsRead),
  defaultResults: z
    .number()
    .step(1)
    .min(1)
    .default(TESTIT_DEFAULTS.defaultResults),
  maxResults: z.number().step(1).min(1).default(TESTIT_DEFAULTS.maxResults),
  defaultAttachmentBytes: z
    .number()
    .step(1)
    .min(1_024)
    .default(TESTIT_DEFAULTS.defaultAttachmentBytes),
  maxAttachmentBytes: z
    .number()
    .step(1)
    .min(1_024)
    .default(TESTIT_DEFAULTS.maxAttachmentBytes),
  attachmentTimeoutMs: z
    .number()
    .step(1)
    .min(1_000)
    .default(TESTIT_DEFAULTS.attachmentTimeoutMs),
  retries: z.number().step(1).min(0).max(5).default(TESTIT_DEFAULTS.retries),
}) as unknown as z<Partial<TestitFlags>>;

export function resolveTestitConfig(
  input: Partial<TestitFlags> = {},
): TestitFlags {
  const allowInsecureHttp =
    input.allowInsecureHttp ?? TESTIT_DEFAULTS.allowInsecureHttp;
  const defaultResults = input.defaultResults ?? TESTIT_DEFAULTS.defaultResults;
  const maxResults = input.maxResults ?? TESTIT_DEFAULTS.maxResults;
  if (defaultResults > maxResults) {
    throw configError("defaultResults must not exceed maxResults");
  }
  const defaultAttachmentBytes =
    input.defaultAttachmentBytes ?? TESTIT_DEFAULTS.defaultAttachmentBytes;
  const maxAttachmentBytes =
    input.maxAttachmentBytes ?? TESTIT_DEFAULTS.maxAttachmentBytes;
  if (defaultAttachmentBytes > maxAttachmentBytes) {
    throw configError(
      "defaultAttachmentBytes must not exceed maxAttachmentBytes",
    );
  }
  return Object.freeze({
    enabled: input.enabled ?? TESTIT_DEFAULTS.enabled,
    allowInsecureHttp,
    instances: normalizeInstances(input.instances, allowInsecureHttp),
    projectsRead: input.projectsRead ?? TESTIT_DEFAULTS.projectsRead,
    sectionsRead: input.sectionsRead ?? TESTIT_DEFAULTS.sectionsRead,
    workItemsRead: input.workItemsRead ?? TESTIT_DEFAULTS.workItemsRead,
    historyRead: input.historyRead ?? TESTIT_DEFAULTS.historyRead,
    commentsRead: input.commentsRead ?? TESTIT_DEFAULTS.commentsRead,
    testPlansRead: input.testPlansRead ?? TESTIT_DEFAULTS.testPlansRead,
    testRunsRead: input.testRunsRead ?? TESTIT_DEFAULTS.testRunsRead,
    testResultsRead: input.testResultsRead ?? TESTIT_DEFAULTS.testResultsRead,
    autoTestsRead: input.autoTestsRead ?? TESTIT_DEFAULTS.autoTestsRead,
    attachmentsRead: input.attachmentsRead ?? TESTIT_DEFAULTS.attachmentsRead,
    configurationsRead:
      input.configurationsRead ?? TESTIT_DEFAULTS.configurationsRead,
    defaultResults,
    maxResults,
    defaultAttachmentBytes,
    maxAttachmentBytes,
    attachmentTimeoutMs:
      input.attachmentTimeoutMs ?? TESTIT_DEFAULTS.attachmentTimeoutMs,
    retries: input.retries ?? TESTIT_DEFAULTS.retries,
  });
}

/** The configured instance a stored credential names, or a fail-closed error. */
export function testitInstance(
  flags: TestitFlags,
  instanceId: string,
): TestitInstance | undefined {
  return flags.instances.find((item) => item.id === instanceId);
}
