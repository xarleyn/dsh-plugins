import z from "@deepseek-ai/schemastery";

/**
 * One Jira Cloud site the operator allows. A user never types a host: the
 * connect form picks from this list, so the broker cannot be pointed at an
 * arbitrary origin (the specification's SSRF rule) and a credential minted for
 * a site cannot be spent against another one.
 *
 * The Atlassian account behind a site is a tenant of this deployment, not a
 * global discriminator: the same person may reach several sites, and the
 * credential records which one it belongs to.
 */
export interface JiraSite {
  readonly id: string;
  readonly label: string;
  /** Canonical `<origin><path>`, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Deployment switches for the Jira provider. Every read capability is on by
 * default; unlike GitLab there is no scope self-inspection to intersect them
 * with, so these switches are the whole local boundary and the site's own
 * permissions apply upstream (the specification's permission intersection).
 */
export interface JiraFlags {
  readonly enabled: boolean;
  /** Development escape hatch; production sites must answer over HTTPS. */
  readonly allowInsecureHttp: boolean;
  readonly sites: readonly JiraSite[];
  readonly identityRead: boolean;
  readonly issuesRead: boolean;
  readonly commentsRead: boolean;
  readonly attachmentsRead: boolean;
  readonly transitionsRead: boolean;
  readonly projectsRead: boolean;
  readonly fieldsRead: boolean;
  /** Rows of a search answer when the model names no limit. */
  readonly defaultSearchLimit: number;
  /** Hard ceiling for one search answer, whatever the model asks for. */
  readonly maxSearchLimit: number;
  /** Hard ceiling for one page of issue comments. */
  readonly maxCommentLimit: number;
  /** Characters of one description, comment or rich custom field. */
  readonly maxTextChars: number;
  /** Extra attempts for a rate-limited or transient read; writes never retry. */
  readonly retries: number;
}

/** Jira Cloud caps one search page at 100 issues once fields are requested. */
export const SEARCH_PAGE_CAP = 100;

export const JIRA_DEFAULTS: JiraFlags = Object.freeze({
  enabled: true,
  allowInsecureHttp: false,
  sites: Object.freeze([]),
  identityRead: true,
  issuesRead: true,
  commentsRead: true,
  attachmentsRead: true,
  transitionsRead: true,
  projectsRead: true,
  fieldsRead: true,
  defaultSearchLimit: 20,
  maxSearchLimit: SEARCH_PAGE_CAP,
  maxCommentLimit: 100,
  maxTextChars: 20_000,
  retries: 2,
});

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const MAX_SITES = 16;

function configError(message: string): Error {
  return new Error(`jira integration config: ${message}`);
}

/**
 * Canonicalize one configured site. Everything here is operator input, so a typo
 * must fail loudly at load: a silently dropped site would leave users with a
 * provider they cannot connect to and no explanation.
 */
function normalizeSite(
  input: unknown,
  index: number,
  allowInsecureHttp: boolean,
  seen: Set<string>,
): JiraSite {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw configError(`sites[${index}] must be a mapping`);
  }
  const record = input as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? record["id"].trim() : "";
  if (!SITE_ID.test(id)) {
    throw configError(
      `sites[${index}].id must be lowercase latin, digits or dashes`,
    );
  }
  if (seen.has(id)) throw configError(`sites[${index}].id is a duplicate`);
  seen.add(id);
  const raw = typeof record["baseUrl"] === "string" ? record["baseUrl"] : "";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw configError(`sites[${index}].baseUrl must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw configError(`sites[${index}].baseUrl must use HTTP or HTTPS`);
  }
  if (url.protocol === "http:" && !allowInsecureHttp) {
    throw configError(
      `sites[${index}].baseUrl needs HTTPS; set allowInsecureHttp for a development site`,
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    throw configError(
      `sites[${index}].baseUrl must carry no credentials or query`,
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

function normalizeSites(
  input: unknown,
  allowInsecureHttp: boolean,
): readonly JiraSite[] {
  if (input === undefined || input === null) return JIRA_DEFAULTS.sites;
  if (!Array.isArray(input)) throw configError("sites must be a list");
  if (input.length > MAX_SITES) {
    throw configError(`sites accepts at most ${MAX_SITES} entries`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    input.map((entry, index) =>
      normalizeSite(entry, index, allowInsecureHttp, seen),
    ),
  );
}

/**
 * Config slice of this provider, as it appears under `jira:` in YAML. The site
 * list is validated and canonicalized by `resolveJiraConfig`, which is where a
 * deployment typo fails loudly.
 */
export const jiraConfigSchema = z.object({
  enabled: z.boolean().default(JIRA_DEFAULTS.enabled),
  allowInsecureHttp: z.boolean().default(JIRA_DEFAULTS.allowInsecureHttp),
  sites: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        baseUrl: z.string(),
      }),
    )
    .default([]),
  identityRead: z.boolean().default(JIRA_DEFAULTS.identityRead),
  issuesRead: z.boolean().default(JIRA_DEFAULTS.issuesRead),
  commentsRead: z.boolean().default(JIRA_DEFAULTS.commentsRead),
  attachmentsRead: z.boolean().default(JIRA_DEFAULTS.attachmentsRead),
  transitionsRead: z.boolean().default(JIRA_DEFAULTS.transitionsRead),
  projectsRead: z.boolean().default(JIRA_DEFAULTS.projectsRead),
  fieldsRead: z.boolean().default(JIRA_DEFAULTS.fieldsRead),
  defaultSearchLimit: z
    .number()
    .step(1)
    .min(1)
    .max(SEARCH_PAGE_CAP)
    .default(JIRA_DEFAULTS.defaultSearchLimit),
  maxSearchLimit: z
    .number()
    .step(1)
    .min(1)
    .max(SEARCH_PAGE_CAP)
    .default(JIRA_DEFAULTS.maxSearchLimit),
  maxCommentLimit: z
    .number()
    .step(1)
    .min(1)
    .max(SEARCH_PAGE_CAP)
    .default(JIRA_DEFAULTS.maxCommentLimit),
  maxTextChars: z
    .number()
    .step(1)
    .min(1_000)
    .default(JIRA_DEFAULTS.maxTextChars),
  retries: z.number().step(1).min(0).max(5).default(JIRA_DEFAULTS.retries),
}) as unknown as z<Partial<JiraFlags>>;

export function resolveJiraConfig(input: Partial<JiraFlags> = {}): JiraFlags {
  const allowInsecureHttp =
    input.allowInsecureHttp ?? JIRA_DEFAULTS.allowInsecureHttp;
  // Jira Cloud answers at most 100 issues per page once fields are requested, so
  // a deployment cannot raise the ceiling past that: the value is folded, not
  // rejected, because an operator asking for more only wants the maximum.
  const maxSearchLimit = Math.min(
    input.maxSearchLimit ?? JIRA_DEFAULTS.maxSearchLimit,
    SEARCH_PAGE_CAP,
  );
  const defaultSearchLimit = Math.min(
    input.defaultSearchLimit ?? JIRA_DEFAULTS.defaultSearchLimit,
    maxSearchLimit,
  );
  const maxCommentLimit = Math.min(
    input.maxCommentLimit ?? JIRA_DEFAULTS.maxCommentLimit,
    SEARCH_PAGE_CAP,
  );
  return Object.freeze({
    enabled: input.enabled ?? JIRA_DEFAULTS.enabled,
    allowInsecureHttp,
    sites: normalizeSites(input.sites, allowInsecureHttp),
    identityRead: input.identityRead ?? JIRA_DEFAULTS.identityRead,
    issuesRead: input.issuesRead ?? JIRA_DEFAULTS.issuesRead,
    commentsRead: input.commentsRead ?? JIRA_DEFAULTS.commentsRead,
    attachmentsRead: input.attachmentsRead ?? JIRA_DEFAULTS.attachmentsRead,
    transitionsRead: input.transitionsRead ?? JIRA_DEFAULTS.transitionsRead,
    projectsRead: input.projectsRead ?? JIRA_DEFAULTS.projectsRead,
    fieldsRead: input.fieldsRead ?? JIRA_DEFAULTS.fieldsRead,
    defaultSearchLimit,
    maxSearchLimit,
    maxCommentLimit,
    maxTextChars: input.maxTextChars ?? JIRA_DEFAULTS.maxTextChars,
    retries: input.retries ?? JIRA_DEFAULTS.retries,
  });
}

/** The configured site a stored credential names, or undefined. */
export function jiraSite(
  flags: JiraFlags,
  siteId: string,
): JiraSite | undefined {
  return flags.sites.find((item) => item.id === siteId);
}
