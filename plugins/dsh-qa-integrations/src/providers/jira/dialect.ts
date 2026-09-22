import { IntegrationError } from "../../errors.js";
import type { JiraDeployment, JiraSite } from "./config.js";

/**
 * Everything that differs between Atlassian Cloud and a self-hosted Server /
 * Data Center instance, in one place. The provider is one read-only product
 * surface over two products: keeping the differences here means an operation
 * asks the dialect where to read and how to authenticate, instead of every
 * call site deciding for itself which Jira it is talking to.
 *
 * Nothing here is inferred at run time. The deployment type comes from the
 * operator's site list, and a site that answers a different product than it
 * declared is refused — the specification forbids treating Data Center as
 * silently compatible with Cloud.
 */
export interface JiraDialect {
  readonly deployment: JiraDeployment;
  /** Root every REST path of this product hangs under. */
  readonly apiRoot: "/rest/api/3" | "/rest/api/2";
  /** What the connect form calls the secret this product accepts. */
  readonly credentialLabel: string;
  /** Shape of one pasteable token, before anything is sent upstream. */
  readonly tokenShape: RegExp;
  /**
   * Whether an e-mail must travel with the token. Cloud pairs an API token with
   * the account it was minted for; a Server / Data Center personal access token
   * authenticates on its own.
   */
  readonly requiresEmail: boolean;
  /** The user directory parameter a free-text person is searched by. */
  readonly userSearchParam: "query" | "username";
  /** Fields a person is identified by in an answer, in order of preference. */
  readonly identityFields: readonly string[];
  /** `deploymentType` values `serverInfo` answers for this product. */
  readonly deploymentTypes: readonly string[];
  /** How the name of this product reads in a message. */
  readonly productName: string;
}

/** Atlassian Cloud: `/rest/api/3`, an API token over HTTP Basic. */
const CLOUD: JiraDialect = Object.freeze({
  deployment: "cloud",
  apiRoot: "/rest/api/3",
  credentialLabel: "Atlassian API token",
  tokenShape: /^[A-Za-z0-9_-]{20,512}$/u,
  requiresEmail: true,
  userSearchParam: "query",
  identityFields: Object.freeze(["accountId"]),
  deploymentTypes: Object.freeze(["Cloud"]),
  productName: "Jira Cloud",
});

/**
 * Server and Data Center: `/rest/api/2`, a personal access token over Bearer.
 * The API version is the product's own: `/rest/api/3` exists only on Cloud,
 * and a Data Center instance answers the whole read surface on v2.
 */
const SERVER: JiraDialect = Object.freeze({
  deployment: "server",
  apiRoot: "/rest/api/2",
  credentialLabel: "personal access token",
  // A Data Center personal access token is base64, so it may carry `+`, `/` and
  // padding — none of which the Cloud token shape admits.
  tokenShape: /^[A-Za-z0-9._+/=-]{16,1024}$/u,
  requiresEmail: false,
  userSearchParam: "username",
  identityFields: Object.freeze(["name", "key"]),
  deploymentTypes: Object.freeze(["Server", "Data Center"]),
  productName: "Jira Server / Data Center",
});

export const JIRA_DIALECTS: Readonly<Record<JiraDeployment, JiraDialect>> =
  Object.freeze({ cloud: CLOUD, server: SERVER });

/** The dialect of one configured site. */
export function dialectOf(site: JiraSite): JiraDialect {
  return JIRA_DIALECTS[site.deploymentType];
}

/**
 * The identifier of one person as an answer reports it. Cloud names an account
 * id, a Server / Data Center instance the user name its JQL filters on; reading
 * them in the dialect's own order is what keeps the identity of a connection
 * the same value the model has to pass back in a filter.
 */
export function identityOf(
  dialect: JiraDialect,
  person: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const field of dialect.identityFields) {
    const value = person[field];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * Jira Cloud authenticates an API token with HTTP Basic over `email:token`.
 * The e-mail is not a secret, but it is what makes the token usable, so the two
 * travel as one pair and never as two arguments.
 */
export function basicAuthorization(credential: {
  readonly email: string;
  readonly token: string;
}): string {
  const pair = Buffer.from(
    `${credential.email}:${credential.token}`,
    "utf8",
  ).toString("base64");
  return `Basic ${pair}`;
}

/**
 * The `Authorization` header of one stored credential. Cloud spends an
 * Atlassian API token as HTTP Basic over `email:token`; a Server / Data Center
 * personal access token is a bearer token, and the account it belongs to is the
 * token's own — no e-mail travels with it.
 *
 * The credential carries what the operator's site declared, so a site whose
 * deployment type no longer matches the credential is refused here, before the
 * secret is spent: a token minted for one product must not be offered to the
 * other.
 */
export function authorizationFor(
  dialect: JiraDialect,
  credential: { readonly email: string; readonly token: string },
): string {
  if (dialect.deployment === "server") return `Bearer ${credential.token}`;
  if (credential.email.trim() === "") {
    throw new IntegrationError(
      "CredentialRevoked",
      "This Jira site is configured as Cloud and needs the account e-mail; reconnect it",
    );
  }
  return basicAuthorization(credential);
}

/**
 * Whether a `serverInfo` answer proves the site is the product it declared. An
 * answer that names no type at all proves nothing either way and is left to the
 * identity call that already succeeded; an answer that names the other product
 * is a configuration mistake the operator has to fix, and the message says
 * which one.
 */
export function assertDeployment(
  dialect: JiraDialect,
  deploymentType: string | undefined,
): void {
  if (deploymentType === undefined || deploymentType === "") return;
  if (dialect.deploymentTypes.includes(deploymentType)) return;
  const other = deploymentType === "Cloud" ? "cloud" : "server";
  throw new IntegrationError(
    "InvalidCredential",
    `${dialect.productName} was expected, but the site answers "${deploymentType}"; set deploymentType: ${other} for it in the Jira integration config`,
  );
}
