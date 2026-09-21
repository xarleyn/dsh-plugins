import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  PromptContentPart,
  SessionRequestId,
} from "@deepseek-ai/dsh-api-session-controller";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaAccessService } from "../access/service.js";
import type { QaAccounts } from "../accounts/store.js";
import type { QaSessionLogReader } from "../admin/session-log.js";
import type { QaProvenanceHost } from "../provenance/host-store.js";
import type { QaSourceReference } from "../provenance/types.js";
import type { QaPolicyAdmission } from "../secure-session.js";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import { prepareQaUserWorkspace } from "../user-workspace.js";
import { answerAfter, lastPromptSeq } from "./answer.js";
import type {
  QaIntegrationAttachment,
  QaIntegrationRunner,
  QaIntegrationTurn,
} from "./contract.js";

/**
 * The session half of the integration API: open a chat, send one question,
 * wait for the turn, read the answer.
 *
 * It is deliberately not a new turn engine. Opening a chat goes through the
 * same three steps the browser's `createSession` takes — the deployment
 * preflight, the per-user workspace, then `secureSession` — because that last
 * call is what pins the QA tool policy, attaches the QA catalog and records
 * the chat as attested. A question is admitted with
 * `sessionController.prompt`, the same call the browser makes; the wait is
 * `agent.whenIdle()`, which is the harness's own definition of "this turn is
 * over"; the answer is read back from the durable log rather than from the
 * live assistant stream, so what the bridge publishes is what was committed.
 */

export interface QaIntegrationRunnerOptions {
  ctx: Context;
  getConfig(): ResolvedQaSurfaceConfig;
  /** The accounts store, or undefined while accounts are disabled. */
  accounts(): QaAccounts | undefined;
  admission: QaPolicyAdmission;
  access: QaAccessService;
  sessionLog: QaSessionLogReader;
  provenance: QaProvenanceHost;
  logger: PluginLogger;
}

