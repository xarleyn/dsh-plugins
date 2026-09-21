/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * Per-session OpenViking runtime: initialization, capture, commit, flush and
 * the offline pending-queue drainer.
 *
 * The runtime never decides *whether* automatic context should be presented —
 * that belongs to the plugin entry, which simply does not call
 * {@link OpenVikingRuntime.profileMessage} / {@link OpenVikingRuntime.recallMessage}
 * when the injection controls turn them off (SPEC §9-§12). Capture and commit
 * are therefore reachable in every mode, including `autoInject: false`.
 */

import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

import {
  captureEvent,
  OPENVIKING_PLUGIN_SOURCE,
  promptText,
} from "./capture.js";
import { traceIdOf, type OpenVikingClient } from "./api-client.js";
import type { InjectionPlan, ResolvedConfig } from "./config.js";
import { buildProfileBlock } from "./openviking/profile-inject.js";
import {
  dequeue,
  enqueue,
  listPending,
  replayPending,
  type PendingEntryType,
} from "./openviking/pending-queue.js";
import { buildRecallBlock } from "./openviking/recall-core.js";
import { isRetryableFailure } from "./openviking/retryable.js";
import { deriveHarnessSessionId } from "./openviking/session-model.js";
import { resolveEffectivePeerId } from "./openviking/workspace-peer.js";

/** The subset of a session event the runtime forwards to the capture path. */
interface RuntimeEvent {
  readonly type?: string;
  readonly time?: number;
  readonly data?: unknown;
}

interface SessionState {
  readonly dshSessionId: string;
  readonly ovSessionId: string;
  config: ResolvedConfig;
  ready: boolean;
  profileBlock: string;
  profileDelivered: boolean;
  /** The framed recall block this session's conversation already carries. */
  lastRecallBlock: string;
  readonly toolNames: Map<string, string>;
  writes: Promise<void>;
  initializationRetryable: boolean;
  hasPendingWrites: boolean;
  pendingCreatedAt: number;
  disposing: Promise<void> | null;
  initializing: Promise<SessionState> | null;
}

export class OpenVikingRuntime {
  private readonly client: OpenVikingClient;
  private readonly config: ResolvedConfig;
  private readonly logger: PluginLogger;
  private readonly injection: InjectionPlan;
  private readonly states = new Map<string, SessionState>();
  private drainTimer: NodeJS.Timeout | null = null;
  private drainRunning = false;
  private drainHealth: boolean | null = null;

