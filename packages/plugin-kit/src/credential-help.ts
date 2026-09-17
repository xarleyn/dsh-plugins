/**
 * Credential help metadata: what a credential field asks for, where the service
 * hands that credential out, which documentation describes the authorization,
 * and which permissions the credential needs.
 *
 * The shape is metadata and nothing else. It never carries a token, a credential
 * value, a credential snapshot or the result of an authorization check, so a
 * settings card can render it for a browser that is never given the secret.
 *
 * This module is import-safe on both sides of the Host/browser line: it has no
 * imports and no Node builtins, so a Host plugin declares its defaults from it
 * and a browser bundle inlines the same contract.
 */

/** The credential mechanism, which is what the UI wording is picked from. */
export type CredentialHelpKind =
  | "api-key"
  | "personal-access-token"
  | "oauth"
  | "service-account"
  | "app-password"
  | "custom";

/** Every kind a help may name, so a bad value degrades instead of rendering blank. */
export const CREDENTIAL_HELP_KINDS: readonly CredentialHelpKind[] =
  Object.freeze([
    "api-key",
    "personal-access-token",
    "oauth",
    "service-account",
    "app-password",
    "custom",
  ]);

export function isCredentialHelpKind(
  value: string,
): value is CredentialHelpKind {
  return (CREDENTIAL_HELP_KINDS as readonly string[]).includes(value);
}

export interface CredentialHelpLink {
  readonly url: string;
  /** Overrides the wording the UI derives from `kind`. */
  readonly label?: string;
}

/**
 * One credential's help, as declared next to the integration that needs it.
 * Everything but `kind` is optional: an integration that can only say "this
 * uses your existing environment credentials" declares the kind and stops.
 */
export interface CredentialHelp {
  readonly kind: CredentialHelpKind;
  /** Name of the credential itself, e.g. "GitLab personal access token". */
  readonly label?: string;
  /** Where the user creates the credential. */
  readonly obtain?: CredentialHelpLink;
  /** Where the service documents its authorization. */
  readonly docs?: CredentialHelpLink;
  /** Short text; newline-separated lines become the numbered steps. */
  readonly instructions?: string;
  /**
   * A locale key for the instructions instead of shipping prose that would have
   * to be translated inside metadata. The UI prefers it over `instructions`
   * whenever the embedding application knows the key.
   */
  readonly instructionsLocaleKey?: string;
  /** Required permissions, one per entry, shown as a list. */
  readonly scopes?: readonly string[];
  /** Extra remarks that are neither steps nor permissions. */
  readonly notes?: readonly string[];
  /**
   * The service is deployed by the operator rather than by the vendor, so an
   * `http:` URL may point at its own instance.
   */
  readonly selfHosted?: boolean;
}

/**
 * What a deployment may change about the declared help. Only these fields are
 * overridable: corporate GitHub, a self-hosted GitLab, a Jira Data Center or an
 * internal gateway all replace addresses, wording and permission lists, while
 * the credential mechanism itself stays the integration's own statement.
 */
export interface CredentialHelpOverride {
  /** `false` hides the help entirely; the credential field keeps working. */
  readonly enabled?: boolean;
  readonly kind?: CredentialHelpKind;
  readonly label?: string;
  readonly obtainUrl?: string;
  readonly obtainLabel?: string;
  readonly docsUrl?: string;
  readonly docsLabel?: string;
  readonly instructions?: string;
  readonly instructionsLocaleKey?: string;
  readonly scopes?: readonly string[];
  readonly notes?: readonly string[];
  readonly selfHosted?: boolean;
}

/**
 * The resolved help plus everything the deployment got wrong while overriding
 * it. A broken override hides the link it names and does not fail the
 * integration: help is never a runtime dependency, so a typo must not take a
 * working connection down with it.
 */
export interface ResolvedCredentialHelp {
  readonly help: CredentialHelp | null;
  readonly problems: readonly string[];
}

/** Hosts a deployment plausibly owns, where an `http:` address may be legitimate. */
const PRIVATE_HOST_SUFFIXES = [
  ".internal",
  ".intranet",
  ".corp",
  ".lan",
  ".local",
  ".home.arpa",
  ".localhost",
] as const;

/** Long enough for a deep documentation permalink, short enough to be a typo. */
const MAX_URL_LENGTH = 2_048;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "::1") return true;
  // IPv6 unique-local (`fc00::/7`) and link-local (`fe80::/10`).
  if (/^f[cd][0-9a-f]{2}:/u.test(bare) || bare.startsWith("fe80:")) return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))
    return true;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  const [first, second] = parts;
  if (first === "10" || first === "127" || first === "169") {
    return first !== "169" || second === "254";
  }
  if (first === "192") return second === "168";
  if (first === "172") {
    const block = Number(second);
    return Number.isInteger(block) && block >= 16 && block <= 31;
  }
  return false;
}

