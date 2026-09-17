import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { requiredInteger, requiredText } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import { redactSecrets } from "../../redaction.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import { accountName, objectOf } from "../shared/account.js";
import {
  artifactBinaryProblem,
  artifactByteLimit,
  textArtifact,
} from "./artifacts.js";
import {
  TEAMCITY_CAPABILITY_INFO,
  TEAMCITY_OPERATIONS,
  enabledCapabilities,
  teamcityOperationCapability,
} from "./catalog.js";
import type { TeamCityFlags } from "./config.js";
import {
  logLines,
  logMode,
  sanitizeLog,
  selectLogWindow,
  trimToBytes,
} from "./logs.js";
import {
  TEAMCITY_HANDLERS,
  TEAMCITY_PROJECTIONS,
  currentUserRequest,
  problemsRequest,
  serverRequest,
  testsRequest,
  type TeamCityProjectionContext,
  type TeamCityRequest,
} from "./operations.js";
import { TEAMCITY_CREDENTIAL_HELP } from "./credential-help.js";
import {
  TeamCityTransport,
  configuredServer,
  credentialFromPlaintext,
  type TeamCityCredential,
} from "./transport.js";

export {
  configuredServer,
  credentialFromPlaintext,
  type TeamCityCredential,
} from "./transport.js";

/**
 * A TeamCity access token is opaque: the server documents no shape, so the only
 * checks worth making are the ones that catch a paste mistake — a URL instead of
 * a token, or whitespace that a copy carried along.
 */
const TOKEN_SHAPE = /^\S{16,4096}$/u;
const URL_LIKE = /^https?:\/\//iu;

/**
 * TeamCity provider: one TeamCity server per QA user, connected with that user's
 * own personal access token.
 *
 * The server address is user input, so it is checked against the deployment's
 * address policy when the connection is stored and again on every call, and the
 * token is never part of a URL, a tool argument or a log line.
 */
