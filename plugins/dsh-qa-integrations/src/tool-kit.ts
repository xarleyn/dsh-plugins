import {
  defineTool,
  type ParameterSchemaSpec,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type { IntegrationBroker } from "./broker.js";
import { IntegrationError } from "./errors.js";
import {
  SERVICE_CEILING_NOTICE,
  serviceCeilingRefusedReading,
} from "./providers/shared/service-boundary.js";
import type { OperationSecurityMetadata } from "./service-credentials/types.js";
import type { IntegrationPrincipal, IntegrationProviderId } from "./types.js";

type ToolExecution = Pick<ToolRunContext, "agent">;

const OUTPUT = {
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      provider: { type: "string" as const, required: true },
      operation: { type: "string" as const, required: true },
      data: {
        type: "object" as const,
        required: true,
        additionalProperties: true,
      },
    },
  },
  render: (
    _args: unknown,
    value: { provider: string; operation: string; data: object },
  ) => [{ type: "text" as const, text: JSON.stringify(value.data) }],
} as const;

/**
 * What a provider's tool factory takes from the deployment. One type for all
 * seven, so no factory can be built on a broker alone and go on describing a
 * managed credential this stand never issues.
 */
export interface ProviderToolFactoryOptions {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
  /**
   * Whether this deployment hands out managed service credentials at all. The
   * ceiling is a property of those credentials, so with the slice off a warning
   * about it would send a model away from a reading its own personal connection
   * does answer — the symptom #285 is about, caused by the warning itself. The
   * operator card drops the same note for the same reason.
   */
  readonly managedServiceCredentialsEnabled: boolean;
}

export interface ToolKitOptions extends ProviderToolFactoryOptions {
  readonly provider: IntegrationProviderId;
  /**
   * The provider's own catalog. A tool reads its operation's classification from
   * it and warns in its description when the managed service credential will
   * refuse that reading, so the condition the ceiling enforces is what the model
   * is told before it tries — and a reclassified operation cannot leave the
   * description behind.
   */
  readonly operations: Readonly<
    Record<string, { readonly security: OperationSecurityMetadata }>
  >;
}

/**
 * Shared plumbing for provider tool modules. It owns the one security-relevant
 * step every tool repeats: resolve the QA principal from the DSH session, never
 * from the arguments, and refuse when the session is not bound to a QA user.
 */
export function createToolKit(options: ToolKitOptions) {
  const run = async (
    exec: ToolExecution,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ) => {
    const id = exec.agent?.session?.header?.id;
    if (id === undefined || String(id).trim() === "") {
      throw new IntegrationError(
        "PrincipalNotResolved",
        "QA principal is required",
      );
    }
    const sessionId = String(id);
    const principal = options.principalForSession(sessionId);
    if (principal === undefined) {
      throw new IntegrationError(
        "PrincipalNotResolved",
        "Session is not bound to a QA user",
      );
    }
    return options.broker.call(principal, {
      provider: options.provider,
      operation,
      input,
      sourceSessionId: sessionId,
    });
  };

  /**
   * One tool = one catalog operation with a validated, read-only argument set.
   * No tool may accept a user, credential, integration or tenant selector.
   */
  const tool = <const S extends ParameterSchemaSpec>(definition: {
    readonly name: string;
    readonly description: string;
    readonly parameters: S;
    readonly operation: string;
    readonly input: (args: Record<string, unknown>) => Record<string, unknown>;
  }): ToolDefinition => {
    const security = options.operations[definition.operation]?.security;
    const warns =
      options.managedServiceCredentialsEnabled &&
      serviceCeilingRefusedReading(security);
    return defineTool({
      name: definition.name,
      description: warns
        ? `${definition.description} ${SERVICE_CEILING_NOTICE}`
        : definition.description,
      parameters: definition.parameters,
      output: OUTPUT,
      execute: (args, exec) =>
        run(
          exec,
          definition.operation,
          definition.input(args as Record<string, unknown>),
        ),
    });
  };

  return { tool, run };
}