/** Build the runner for one plugin instance. */
export function createQaIntegrationRunner(
  options: QaIntegrationRunnerOptions,
): QaIntegrationRunner {
  const { ctx, logger } = options;

  const requireAccounts = (): QaAccounts => {
    const accounts = options.accounts();
    if (accounts === undefined) {
      throw new Error("QA accounts are not enabled on this deployment.");
    }
    return accounts;
  };

  const openChat = async (input: {
    readonly userId: string;
    readonly ticketKey: string | null;
  }): Promise<string> => {
    const config = options.getConfig();
    const accounts = requireAccounts();
    const owner = accounts.accountById(input.userId);
    if (owner === undefined) {
      throw new Error("the integration token's account no longer exists");
    }
    const id = SessionId(`session-${randomUUID()}`);
    // The ownership record is written before the session exists, exactly as
    // the browser path does it: the id is minted here, so no other caller can
    // claim it in between, and a failure below rolls the record back.
    options.access.reserveSessionForUser(owner, String(id));
    try {
      options.admission.preflightDeployment();
      let userCwd: string | undefined;
      if (config.accounts.perUserWorkspace) {
        const workspaceId = config.session.workspaceId;
        if (workspaceId === null) {
          throw new Error(
            "Per-user QA workspace configuration is unavailable.",
          );
        }
        const workspace = ctx.workspaceRegistry.get(WorkspaceId(workspaceId));
        if (workspace === undefined) {
          throw new Error(
            `Configured QA workspace ${workspaceId} is unavailable.`,
          );
        }
        userCwd = prepareQaUserWorkspace(workspace.path, owner.id);
      }
      const created = await ctx.sessionController.create({
        sessionId: id,
        ...(userCwd !== undefined
          ? { cwd: userCwd }
          : config.session.workspaceId !== null
            ? { workspaceId: WorkspaceId(config.session.workspaceId) }
            : config.session.cwd !== null
              ? { cwd: config.session.cwd }
              : {}),
        ...(config.session.agentPreset === null
          ? {}
          : { agentPreset: config.session.agentPreset }),
      });
      if (config.session.provider !== null && config.session.model !== null) {
        await ctx.sessionController.selectModel({
          sessionId: created.sessionId,
          provider: config.session.provider,
          model: config.session.model,
          ...(config.session.reasoningEffort === null
            ? {}
            : { reasoningEffort: config.session.reasoningEffort }),
        });
      }
      const sessionId = String(created.sessionId);
      await options.admission.secureSessionForUser(owner.id, sessionId);
      logger.info("integration.chat-opened", {
        sessionId,
        userId: owner.id,
        ticketKey: input.ticketKey,
      });
      return sessionId;
    } catch (error) {
      // Nothing else would ever remove the record: the chat was never
      // returned to the caller, so no later call can name it.
      accounts.releaseSessionReservation(owner.id, String(id));
      throw error;
    }
  };

  /** The newest durable cursor in a log, or 0 when there is nothing to read. */
  const floorOf = async (sessionId: string): Promise<number> => {
    const read = await options.sessionLog.read(sessionId);
    if (!read.ok) return 0;
    return read.events.reduce((max, event) => Math.max(max, event.seq), 0);
  };

  const promptParts = (
    message: string,
    attachments: readonly QaIntegrationAttachment[],
  ): readonly PromptContentPart[] => [
    { type: "text", text: message },
    ...attachments.map(
      (attachment) =>
        ({
          type: "image",
          mediaType: attachment.mediaType,
          data: attachment.data,
          ...(attachment.name === undefined ? {} : { name: attachment.name }),
        }) as PromptContentPart,
    ),
  ];

  return {
    async run(input: {
      readonly userId: string;
      readonly chatId: string | null;
      readonly message: string;
      readonly attachments: readonly QaIntegrationAttachment[];
      readonly ticketKey: string | null;
      readonly signal: AbortSignal;
      readonly onChat?: (chatId: string) => void;
    }): Promise<QaIntegrationTurn> {
      const chatId =
        input.chatId === null
          ? await openChat({
              userId: input.userId,
              ticketKey: input.ticketKey,
            })
          : input.chatId;
      input.onChat?.(chatId);
      if (input.chatId !== null) {
        // A continued chat is re-attested before every question. The same call
        // the browser makes when it opens a session: it is what refuses a
        // chat belonging to another account (the ownership record is the
        // authority) and what keeps the tool policy applied to a session
        // resumed by a process that has never seen it.
        await options.admission.secureSessionForUser(input.userId, chatId);
      }
      const floor = await floorOf(chatId);
      // The client mints this identity; the harness brands it. A plain UUID
      // is exactly what a browser sends, and it is what makes the prompt
      // idempotent if the same question is ever retried.
      const requestId = randomUUID() as SessionRequestId;
      await ctx.sessionController.prompt(
        {
          requestId,
          sessionId: SessionId(chatId),
          mode: "queue",
          content: promptParts(input.message, input.attachments),
        },
        input.signal,
      );
      const agent = ctx.agents.get(SessionId(chatId));
      if (agent === undefined) {
        throw new Error("the QA session has no live agent");
      }
      await whenIdleOrAborted(agent, input.signal);
      const read = await options.sessionLog.read(chatId);
      if (!read.ok) {
        throw new Error(`the session log is unavailable (${read.reason})`);
      }
      // The prompt's own event may be missing from an empty snapshot, so the
      // floor is the later of the cursor taken before the question and the
      // newest human prompt the log knows about. Either way the answer is the
      // last assistant message after it, and no earlier turn can be read as
      // this one's answer.
      const projected = answerAfter(
        read.events,
        Math.max(floor, lastPromptSeq(read.events)),
      );
      return Object.freeze({
        chatId,
        answer: projected.answer,
        sources: sourcesOf(chatId),
        interrupted: projected.interrupted,
      });
    },

    async models(): Promise<readonly string[]> {
      const catalog = await ctx.sessionController.modelCatalog();
      return catalog.groups.flatMap((group) =>
        group.models.map((model) => model.id),
      );
    },
  };

  /**
   * The evidence of the chat's latest turn, for the bridge's citations. The
   * provenance store materializes one bundle per turn; the newest is the one
   * that belongs to the answer just written. A deployment that switched
   * source collection off answers with an empty list rather than no answer.
   */
  function sourcesOf(sessionId: string): readonly QaSourceReference[] {
    try {
      const bundles = options.provenance.bundles(sessionId);
      return bundles.at(-1)?.sources ?? [];
    } catch (error) {
      logger.warn("integration.sources-unavailable", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

/** Wait for the agent to reach quiescence, or for the caller to give up. */
async function whenIdleOrAborted(
  agent: Agent,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  await Promise.race([
    agent.whenIdle(),
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          reject(abortReason(signal));
        },
        { once: true },
      );
    }),
  ]);
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new Error("the integration request was aborted");
}
