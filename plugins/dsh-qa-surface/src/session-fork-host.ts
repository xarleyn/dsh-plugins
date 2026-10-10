import type { Context } from "@deepseek-ai/cordis";
import type { AgentHandle } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-agent-preset-registry";
import {
  buildForkSeed,
  SessionLogOffset,
  SessionSeq,
} from "@deepseek-ai/dsh-session";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { randomUUID } from "node:crypto";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaAccounts } from "./accounts/store.js";
import type { QaAccessService } from "./access/service.js";
import type { QaPolicyAdmission } from "./secure-session.js";
import type { QaIntegrationPrincipalBindings } from "./integration-principals.js";
import type { QaProvenanceHost } from "./provenance/host-store.js";
import type { QaStoredSessionEraser } from "./admin/session-log.js";
import type { ResolvedQaSurfaceConfig } from "./types.js";
import { qaAttestationFailureMessage } from "./attestation.js";
import { qaForkBoundary } from "./session-fork.js";
import { qaDelegatedHeader } from "./shared/session-lineage.js";
import { applySessionModelPolicy } from "./session-model.js";

export interface QaForkHostOptions {
  readonly ctx: Context;
  readonly config: ResolvedQaSurfaceConfig;
  readonly accounts: Pick<
    QaAccounts,
    | "currentUser"
    | "ownerIdOf"
    | "sessionAccess"
    | "updateSessionAccess"
    | "releaseSessionReservation"
  > | undefined;
  readonly access: Pick<
    QaAccessService,
    "isDelegatedChild" | "session" | "reserveSession" | "modelPolicyFor"
  >;
  readonly admission: Pick<
    QaPolicyAdmission,
    "secureSession" | "preflightDeployment"
  >;
  readonly principals: Pick<QaIntegrationPrincipalBindings, "attest">;
  readonly provenance: Pick<QaProvenanceHost, "forkSnapshots" | "dropSession">;
  readonly logger: PluginLogger;
  readonly sessionFiles: QaStoredSessionEraser;
  readonly sharing?: {
    forkAuthors(sourceId: string, targetId: string, requests: readonly string[]): void;
    dropSession(id: string): void;
  };
}

