import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { redactSecrets } from "../../redaction.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import { objectOf } from "../shared/account.js";
import {
  assertReadableSize,
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentName,
} from "./attachments.js";
import {
  TESTIT_CAPABILITY_INFO,
  TESTIT_OPERATIONS,
  enabledCapabilities,
  testitOperationCapability,
} from "./catalog.js";
import type { TestitFlags, TestitInstance } from "./config.js";
import {
  TESTIT_HANDLERS,
  TESTIT_PROJECTIONS,
  contentBlock,
  type TestitRequest,
} from "./operations.js";
import {
  TestitTransport,
  credentialFromPlaintext,
  credentialInstance,
  type TestitCredential,
} from "./transport.js";

export {
  credentialFromPlaintext,
  credentialInstance,
  type TestitCredential,
} from "./transport.js";

/**
 * Test IT API tokens are opaque: the platform documents no shape, so the only
 * checks worth making are the ones that catch a paste mistake — a URL instead
 * of a token, or whitespace a copy carried along.
 */
const TOKEN_SHAPE = /^\S{16,4096}$/u;
const URL_LIKE = /^https?:\/\//iu;

/**
 * Test IT provider: one Test IT installation per QA user, connected with that
 * user's own API token.
 *
 * The installation is operator configuration — the connect form only picks from
 * the configured list — so the broker cannot be pointed at a host of the
 * caller's choosing, and the address is re-resolved from config on every call,
 * which makes removing or repointing an instance take effect at once.
 */
export class TestitProvider implements IntegrationProvider {
  readonly id = "testit";
  readonly displayName = "Test IT";
  /** What this deployment is willing to expose; Test IT's own rights still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = TESTIT_CAPABILITY_INFO;

  private readonly transport: TestitTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new TestitTransport(config, config.testit, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.testit));
  }

  /**
   * Keep only the token, tagged with the installation it was minted for. The
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
        "Use a Test IT API token",
      );
    }
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        token,
      } satisfies TestitCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return testitOperationCapability(operation);
  }

  /**
   * The documented first validation call is the project list: an authorized
   * answer proves the address and the token at once, and an empty project list
   * is a valid authorization result rather than a failure. Test IT API v2 has no
   * endpoint that names the token owner, so no identity is stored — the answer
   * reports what the probe proved and nothing more.
   */
  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.testit, credential);
    const connection = TESTIT_HANDLERS["connection.get"];
    if (connection === undefined) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Test IT connection probe is unavailable",
      );
    }
    const probeRequest = connection({}, { flags: this.config.testit });
    const probe = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      probeRequest.path,
      probeRequest.query,
    );
    const visible =
      probe.page?.total ?? (Array.isArray(probe.data) ? probe.data.length : 0);
    return {
      tenantId: instance.baseUrl,
      externalUserId: "",
      displayName: `${instance.label} · Test IT API v2, проектов видно: ${visible}`,
      /**
       * Test IT does not report the permissions of the token it was given, so
       * there is nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and Test IT itself refuses the rest.
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
    const instance = credentialInstance(this.config.testit, credential);
    const definition = TESTIT_OPERATIONS[operation];
    const handler = TESTIT_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Test IT operation",
      );
    }
    const flags = this.config.testit;
    const request = handler(input, { flags });
    if (definition.stream === true) {
      return this.readAttachment(instance, credential, input, request, flags);
    }
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
    );
    const projection = TESTIT_PROJECTIONS[operation];
    if (projection === undefined) return objectOf(response.data);
    const projected = projection(response.data, {
      flags,
      input,
      page: response.page,
      instanceLabel: instance.label,
      baseUrl: instance.baseUrl,
    });
    // A list projection already answered with its envelope; a single-resource
    // answer is wrapped so every tool result has the same object shape.
    return definition.list === undefined ? objectOf(projected) : projected;
  }

  /**
   * One attachment, read as text. Test IT describes the file — its name and its
   * size — before a byte is requested, and this provider trusts that description
   * over anything the caller said: an archive, a screenshot, a document or a key
   * is refused by name, a file bigger than the budget is refused by size, and
   * the body that does come back is bounded, redacted and marked as external
   * content.
   */
  private async readAttachment(
    instance: TestitInstance,
    credential: TestitCredential,
    input: Readonly<Record<string, unknown>>,
    request: TestitRequest,
    flags: TestitFlags,
  ): Promise<Record<string, unknown>> {
    const metadata = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      `${request.path}/metadata`,
      {},
    );
    const described = objectOf(metadata.data);
    const attachmentId = String(input["attachmentId"] ?? "");
    const name = attachmentName(described["name"]) || `${attachmentId}`;
    const problem = attachmentBinaryProblem(name);
    if (problem !== undefined) {
      throw new IntegrationError("InvalidRequest", problem);
    }
    const declared = described["size"];
    const declaredBytes =
      typeof declared === "number" && Number.isFinite(declared)
        ? declared
        : undefined;
    const limit = attachmentByteLimit(input["maxBytes"], flags);
    assertReadableSize(declaredBytes, limit);
    const body = await this.transport.getText(
      instance,
      credential.token,
      request.path,
      limit,
    );
    const text = body.binary ? "" : String(redactSecrets(body.text) ?? "");
    return {
      attachmentId,
      name,
      type: typeof described["type"] === "string" ? described["type"] : null,
      declaredBytes: declaredBytes ?? null,
      downloadedBytes: body.bytes,
      binary: body.binary,
      truncated: body.truncated,
      ...(body.binary ? {} : { untrustedContent: contentBlock(text, limit) }),
    };
  }

  private resolveInstance(requested: string | undefined): TestitInstance {
    const flags = this.config.testit;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = flags.instances.find((item) => item.id === id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown Test IT instance",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Test IT instance is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a Test IT instance",
      );
    }
    return only;
  }
}

export default TestitProvider;
