import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaStoredSessionEraser } from "./admin/session-log.js";
import type { QaSessionModelPolicy } from "./access/model-policy.js";
import {
  assertModelPairAvailable,
  projectModelCatalog,
} from "./access/model-policy.js";
import {
  qaAttestationFailureMessage,
  QaAttestationError,
} from "./attestation.js";
import { prepareQaUserWorkspace } from "./user-workspace.js";
import { applySessionModelPolicy } from "./session-model.js";
import type { ResolvedQaSurfaceConfig } from "./types.js";

export interface QaSessionCreateOptions {
  readonly ctx: Context;
  readonly config: ResolvedQaSurfaceConfig;
  readonly logger: PluginLogger;
  readonly sessionFiles: QaStoredSessionEraser;
  reserve(id: string): { readonly id: string } | undefined;
  release(owner: string, id: string): void;
  modelPolicy(id: string): QaSessionModelPolicy;
  preflight(): void;
  admit(id: string): Promise<unknown>;
  attest(id: string, owner: string | undefined): void;
  reject(id: string): void;
  /** Drop failure-only metadata after resource and ownership cleanup succeeds. */
  forget(id: string): void;
}

/** Preserve the original admission cause rather than the Host RPC wrapper. */
function creationFailure(error: unknown): Error {
  return new Error(
    qaAttestationFailureMessage("Unable to create a QA session.", error),
    { cause: error },
  );
}

/**
 * Admit inside the native factory's serial publication callback. A failure is
 * rolled back by the Host's lifecycle owner before we erase this UUID's log;
 * native preset composition and dynamic default-model hooks stay intact.
 */
export async function createQaSession(
  options: QaSessionCreateOptions,
): Promise<string> {
  const { ctx, config, logger } = options;
  if (config.session.policy === "fixed")
    throw new Error("Fixed QA sessions cannot be created.");
  const id = SessionId(`session-${randomUUID()}`);
  const owner = options.reserve(id);
  let creating = false;
  let removeListener: (() => void) | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  let attachmentAttempted = false;
  let workspace: ReturnType<Context["workspaceRegistry"]["get"]>;
  try {
    options.preflight();
    workspace =
      config.session.workspaceId === null
        ? undefined
        : ctx.workspaceRegistry.get(WorkspaceId(config.session.workspaceId));
    if (config.session.workspaceId !== null && workspace === undefined)
      throw new Error("Configured QA workspace is unavailable.");
    let cwd = workspace?.path ?? config.session.cwd ?? process.cwd();
    if (config.accounts.perUserWorkspace) {
      if (owner === undefined || workspace === undefined)
        throw new Error("Per-user QA workspace configuration is unavailable.");
      cwd = prepareQaUserWorkspace(workspace.path, owner.id);
    }
    const policy = options.modelPolicy(id);
    if (policy.pair !== undefined)
      assertModelPairAvailable(
        policy.pair,
        projectModelCatalog(await ctx.sessionController.modelCatalog()),
      );
    removeListener = ctx.on(
      "agent/created",
      async ({ agent }) => {
        if (String(agent.session.id) !== id) return;
        try {
          if (!config.accounts.perUserWorkspace && workspace !== undefined) {
            attachmentAttempted = true;
            await workspace.attachSession(id);
          }
          await applySessionModelPolicy(ctx, id, policy, logger);
          await options.admit(id);
          options.attest(id, owner?.id);
        } catch (error) {
          callbackError = error;
          callbackFailed = true;
          throw error;
        }
      },
      { global: true },
    );
    creating = true;
    await ctx.sessionController.create({
      sessionId: id,
      cwd,
      ...(config.session.agentPreset === null
        ? {}
        : { agentPreset: config.session.agentPreset }),
    });
    return id;
  } catch (failure) {
    const error = callbackFailed ? callbackError : failure;
    options.reject(id);
    let removed = !creating;
    if (creating) {
      try {
        // Native create has already awaited its owned factory rollback. Never
        // erase a journal if an incompatible/failing Host still has it live.
        if (
          ctx.agents.get(id) !== undefined ||
          ctx.sessions.get(id) !== undefined
        )
          throw new Error("The failed QA session is still live.", {
            cause: failure,
          });
        if (attachmentAttempted) await workspace?.detachSession(id);
        const erased = await options.sessionFiles.erase([id]);
        removed = erased.removed.includes(id);
      } catch (cleanupError) {
        logger.error("session.create-cleanup-rejected", {
          sessionId: id,
          error: String(cleanupError),
        });
      }
    }
    // A non-directory backend, failed disposal, or failed erasure retains the
    // owner fence and the runtime refusal instead of leaving a claimable log.
    if (removed) {
      try {
        if (owner !== undefined) options.release(owner.id, id);
        options.forget(id);
      } catch (cleanupError) {
        logger.error("session.create-cleanup-rejected", {
          sessionId: id,
          error: String(cleanupError),
        });
      }
    }
    logger.error("session.create-rejected", {
      sessionId: id,
      reason: error instanceof QaAttestationError ? error.reason : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw creationFailure(error);
  } finally {
    removeListener?.();
  }
}