export class TeamcityProvider implements IntegrationProvider {
  readonly id = "teamcity";
  readonly displayName = "TeamCity";
  /** What this deployment is willing to expose; TeamCity's own rights still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = TEAMCITY_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: TeamCityTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new TeamCityTransport(config, config.teamcity, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.teamcity));
    const help = resolveCredentialHelp(
      TEAMCITY_CREDENTIAL_HELP,
      config.credentialHelp["teamcity"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep the pasted token. The server it will be dialled at is this
   * deployment's configuration — never a connect-form field and never a tool
   * argument — so a token minted for another TeamCity fails against the address
   * the operator set instead of pointing the broker at a host the caller chose.
   * A deployment with no address configured refuses here, so the connect form
   * cannot store a credential that could never be used.
   */
  parseCredential(raw: string): {
    readonly credential: string;
    readonly portal: string;
  } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token) || URL_LIKE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a TeamCity access token",
      );
    }
    const serverUrl = this.config.teamcity.serverUrl;
    if (serverUrl === "") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "This deployment has no TeamCity address configured",
      );
    }
    return {
      credential: JSON.stringify({ token } satisfies TeamCityCredential),
      portal: serverUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return teamcityOperationCapability(operation);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const baseUrl = configuredServer(this.config.teamcity);
    const server = await this.transport.getJson<Record<string, unknown>>(
      baseUrl,
      credential.token,
      serverRequest().path,
      serverRequest().query,
    );
    const user = await this.transport.getJson<Record<string, unknown>>(
      baseUrl,
      credential.token,
      currentUserRequest().path,
      currentUserRequest().query,
    );
    const id = user["id"];
    if (typeof id !== "number") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "TeamCity identity is unavailable",
      );
    }
    const version =
      typeof server["version"] === "string" ? server["version"].trim() : "";
    return {
      tenantId: baseUrl,
      externalUserId: String(id),
      displayName:
        version === ""
          ? accountName(user, "TeamCity")
          : `${accountName(user, "TeamCity")} · TeamCity ${version}`,
      /**
       * TeamCity does not report the restrictions of the token it was given, so
       * there is nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and TeamCity itself refuses the rest.
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
    const baseUrl = configuredServer(this.config.teamcity);
    const definition = TEAMCITY_OPERATIONS[operation];
    const handler = TEAMCITY_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported TeamCity operation",
      );
    }
    const flags = this.config.teamcity;
    const operationContext = {
      externalUserId: context.externalUserId,
      flags,
    };
    if (operation === "connection.get") {
      return this.readConnection(baseUrl, credential, input, flags);
    }
    if (operation === "failures.get") {
      return this.readFailures(baseUrl, credential, input, flags);
    }
    if (operation === "builds.log") {
      return this.readLog(baseUrl, credential, input, flags);
    }
    if (operation === "artifacts.text") {
      return this.readArtifact(baseUrl, credential, input, flags);
    }
    const request = handler(input, operationContext);
    const data = await this.transport.getJson<unknown>(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "rest",
    );
    return this.project(operation, data, input, request, baseUrl);
  }

  /** Server identity: one answer out of the two documented discovery calls. */
  private async readConnection(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const server = serverRequest();
    const user = currentUserRequest();
    const [serverData, userData] = await Promise.all([
      this.transport.getJson<unknown>(
        baseUrl,
        credential.token,
        server.path,
        server.query,
      ),
      this.transport.getJson<unknown>(
        baseUrl,
        credential.token,
        user.path,
        user.query,
      ),
    ]);
    const projection = TEAMCITY_PROJECTIONS["connection.get"];
    return objectOf(
      projection?.(
        { server: serverData, user: userData },
        {
          flags,
          input,
          serverUrl: baseUrl,
        },
      ),
    );
  }

  /**
   * Failed tests and build problems in one answer: "why did it fail" is one
   * question, and making the model stitch two low-level calls together only
   * invites it to report half of the reason.
   */
  private async readFailures(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const withTests = input["includeTests"] !== false;
    const withProblems = input["includeProblems"] !== false;
    const tests = withTests
      ? await this.read(baseUrl, credential, testsRequest(buildId))
      : {};
    const problems = withProblems
      ? await this.read(baseUrl, credential, problemsRequest(buildId))
      : {};
    const projection = TEAMCITY_PROJECTIONS["failures.get"];
    return objectOf(
      projection?.({ buildId, tests, problems }, { flags, input }),
    );
  }

  /**
   * A build log is a stream of external text. It is downloaded up to the
   * deployment's byte budget, stripped of terminal control sequences and secret
   * shapes, and cut to the lines the caller asked for: a multi-megabyte log
   * never reaches the model context.
   */
  private async readLog(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const mode = logMode(input["mode"]);
    const maxLines = logLines(input["maxLines"], flags.maxLogLines);
    const query =
      input["query"] === undefined
        ? undefined
        : requiredText(input["query"], "query", 1, 200);
    const request = TEAMCITY_HANDLERS["builds.log"]?.({ buildId }, { flags });
    if (request === undefined) {
      throw new IntegrationError("InvalidRequest", "Unsupported log operation");
    }
    const download = await this.transport.getText(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "server",
      flags.maxLogBytes,
    );
    const text = sanitizeLog(download.binary ? "" : download.text);
    const window = selectLogWindow(text, mode, maxLines, query);
    const redacted = String(redactSecrets(window.text) ?? "");
    const trimmed = trimToBytes(redacted, flags.maxLogBytes);
    return {
      buildId,
      mode,
      text: trimmed.text,
      returnedLines: window.returnedLines,
      ...(window.matched === undefined ? {} : { matched: window.matched }),
      downloadedBytes: download.bytes,
      // The download itself was cut short, so in `tail` mode this is the end of
      // what was downloaded, not the end of the build.
      logTruncated: download.truncated || download.binary,
      truncated: window.truncated || trimmed.truncated,
    };
  }

  /**
   * One text artifact. Archives, images, binaries and key material are refused
   * by name before a byte is requested, the rest is bounded, and the terminal
   * text is redacted like any other external content.
   */
  private async readArtifact(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const handler = TEAMCITY_HANDLERS["artifacts.text"];
    if (handler === undefined) {
      throw new IntegrationError("InvalidRequest", "Unsupported artifact read");
    }
    const request = handler(input, { flags });
    const path = request.artifactPath ?? "";
    const problem = artifactBinaryProblem(path);
    if (problem !== undefined) {
      throw new IntegrationError("InvalidRequest", problem);
    }
    const limit = artifactByteLimit(input["maxBytes"], flags);
    const body = await this.transport.getText(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      "rest",
      limit,
    );
    const answer = textArtifact(path, body.bytes, limit, {
      text: String(redactSecrets(body.text) ?? ""),
      binary: body.binary,
      truncated: body.truncated,
    });
    return {
      buildId: requiredInteger(input["buildId"], "buildId"),
      ...answer,
    };
  }

  private read(
    baseUrl: string,
    credential: TeamCityCredential,
    request: TeamCityRequest,
  ): Promise<unknown> {
    return this.transport.getJson<unknown>(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "rest",
    );
  }

  private project(
    operation: string,
    data: unknown,
    input: Readonly<Record<string, unknown>>,
    request: TeamCityRequest,
    serverUrl: string,
  ): Record<string, unknown> {
    const projection = TEAMCITY_PROJECTIONS[operation];
    const context: TeamCityProjectionContext = {
      flags: this.config.teamcity,
      input,
      serverUrl,
      artifactPath: request.artifactPath,
    };
    return objectOf(
      projection === undefined ? data : projection(data, context),
    );
  }
}

export default TeamcityProvider;