/**
 * Canonicalize one help URL, or refuse it. Only `http:` and `https:` survive:
 * `javascript:`, `data:` and `file:` are the shapes a metadata typo turns into
 * an injection, and a credential must never end up in the address itself, so an
 * embedded userinfo or a missing host is refused with them.
 *
 * Plain `http:` is kept for loopback, private and self-hosted addresses, where a
 * deployment may genuinely have no certificate; anything else has to be HTTPS.
 */
export function sanitizeCredentialHelpUrl(
  value: string,
  options: { readonly selfHosted?: boolean } = {},
): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol === "https:") {
    return url.username === "" && url.password === ""
      ? url.toString()
      : undefined;
  }
  if (url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (options.selfHosted !== true && !isPrivateHost(url.hostname)) {
    return undefined;
  }
  return url.toString();
}

interface LinkDefaults {
  readonly declared: CredentialHelpLink | undefined;
  readonly url: string | undefined;
  readonly label: string | undefined;
  readonly field: "obtainUrl" | "docsUrl";
  readonly selfHosted: boolean;
  readonly problems: string[];
}

/**
 * Apply an override to one link. A named override URL replaces the declared one
 * and is never silently downgraded to it: a deployment that typo'd its own URL
 * asked to point users elsewhere, and quietly sending them to the vendor
 * instead would hide the mistake the diagnostics warning is reporting.
 */
function resolveLink(defaults: LinkDefaults): CredentialHelpLink | undefined {
  const named = defaults.url;
  const source = named ?? defaults.declared?.url;
  if (source === undefined || source.trim() === "") return undefined;
  const url = sanitizeCredentialHelpUrl(source, {
    selfHosted: defaults.selfHosted,
  });
  if (url === undefined) {
    defaults.problems.push(
      `${defaults.field} is not a usable http(s) address: ${named === undefined ? "declared help" : "deployment override"}`,
    );
    return undefined;
  }
  const label = defaults.label ?? defaults.declared?.label;
  return label === undefined
    ? Object.freeze({ url })
    : Object.freeze({ url, label });
}

function resolveList<T>(
  override: readonly T[] | undefined,
  declared: readonly T[] | undefined,
): readonly T[] | undefined {
  const value = override ?? declared;
  if (value === undefined) return undefined;
  const items = value.filter((entry) => String(entry).trim() !== "");
  return items.length === 0 ? undefined : Object.freeze([...items]);
}

/**
 * Merge what an integration declares with what its deployment overrides, and
 * report whatever the override got wrong. Returning `help: null` is a normal
 * outcome, not a failure: an integration without metadata renders its plain
 * credential field.
 */
export function resolveCredentialHelp(
  declared: CredentialHelp | undefined,
  override: CredentialHelpOverride | undefined = undefined,
): ResolvedCredentialHelp {
  if (override?.enabled === false) return { help: null, problems: [] };
  const problems: string[] = [];
  const named = override?.kind ?? declared?.kind;
  const kind =
    named === undefined || isCredentialHelpKind(named) ? named : "custom";
  if (kind === undefined) return { help: null, problems: [] };
  if (named !== undefined && kind !== named) {
    problems.push(`kind is not a known credential mechanism: ${named}`);
  }
  const selfHosted = override?.selfHosted ?? declared?.selfHosted ?? false;
  const obtain = resolveLink({
    declared: declared?.obtain,
    url: override?.obtainUrl,
    label: override?.obtainLabel,
    field: "obtainUrl",
    selfHosted,
    problems,
  });
  const docs = resolveLink({
    declared: declared?.docs,
    url: override?.docsUrl,
    label: override?.docsLabel,
    field: "docsUrl",
    selfHosted,
    problems,
  });
  const label = override?.label ?? declared?.label;
  const instructions = override?.instructions ?? declared?.instructions;
  const instructionsLocaleKey =
    override?.instructionsLocaleKey ?? declared?.instructionsLocaleKey;
  const scopes = resolveList(override?.scopes, declared?.scopes);
  const notes = resolveList(override?.notes, declared?.notes);
  const help: CredentialHelp = {
    kind,
    // Only a `true` is carried: an absent flag means the same thing and keeps
    // the payload a provider summary sends to the browser unchanged.
    ...(selfHosted ? { selfHosted: true } : {}),
    ...(label === undefined ? {} : { label }),
    ...(obtain === undefined ? {} : { obtain }),
    ...(docs === undefined ? {} : { docs }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(instructionsLocaleKey === undefined ? {} : { instructionsLocaleKey }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(notes === undefined ? {} : { notes }),
  };
  return { help: Object.freeze(help), problems: Object.freeze(problems) };
}
