import z from "@deepseek-ai/schemastery";
import { scopedConfigError } from "../../errors.js";

/**
 * Which Jira this site is: Atlassian Cloud, or a self-hosted Server / Data
 * Center instance. The two are different products behind one name — different
 * API roots (`/rest/api/3` against `/rest/api/2`), different authentication
 * (an Atlassian API token over HTTP Basic against a personal access token over
 * Bearer), and different answers for the same read — so the deployment type is
 * a property of the site the operator declares, never a guess this provider
 * makes at run time.
 *
 * Server and Data Center are one value on purpose: Data Center is Server with
 * clustering, and the REST surface they answer is the same one.
 */
export type JiraDeployment = "cloud" | "server";

/**
 * One Jira site the operator allows. A user never types a host: the connect
 * form picks from this list, so the broker cannot be pointed at an arbitrary
 * origin (the specification's SSRF rule) and a credential minted for a site
 * cannot be spent against another one.
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
  /** Which product answers at `baseUrl`; see {@link JiraDeployment}. */
  readonly deploymentType: JiraDeployment;
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
  /**
   * Names this deployment gives to the instance's custom fields, so a question
   * about "the product" does not have to carry a `customfield_…` id, and the
   * mapping between a business term and a field stays where the instance is —
   * in the operator's config, not in a catalog or a skill file. See
   * {@link JiraFlags} consumers: `customFields[].field` accepts either form.
   */
  readonly fieldAliases: Readonly<Record<string, string>>;
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

/**
 * One site as the operator writes it. `deploymentType` is spelled as a plain
 * string here and resolved below, so that a config which predates the field
 * keeps loading as the Cloud site it always was, and a typo is refused with the
 * accepted values instead of silently becoming a default.
 */
export interface JiraSiteInput {
  readonly id: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly deploymentType?: string;
}

/** Config slice as YAML writes it: every member is optional there. */
export interface JiraConfigInput extends Partial<Omit<JiraFlags, "sites">> {
  readonly sites?: readonly JiraSiteInput[] | undefined;
}

/**
 * The shape of a custom field id, as Jira spells it. The provider never carries
 * one itself: an id belongs to an instance, so it arrives either from the
 * field catalog or from the operator's aliases.
 */
export const CUSTOM_FIELD_ID = /^customfield_\d{1,10}$/u;

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
  fieldAliases: Object.freeze({}),
  defaultSearchLimit: 20,
  maxSearchLimit: SEARCH_PAGE_CAP,
  maxCommentLimit: 100,
  maxTextChars: 20_000,
  retries: 2,
});

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const ALIAS = /^[a-z][a-z0-9-]{0,31}$/u;
const MAX_SITES = 16;
const MAX_ALIASES = 32;

const configError = scopedConfigError("jira integration config");

/**
 * Deployment types as an operator may spell them. `data-center` and
 * `datacenter` are accepted because that is what an administrator calls the
 * product on the stand; both name the same API as `server`.
 */
const DEPLOYMENT_TYPES: Readonly<Record<string, JiraDeployment>> =
  Object.freeze({
    cloud: "cloud",
    server: "server",
    "data-center": "server",
    datacenter: "server",
  });

/** The deployment type of one configured site; Cloud when it is not declared. */
function normalizeDeployment(input: unknown, index: number): JiraDeployment {
  if (input === undefined || input === null) return "cloud";
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw === "") return "cloud";
  const deployment = DEPLOYMENT_TYPES[raw];
  if (deployment === undefined) {
    throw configError(
      `sites[${index}].deploymentType must be cloud, server or data-center`,
    );
  }
  return deployment;
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
    deploymentType: normalizeDeployment(record["deploymentType"], index),
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
 * The instance's custom fields, as names this deployment chose. The mapping is
 * operator input and fails loudly on a typo, like the site list: an alias that
 * silently pointed nowhere would make a question about "the product" answer
 * nothing at all, with no way to tell that from "no such issues".
 */
function normalizeAliases(input: unknown): Readonly<Record<string, string>> {
  if (input === undefined || input === null) return JIRA_DEFAULTS.fieldAliases;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw configError(
      "fieldAliases must be a mapping of alias to customfield_ id",
    );
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ALIASES) {
    throw configError(`fieldAliases accepts at most ${MAX_ALIASES} entries`);
  }
  const aliases: Record<string, string> = {};
  for (const [alias, value] of entries) {
    if (!ALIAS.test(alias)) {
      throw configError(
        `fieldAliases keys must be lowercase latin, digits or dashes: ${JSON.stringify(alias)}`,
      );
    }
    const id = typeof value === "string" ? value.trim() : "";
    if (!CUSTOM_FIELD_ID.test(id)) {
      throw configError(
        `fieldAliases.${alias} must be a customfield_ id, as jira_get_fields reports it`,
      );
    }
    aliases[alias] = id;
  }
  return Object.freeze(aliases);
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
        deploymentType: z.string(),
      }),
    )
    .default([]),
  fieldAliases: z.dict(z.string()).default({}),
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
}) as unknown as z<JiraConfigInput>;

export function resolveJiraConfig(input: JiraConfigInput = {}): JiraFlags {
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
    fieldAliases: normalizeAliases(input.fieldAliases),
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