/** Native durable prefix and agent lifecycle, admitted as an independent QA root. */
export async function forkQaSession(
  options: QaForkHostOptions,
  token: string,
  sourceId: string,
  answerSeq: number,
): Promise<string> {
  const {
    ctx,
    config,
    accounts,
    access,
    admission,
    principals,
    provenance,
    logger,
  } = options;
  if (config.session.policy === "fixed")
    throw new Error("Fixed QA sessions cannot be forked.");
  const actor =
    accounts === undefined ? undefined : accounts.currentUser(token);
  // Admin inspection is not permission to copy another account's material.
  if (accounts !== undefined && accounts.ownerIdOf(sourceId) !== actor?.id)
    throw new Error("Only the chat owner may create a branch.");
  if (access.isDelegatedChild(sourceId))
    throw new Error("A delegated session cannot be forked as a QA chat.");
  await admission.secureSession(token, sourceId);
  const source = await ctx.sessionController.inspect(SessionId(sourceId));
  if (qaDelegatedHeader(source.meta))
    throw new Error("A delegated session cannot be forked as a QA chat.");
  const boundary = qaForkBoundary(source.events, answerSeq);
  const role =
    accounts === undefined ? undefined : access.session(token, sourceId);
  const snapshot = accounts?.sessionAccess(sourceId)?.capabilitySnapshot;
  admission.preflightDeployment();
  const childId = String(SessionId(`session-${randomUUID()}`));
  let handle: AgentHandle | undefined;
  try {
    if (accounts !== undefined && role !== undefined) {
      access.reserveSession(token, childId, role.subrole.id, role.adminPreview);
      if (snapshot !== undefined)
        accounts.updateSessionAccess(childId, { capabilitySnapshot: snapshot });
    }
    const parent = ctx.agents.get(SessionId(sourceId));
    if (parent === undefined)
      throw new Error("The source agent is unavailable.");
    const presetId =
      ctx.agentPresets.composedPreset(parent.ctx) ?? source.meta.agentPreset;
    const preset = await ctx.agentPresets.resolve(presetId);
    const inheritedEventCount = SessionLogOffset(boundary.atSeq + 1);
    const meta = {
      ...source.meta,
      id: SessionId(childId),
      parentSession: SessionId(sourceId),
      isSeeded: true,
      agentPreset: preset.id,
    };
    const seed = buildForkSeed(source.events, SessionSeq(boundary.atSeq));
    const inbox = ctx.sessionProjections.restore({}, seed, SessionLogOffset(0),
      meta, inheritedEventCount).snapshot.values.inbox;
    if (inbox === undefined) throw new Error("The native Inbox projection is unavailable.");
    // A queued prompt may already exist before the selected turn finishes.
    // Keep its historical event, but cancel pending input in the child before
    // publication so creating a branch cannot launch an inherited request.
    for (const target of ["next-step", "next-turn"] as const) {
      if (inbox[target].length === 0) continue;
      seed.push({ type: "agent/inbox/spliced", seq: SessionSeq(seed.length),
        time: source.events[boundary.atSeq]?.time ?? Date.now(),
        data: { target, start: 0, removedCount: inbox[target].length, inserted: [] } });
    }
    // Use native seed and lifecycle APIs, retaining the handle for rollback.
    // Ownership is reserved before either session/created or agent/created.
    options.sharing?.forkAuthors(sourceId, childId, seed.flatMap(event =>
      event.type === "user/message" && "rpcId" in event.data.source ? [String(event.data.source.rpcId)] : []));
    handle = await ctx.agents.create({
      sessionId: SessionId(childId),
      seed,
      inheritedEventCount,
      meta: {
        parentSession: SessionId(sourceId),
        isSeeded: true,
        agentPreset: preset.id,
        ...(source.meta.cwd === undefined ? {} : { cwd: source.meta.cwd }),
      },
      agentOptions: parent.options,
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, preset.id);
      },
    });
    const policy = access.modelPolicyFor(childId);
    const selection = parent.session.requestHeader()?.config ?? parent.options;
    if (
      policy.pair === undefined &&
      (selection.provider === undefined || selection.model === undefined)
    )
      throw new Error("The source model selection is unavailable.");
    await applySessionModelPolicy(
      ctx,
      SessionId(childId),
      policy.pair !== undefined
        ? policy
        : {
            pair: {
              provider: selection.provider as string,
              model: selection.model as string,
              ...(selection.reasoningEffort === undefined
                ? {}
                : { reasoningEffort: selection.reasoningEffort }),
            },
            layer: undefined,
          },
      logger,
    );
    const workspace = ctx.workspaceRegistry
      .list()
      .find((entry) => entry.sessionIds.includes(SessionId(sourceId)));
    if (workspace !== undefined)
      await workspace.attachSession(SessionId(childId));
    await admission.secureSession(token, childId);
    principals.attest(childId, actor?.id, accounts?.ownerIdOf(childId));
    provenance.forkSnapshots(sourceId, childId, boundary.turn);
    logger.info("session.fork-created", {
      sourceId,
      sessionId: childId,
      atSeq: boundary.atSeq,
    });
    return childId;
  } catch (error) {
    if (childId !== undefined) {
      // Only this call's new child is disposed. A failed admission cannot
      // leave a writable agent or a sidebar reservation behind.
      let removed = handle === undefined;
      try {
        await handle?.dispose();
        if (handle !== undefined) {
          const erased = await options.sessionFiles.erase([childId]);
          removed = erased.removed.includes(childId);
        }
      } catch (cleanupError) {
        logger.error("session.fork-cleanup-rejected", {
          sessionId: childId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
      // A non-directory persistence backend cannot prove erasure. Retain
      // its owner fence rather than leave a sensitive seeded log claimable.
      if (actor !== undefined && removed)
        accounts?.releaseSessionReservation(actor.id, childId);
      principals.attest(childId, undefined, undefined);
      provenance.dropSession(childId);
      options.sharing?.dropSession(childId);
    }
    logger.error("session.fork-rejected", {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      qaAttestationFailureMessage("Unable to fork a QA session.", error),
      { cause: error },
    );
  }
}
