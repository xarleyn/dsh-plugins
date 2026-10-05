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
import type { DocumentsFace } from "@yadsh/dsh-documents";
import {
  answerAfter,
  answerForRequest,
  lastPromptSeq,
  ownTurnStillRunning,
} from "./answer.js";
import { attachmentPromptParts } from "./attachments.js";
import type {
  QaFileAttachment,
  QaInlineImageAttachment,
  QaIntegrationAttachment,
  QaIntegrationRunner,
  QaIntegrationTranscript,
  QaIntegrationTurn,
} from "./contract.js";
import { QaIntegrationTranscriptReader } from "./transcript-reader.js";

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
  /**
   * The deployment's document pipeline, resolved per call so a provider that
   * installs later still counts. Absent on a deployment that has none, where
   * document attachments are refused with the caller's own fallback signal.
   */
  documents(): DocumentsFace | undefined;
  logger: PluginLogger;
}

/** Build the runner for one plugin instance. */
export function createQaIntegrationRunner(
  options: QaIntegrationRunnerOptions,
): QaIntegrationRunner {
  const { ctx, logger } = options;

  // One reader for the plugin's lifetime: its whole value is the windows it
  // keeps between calls, so a per-request instance would be a slower copy of
  // the plain projection.
  const transcripts = new QaIntegrationTranscriptReader({
    log: options.sessionLog,
    logger,
  });

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

  /**
   * The prompt of one question: the question, then the attachments.
   *
   * Images keep the shape the harness carries them in. Files are read on the
   * Host — a text file decoded, a document extracted through the deployment's
   * pipeline — and arrive as text under a heading per file, preceded by one
   * lead line so the model knows why the question has more than it asked for.
   * A file that cannot be read throws, which the service turns into the 415
   * the caller's fallback understands: publishing an answer to a question the
   * model could not see the attachment for is worse than asking again without
   * it.
   */
  const promptParts = async (
    message: string,
    attachments: readonly QaIntegrationAttachment[],
    sessionId: string,
    signal: AbortSignal,
  ): Promise<readonly PromptContentPart[]> => {
    const images = attachments
      .filter(
        (attachment): attachment is QaInlineImageAttachment =>
          attachment.kind === "image",
      )
      .map(
        (attachment) =>
          ({
            type: "image",
            mediaType: attachment.mediaType,
            data: attachment.data,
            ...(attachment.name === undefined ? {} : { name: attachment.name }),
          }) as PromptContentPart,
      );
    const files = attachments.filter(
      (attachment): attachment is QaFileAttachment =>
        attachment.kind === "file",
    );
    if (files.length === 0) {
      return [{ type: "text", text: message }, ...images];
    }
    const extracted = await attachmentPromptParts(files, {
      documents: options.documents(),
      sessionId,
      signal,
      logger,
    });
    return [
      { type: "text", text: message },
      ...images,
      { type: "text", text: QA_ATTACHMENT_LEAD },
      ...extracted,
    ];
  };

  /**
   * Stop the turn of a question nobody is waiting for any more.
   *
   * `prompt` carries the caller's signal only up to admission — the harness
   * documents it as cancellation *before* the prompt begins — and
   * `whenIdleOrAborted` ends the wait, not the work. Without this call an
   * abandoned ask keeps generating, keeps its tools running and keeps its
   * chat's agent busy, so every later question continued into that chat waits
   * behind work nobody asked for. The stop is the session's own
   * (`sessionController.cancel`), which aborts the active turn, keeps other
   * callers' queued prompts, and refuses a session this process does not own.
   *
   * Two checks narrow it, because a stop is not recoverable for the turn's real
   * owner: only the caller's own abandonment stops a turn — an expired budget is
   * the escalation the bridge polls with the `chat_id` it was handed, per
   * docs/INTEGRATION-API.md §2.5 — and only when the log says this request's
   * prompt is the turn still running.
   *
   * @param sessionId - the chat the question was admitted into.
   * @param requestId - this request's prompt id, which the log echoes back.
   * @param callerSignal - the caller's lifetime alone, absent for a caller that
   * cannot tell its own giving-up apart from the deployment's budget.
   */
  async function abandonTurn(
    sessionId: string,
    requestId: string,
    callerSignal: AbortSignal | undefined,
  ): Promise<void> {
    if (callerSignal === undefined || !callerSignal.aborted) return;
    try {
      const read = await options.sessionLog.read(sessionId);
      // A turn this request did not open is not this request's to stop, and an
      // unreadable log cannot say whose turn is running — both leave it alone.
      if (!read.ok || !ownTurnStillRunning(read.events, requestId)) return;
      ctx.sessionController.cancel({ sessionId: SessionId(sessionId) });
      logger.warn("integration.turn-abandoned", { sessionId, requestId });
    } catch (error) {
      // The caller is already gone and the wait is already over: why a stop
      // failed is a fact for the log, not a failure of this request.
      logger.warn("integration.turn-abandon-refused", {
        sessionId,
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async run(input: {
      readonly userId: string;
      readonly chatId: string | null;
      readonly message: string;
      readonly attachments: readonly QaIntegrationAttachment[];
      readonly ticketKey: string | null;
      readonly signal: AbortSignal;
      readonly callerSignal?: AbortSignal;
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
      const content = await promptParts(
        input.message,
        input.attachments,
        chatId,
        input.signal,
      );
      // The client mints this identity; the harness brands it. A plain UUID
      // is exactly what a browser sends, and it is what makes the prompt
      // idempotent if the same question is ever retried.
      const requestId = randomUUID() as SessionRequestId;
      await ctx.sessionController.prompt(
        {
          requestId,
          sessionId: SessionId(chatId),
          mode: "queue",
          content,
        },
        input.signal,
      );
      const agent = ctx.agents.get(SessionId(chatId));
      if (agent === undefined) {
        throw new Error("the QA session has no live agent");
      }
      // Past this point the question is the harness's, and only this call can
      // hand it back: the wait ends on the caller's signal, and a caller that
      // gave up for good gets its own turn stopped rather than left running.
      await whenIdleOrAborted(agent, input.signal, () => {
        // Deliberately not awaited. The decision reads the session log, and an
        // abandoned question must not spend one more moment of the caller's
        // concurrency slot on a read whose only purpose is to stop work nobody
        // is waiting for.
        void abandonTurn(chatId, requestId, input.callerSignal);
      });
      const read = await options.sessionLog.read(chatId);
      if (!read.ok) {
        throw new Error(`the session log is unavailable (${read.reason})`);
      }
      // This request's own turn answers it. The harness echoes the prompt's rpc
      // id onto the durable user row, so the turn is found by that id instead of
      // by "the newest prompt in the log": two questions in flight on one chat
      // commit two turns, and reading the newest of them answers each caller with
      // the other's turn. The cursor fallback is for the one case correlation
      // cannot serve — a prompt whose row the read did not reach yet — and it is
      // the later of the cursor taken before the question and the newest human
      // prompt, so no earlier turn can be read as this one's answer.
      const projected = answerForRequest(read.events, requestId) ?? {
        ...answerAfter(
          read.events,
          Math.max(floor, lastPromptSeq(read.events)),
        ),
        turn: null,
      };
      return Object.freeze({
        chatId,
        answer: projected.answer,
        sources: sourcesOf(chatId, projected.turn),
        interrupted: projected.interrupted,
      });
    },

    async transcript(input: {
      readonly chatId: string;
      readonly after: number;
      readonly limit: number;
    }): Promise<QaIntegrationTranscript> {
      return await transcripts.page(input.chatId, {
        after: input.after,
        limit: input.limit,
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
   * The evidence of one turn, for the bridge's citations. The provenance store
   * materializes one bundle per turn, so the bundle named by the turn that
   * answered is the one that belongs to the answer just written — the newest
   * bundle is only the same thing while one turn is the last one in the chat.
   * `turn` is null when the answer came from a log that named no turn for it,
   * and the newest bundle is then the best the citation has. A deployment that
   * switched source collection off answers with an empty list rather than no
   * answer.
   */
  function sourcesOf(
    sessionId: string,
    turn: number | null,
  ): readonly QaSourceReference[] {
    try {
      const bundles = options.provenance.bundles(sessionId);
      if (turn === null) return bundles.at(-1)?.sources ?? [];
      return bundles.find((bundle) => bundle.turn === turn)?.sources ?? [];
    } catch (error) {
      logger.warn("integration.sources-unavailable", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

/**
 * The one line that explains the text parts after the question. It says where
 * the material came from and nothing about what to do with it: the deployment's
 * own prompt notes own the instructions, and this block is content.
 */
const QA_ATTACHMENT_LEAD =
  "Вложения к этому вопросу — файлы, пришедшие из внешней системы вместе с " +
  "обращением. Их содержимое приведено ниже под заголовком с именем файла.";

/**
 * Wait for the agent to reach quiescence, or for the caller to give up.
 *
 * `onAbandon` fires the moment the wait ends early, and is not awaited: a
 * request that stopped waiting owes its caller an answer or an escalation, not
 * the time it takes to find out whether the work it left behind is its own to
 * stop. The hook is not called when the agent settles on its own terms.
 */
async function whenIdleOrAborted(
  agent: Agent,
  signal: AbortSignal,
  onAbandon: () => void,
): Promise<void> {
  if (signal.aborted) {
    onAbandon();
    throw abortReason(signal);
  }
  try {
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
  } catch (error) {
    // Only a wait that ended early abandons anything: an agent that failed on
    // its own has already stopped.
    if (signal.aborted) onAbandon();
    throw error;
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new Error("the integration request was aborted");
}
