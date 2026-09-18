import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import { objectOf } from "../shared/account.js";
import {
  WEBLATE_CAPABILITY_INFO,
  WEBLATE_OPERATIONS,
  enabledCapabilities,
  weblateOperationCapability,
} from "./catalog.js";
import { weblateInstance, type WeblateFlags } from "./config.js";
import {
  WEBLATE_HANDLERS,
  WEBLATE_PROJECTIONS,
  WEBLATE_UNTRUSTED_OPERATIONS,
  accountIdFrom,
  accountNameFrom,
  textLimitFor,
  type WeblateProjectionContext,
  type WeblateRequest,
} from "./operations.js";
import { WEBLATE_CREDENTIAL_HELP } from "./credential-help.js";
import {
  WeblateTransport,
  credentialFromPlaintext,
  credentialInstance,
  resultsOf,
  type WeblateCredential,
  type WeblatePage,
} from "./transport.js";
export {
  credentialFromPlaintext,
  credentialInstance,
  resultsOf,
  type WeblateCredential,
} from "./transport.js";

/**
 * A Weblate API token is opaque to this provider: the documented prefixes below
 * are a hint for the user, never a permission check, and a working token is
 * accepted whatever it looks like. What is refused is a paste mistake — a URL,
 * a YAML line or anything carrying whitespace.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_.:-]{8,512}$/u;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//iu;

export type WeblateTokenKind = "personal" | "project" | "unknown";

/**
 * Which of Weblate's token shapes a value looks like. Weblate decides what a
 * token may do, so this only ever reaches the user as a label.
 */
export function tokenKind(token: string): WeblateTokenKind {
  if (token.startsWith("wlu_")) return "personal";
  if (token.startsWith("wlp_")) return "project";
  return "unknown";
}

const TOKEN_KIND_LABEL: Readonly<Record<WeblateTokenKind, string>> =
  Object.freeze({
    personal: "личный токен",
    project: "токен проекта",
    unknown: "токен",
  });

/** One answer shape for every list, so the model never loses the cursor. */
function envelope(
  data: unknown,
  page: WeblatePage | undefined,
  untrusted: boolean,
): Record<string, unknown> {
  const pagination =
    page === undefined
      ? {}
      : {
          pagination: {
            page: page.page,
            perPage: page.perPage,
            ...(page.nextPage === undefined ? {} : { nextPage: page.nextPage }),
            ...(page.total === undefined ? {} : { total: page.total }),
          },
        };
  const marker = untrusted ? { untrustedExternalContent: true } : {};
  if (Array.isArray(data)) return { items: data, ...marker, ...pagination };
  if (typeof data === "object" && data !== null) {
    return { ...(data as Record<string, unknown>), ...marker, ...pagination };
  }
  return { value: data ?? null, ...marker, ...pagination };
}

/**
 * Weblate provider: operator-configured instances over a Weblate API token.
 *
 * Localization state is read-only here. Weblate's search grammar is composed
 * from validated filters rather than accepted from the model, upstream URLs are
 * echoed only when they point at the configured instance and never followed, and
 * every answer that carries upstream-authored text is marked as untrusted
 * content.
 */
export class WeblateProvider implements IntegrationProvider {
  readonly id = "weblate";
  readonly displayName = "Weblate";
  /** What this deployment allows; Weblate's own permissions still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = WEBLATE_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: WeblateTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new WeblateTransport(config, config.weblate, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.weblate));
    const help = resolveCredentialHelp(
      WEBLATE_CREDENTIAL_HELP,
      config.credentialHelp["weblate"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep only the token, tagged with the instance it was minted for. The
   * instance comes from the connect form and from operator config, never from a
   * tool argument, which is what keeps the broker from dialling any host the
   * caller names.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token) || URL_LIKE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a Weblate API token",
      );
    }
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        token,
      } satisfies WeblateCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return weblateOperationCapability(operation);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.weblate, credential);
    // Weblate has no "current user" endpoint. A token that may not administer
    // users answers `GET /api/users/` with its own record alone, which is how
    // the account is identified and the token is proven in one read.
    const { data } = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      "/users/",
      { page_size: 2 },
    );
    const host = new URL(instance.baseUrl).host;
    return {
      tenantId: instance.baseUrl,
      // Empty when the token may list users: this provider will not claim an
      // account it cannot pin down. No operation substitutes it for an argument.
      externalUserId: accountIdFrom(data),
      displayName: `${accountNameFrom(data, host)} · ${TOKEN_KIND_LABEL[tokenKind(credential.token)]}`,
      /**
       * Weblate does not report what the token it was given may do, so there is
       * nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and Weblate itself refuses the rest.
       */
      capabilities: this.capabilities,
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.weblate, credential);
    const definition = WEBLATE_OPERATIONS[operation];
    const handler = WEBLATE_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Weblate operation",
      );
    }
    const flags = this.config.weblate;
    const request: WeblateRequest = handler(input, {
      flags,
      origin: instance.baseUrl,
    });
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
      request.page,
    );
    // Every listing answers with the same envelope, so the projection only ever
    // sees the rows; a single read keeps the object upstream sent.
    const source =
      definition.list === true ? resultsOf(response.data) : response.data;
    const projection = WEBLATE_PROJECTIONS[operation];
    const projectionContext: WeblateProjectionContext = {
      flags,
      origin: instance.baseUrl,
      textLimit: textLimitFor(operation, input["maxChars"], flags),
    };
    const data =
      projection === undefined ? source : projection(source, projectionContext);
    const untrusted = WEBLATE_UNTRUSTED_OPERATIONS.includes(operation);
    if (definition.list === true) {
      return envelope(data, response.page, untrusted);
    }
    return untrusted
      ? { ...objectOf(data), untrustedExternalContent: true }
      : objectOf(data);
  }

  private resolveInstance(requested: string | undefined) {
    const flags: WeblateFlags = this.config.weblate;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = weblateInstance(flags, id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown Weblate instance",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Weblate instance is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a Weblate instance",
      );
    }
    return only;
  }
}

export default WeblateProvider;