  constructor(
    client: OpenVikingClient,
    config: ResolvedConfig,
    logger: PluginLogger,
    injection: InjectionPlan,
  ) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.injection = injection;
  }

  stateFor(session: Session): SessionState {
    let state = this.states.get(session.id);
    if (state) return state;
    const cwd = session.header?.cwd || process.cwd();
    const peer = resolveEffectivePeerId({
      cfg: {
        peerId: this.config.explicitPeerId,
        peerSource: this.config.peerSource,
        workspacePeer: this.config.workspacePeer,
        harness: this.config.harness,
      },
      cwd,
    });
    state = {
      dshSessionId: String(session.id),
      ovSessionId: deriveHarnessSessionId("dsh-", String(session.id)),
      config: {
        ...this.config,
        peerId: peer.peerId,
        legacyPeerId: peer.legacyPeerId,
      },
      ready: false,
      profileBlock: "",
      profileDelivered: false,
      lastRecallBlock: "",
      toolNames: new Map(),
      writes: Promise.resolve(),
      initializationRetryable: false,
      hasPendingWrites: false,
      pendingCreatedAt: 0,
      disposing: null,
      initializing: null,
    };
    this.states.set(session.id, state);
    return state;
  }

  async initialize(agent: Agent): Promise<SessionState> {
    const state = this.stateFor(agent.session);
    return this.ensureState(state);
  }

  async ensureState(state: SessionState): Promise<SessionState> {
    if (state.ready) return state;
    if (state.initializing) return state.initializing;
    state.initializing = this.initializeState(state).finally(() => {
      state.initializing = null;
    });
    return state.initializing;
  }

  async initializeState(state: SessionState): Promise<SessionState> {
    state.initializationRetryable = false;
    const health = await this.client.healthResult();
    if (!health.ok) {
      state.initializationRetryable = isRetryableFailure(health);
      return state;
    }
    const ensured = await this.client.ensureSessionResult(
      state.ovSessionId,
      state.config.peerId,
    );
    if (
      !ensured.ok &&
      !(ensured.status === 409 && ensured.error?.code === "ALREADY_EXISTS")
    ) {
      state.initializationRetryable = isRetryableFailure(ensured);
      return state;
    }
    // Replay is a write, so it stays behind the same toggle: a backlog queued
    // while capture was on waits for a session that still writes.
    if (state.config.syncTurns) {
      await this.replayPendingQueue();
    }
    await this.refreshPendingState(state);
    // Initialization is shared by every capability, but the profile belongs to
    // automatic context presentation alone: when both profile paths are off,
    // the read is skipped outright rather than fetched and discarded (SPEC
    // §12). Recall and capture still initialize their session normally.
    const profile = this.profileWanted()
      ? await buildProfileBlock(
          (path, init, options) => this.client.fetchJSON(path, init, options),
          state.config.profileTokenBudget,
          state.config.peerId,
        )
      : null;
    state.profileBlock = profile?.block
      ? [
          '<openviking-context source="profile">',
          profile.block,
          "</openviking-context>",
        ].join("\n")
      : "";
    state.ready = true;
    return state;
  }

  /** Whether an enabled path could still deliver a profile in this session. */
  private profileWanted(): boolean {
    return this.injection.startupProfile || this.injection.stepProfile;
  }

  /**
   * The startup/pending profile message, or `null` when there is nothing (left)
   * to deliver. Claiming is one-shot per session: the first caller either gets
   * the block or marks it delivered so a later step does not repeat it.
   */
  async profileMessage(agent: Agent): Promise<UserMessage | null> {
    const state = await this.initialize(agent);
    if (!state.ready || !state.profileBlock || state.profileDelivered)
      return null;
    if (hasStartupProfile(agent)) {
      state.profileDelivered = true;
      return null;
    }
    state.profileDelivered = true;
    return pluginMessage(state.profileBlock, "instructions");
  }

  async recallMessage(
    agent: Agent,
    messages: readonly UserMessage[],
  ): Promise<UserMessage | null> {
    const state = await this.initialize(agent);
    if (!state.ready) return null;
    const query = promptText(messages);
    if (query.length < state.config.minQueryLength) return null;
    const block = await buildRecallBlock(
      (path, init, options) => this.client.fetchJSON(path, init, options),
      state.config,
      query,
      {
        actorPeerId: state.config.peerId,
        legacyPeerId: state.config.legacyPeerId,
        sessionId: state.ovSessionId,
        log: (stage, data) => this.log(stage, data),
      },
    );
    if (!block) return null;
    const framed = withRecallFraming(block);
    // Injected context stays in the conversation, so delivering an identical
    // block again tells the model nothing it cannot still read above. The
    // server's own dedup window is counted in turns; this one is the session.
    if (framed === state.lastRecallBlock) return null;
    state.lastRecallBlock = framed;
    return pluginMessage(framed, "recall");
  }

  capture(session: Session, event: RuntimeEvent): void {
    const state = this.stateFor(session);
    if (!state.config.syncTurns) return;
    const payload = captureEvent(event, state.config, state.toolNames);
    if (!payload) return;
    this.enqueueWrite(state, async () => {
      if (state.hasPendingWrites) {
        await this.enqueuePendingMessage(state, payload);
        return;
      }
      if (!state.ready && !(await this.ensureState(state)).ready) {
        if (state.initializationRetryable) {
          await this.enqueuePendingMessage(state, payload);
        }
        return;
      }
      if (state.hasPendingWrites) {
        await this.enqueuePendingMessage(state, payload);
        return;
      }
      const response = await this.client.addMessage(
        state.ovSessionId,
        payload,
        state.config.peerId,
      );
      if (isRetryableFailure(response)) {
        await this.enqueuePendingMessage(state, payload);
      }
    });
  }

  maybeCommit(session: Session, event: RuntimeEvent): void {
    if (event.type !== "turn/end") return;
    const state = this.stateFor(session);
    if (!state.config.syncTurns) return;
    this.enqueueWrite(state, async () => {
      if (state.hasPendingWrites) return;
      if (!state.ready && !(await this.ensureState(state)).ready) return;
      const metadata = await this.client.getSession(
        state.ovSessionId,
        state.config.peerId,
      );
      if (
        Number(metadata?.pending_tokens || 0) <
        state.config.commitTokenThreshold
      )
        return;
      const response = await this.client.commitSession(
        state.ovSessionId,
        state.config.peerId,
      );
      this.log("commit", {
        sessionId: state.ovSessionId,
        ok: response.ok,
        trace_id: traceIdOf(response.result) || response.traceId,
        error: response.ok
          ? undefined
          : response.error?.message || response.error?.code,
      });
      if (isRetryableFailure(response)) {
        await this.enqueueFinalCommit(state, {
          keep_recent_count: state.config.commitKeepRecentCount,
        });
      }
    });
  }

  dispose(session: Session): Promise<void> {
    return this.disposeById(session.id);
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.states.values()].map((state) =>
        this.disposeById(state.dshSessionId),
      ),
    );
  }

  private disposeById(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) return Promise.resolve();
    if (state.disposing) return state.disposing;
    state.disposing = (async () => {
      this.enqueueWrite(state, async () => {
        if (!state.config.syncTurns) return;
        const commitPayload = {
          keep_recent_count: state.config.commitKeepRecentCount,
        };
        if (state.hasPendingWrites) {
          await this.enqueueFinalCommit(state, commitPayload);
          return;
        }
        if (!state.ready && !(await this.ensureState(state)).ready) return;
        const response = await this.client.commitSession(
          state.ovSessionId,
          state.config.peerId,
          {
            timeoutMs: Math.min(
              3000,
              Number(state.config.requestTimeoutMs) || 3000,
            ),
          },
        );
        this.log("shutdown_commit", {
          sessionId: state.ovSessionId,
          ok: response.ok,
          trace_id: traceIdOf(response.result) || response.traceId,
        });
        if (isRetryableFailure(response)) {
          await this.enqueueFinalCommit(state, commitPayload);
        }
      });
      try {
        await state.writes;
      } finally {
        if (this.states.get(sessionId) === state) this.states.delete(sessionId);
      }
    })();
    return state.disposing;
  }

  private enqueueWrite(
    state: SessionState,
    operation: () => Promise<void>,
  ): void {
    state.writes = state.writes.then(operation).catch((error) =>
      this.log("write_error", {
        sessionId: state.ovSessionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private async enqueuePending(
    state: SessionState,
    type: PendingEntryType,
    payload: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const createdAt = Math.max(Date.now(), state.pendingCreatedAt + 1);
    state.pendingCreatedAt = createdAt;
    const result = await enqueue(type, state.ovSessionId, payload, {
      createdAt,
    });
    if (result.ok) {
      // Log the latch transition only: every message that follows while the
      // latch holds takes the cheap enqueue path, so this fires once per
      // outage, not once per message.
      if (!state.hasPendingWrites) {
        this.log("pending_latched", { sessionId: state.ovSessionId, type });
      }
      state.hasPendingWrites = true;
    }
    if (!result.ok) {
      this.log("pending_enqueue_error", {
        sessionId: state.ovSessionId,
        type,
        error: result.error,
      });
    }
    return result;
  }

  private async enqueueFinalCommit(
    state: SessionState,
    payload: unknown,
  ): Promise<void> {
    await this.removePendingCommits(state);
    await this.enqueuePending(state, "commitSession", payload);
  }

  private async enqueuePendingMessage(
    state: SessionState,
    payload: unknown,
  ): Promise<void> {
    const result = await this.enqueuePending(state, "addMessage", payload);
    if (result.ok) await this.removePendingCommits(state);
  }

  private async removePendingCommits(state: SessionState): Promise<void> {
    const pending = await listPending();
    for (const item of pending) {
      if (
        item.entry?.type === "commitSession" &&
        item.entry.sessionId === state.ovSessionId
      ) {
        await dequeue(item.filename);
      }
    }
  }

  async refreshPendingState(state: SessionState): Promise<void> {
    const wasPending = state.hasPendingWrites;
    const pending = (await listPending()).filter(
      (item) => item.entry?.sessionId === state.ovSessionId,
    );
    state.hasPendingWrites = pending.length > 0;
    state.pendingCreatedAt = pending.reduce(
      (latest, item) => Math.max(latest, Number(item.entry?.createdAt || 0)),
      state.pendingCreatedAt,
    );
    // Only the flip back to direct sends is logged: the recovery moment that
    // proves the drainer worked, once per outage.
    if (wasPending && !state.hasPendingWrites) {
      this.log("pending_cleared", { sessionId: state.ovSessionId });
    }
  }

  /**
   * Replay the pending queue through this runtime's client. The session-start
   * path calls it without options and keeps consuming retries; the drainer
   * passes consumeRetries:false so transient failures stay retryable.
   */
  async replayPendingQueue(
    options: { readonly consumeRetries?: boolean } = {},
  ): Promise<void> {
    await replayPending(
      (path, init) => this.client.fetchJSON(path, init),
      (stage, data) => this.log(stage, data),
      options,
    );
  }

  /**
   * One drainer tick, following the session-start replay flow: probe health
   * first and only replay when the server answers. Replays run without
   * consuming retry budgets, then every session's latch is re-derived from
   * the queue. An empty queue clears the latches with zero HTTP traffic, so
   * once a transient write failure recovers, capture and commit resume on
   * their own without restarting the long-lived dsh process.
   */
  async drainTick(): Promise<void> {
    if (this.drainRunning) return;
    this.drainRunning = true;
    try {
      const pending = await listPending();
      if (pending.length > 0) {
        const health = await this.client.healthResult();
        if (!health.ok) {
          // Only the flip into the outage is logged, not every 60s probe.
          if (this.drainHealth !== false) {
            this.log("drain_health_down", { status: health.status || 0 });
          }
          this.drainHealth = false;
        } else {
          if (this.drainHealth === false) {
            this.log("drain_health_restored", {});
          }
          this.drainHealth = true;
          await this.replayPendingQueue({ consumeRetries: false });
        }
      }
      for (const state of this.states.values()) {
        await this.refreshPendingState(state);
      }
    } finally {
      this.drainRunning = false;
    }
  }

  /**
   * Start the background drainer. The interval is fixed per process; each tick
   * is single-flight, so a slow replay run never overlaps the next one.
   */
  startDrainer(): NodeJS.Timeout {
    if (this.drainTimer) return this.drainTimer;
    const parsed = parseInt(
      process.env.OPENVIKING_PENDING_DRAIN_INTERVAL_MS || "",
      10,
    );
    const intervalMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
    this.drainTimer = setInterval(() => {
      void this.drainTick().catch((error) =>
        this.log("drain_error", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }, intervalMs);
    this.drainTimer.unref?.();
    return this.drainTimer;
  }

  stopDrainer(): void {
    if (!this.drainTimer) return;
    clearInterval(this.drainTimer);
    this.drainTimer = null;
  }

  async flush(session: Session): Promise<void> {
    const state = this.states.get(session.id);
    if (state) await state.writes;
  }

  /** Whether the last health probe reached OpenViking. */
  get connected(): boolean {
    return this.client.connected;
  }

  /** Number of sessions this runtime currently tracks. */
  get liveSessions(): number {
    return this.states.size;
  }

  /** Snapshot of the connection flag for diagnostics. */
  healthSnapshot(): boolean {
    return this.connected;
  }

  /** Snapshot of the tracked-session count for diagnostics. */
  sessionCount(): number {
    return this.liveSessions;
  }

  /** Diagnostic stage record; lands in the plugin log file at `debug`. */
  private log(stage: string, data: Record<string, unknown> | undefined): void {
    this.logger.debug(stage, data ?? {});
  }
}

/**
 * What a recall block says about itself. The injected memories are background:
 * the issue behind this line is a model that read a memory miss as "the answer
 * is not here" and kept querying the store for a document the session already
 * had. The prompt-side rule lives in the `openviking-memory` skill; this is the
 * copy that travels with every block, skill or no skill.
 */
const RECALL_FRAMING =
  "Background memory from earlier sessions — supporting context, not the source " +
  "of record. What the product is, and any file this session already has, comes " +
  "from the documentation, document and expert tools; a miss here is not " +
  "evidence that no source exists.";

/**
 * Put the framing where the model reads first: right under the envelope's
 * opening tag, ahead of the block's own header line.
 */
function withRecallFraming(block: string): string {
  const opening = /^<openviking-context\b[^>]*>\n?/.exec(block);
  if (!opening) return `${RECALL_FRAMING}\n${block}`;
  const rest = block.slice(opening[0].length);
  return `${opening[0]}${RECALL_FRAMING}\n${rest}`;
}

function pluginMessage(
  content: string,
  form: "instructions" | "recall",
): UserMessage {
  // dsh's own constructor: identity, normalization, and any future Message
  // invariants come from the pinned peer instead of a hand-built object.
  return createUserMessage({
    content: [{ type: "text", text: content }],
    source: {
      kind: "plugin",
      plugin: OPENVIKING_PLUGIN_SOURCE,
      form,
    },
  });
}

/**
 * Whether this agent's own history (or queued inbox) already carries a startup
 * profile this plugin injected — the check that keeps a resumed or forked
 * session from receiving the profile twice.
 */
function hasStartupProfile(agent: Agent): boolean {
  const session = agent.session;
  // `ownEvents()` is the fork-aware view of the session log: the parent's
  // inherited prefix is excluded, so a fork re-injects its own profile.
  const inHistory = session
    .ownEvents()
    .some(
      (event) => event.type === "user/message" && isStartupProfile(event.data),
    );
  if (inHistory) return true;
  return [agent.inbox?.nextTurn, agent.inbox?.nextStep].some((messages) =>
    (messages || []).some(isStartupProfile),
  );
}

function isStartupProfile(message: unknown): boolean {
  const source = (
    message as {
      source?: { kind?: unknown; plugin?: unknown; form?: unknown };
    } | null
  )?.source;
  return (
    source?.kind === "plugin" &&
    source.plugin === OPENVIKING_PLUGIN_SOURCE &&
    source.form === "instructions"
  );
}
