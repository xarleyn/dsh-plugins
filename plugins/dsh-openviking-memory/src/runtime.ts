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
import { OpenVikingClient, traceIdOf } from "./api-client.js";
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

/**
 * What one session's account changes about its memory: which OpenViking user
 * space the session reads and writes, and which automatic context additions it
 * still wants. A runtime built without a resolver keeps the single
 * deployment-wide identity and the configured plan, which is how a plugin
 * installed without a QA surface behaves.
 */
export interface SessionScoping {
  /** Whether this session may use memory at all. */
  readonly allowed: boolean;
  /** The account's space; absent falls back to the deployment's own user. */
  readonly user?: string;
  /** The deployment's plan after this account's overrides narrowed it. */
  readonly plan: InjectionPlan;
}

/** The runtime asks this about a session before it touches OpenViking. */
export type SessionScopingResolver = (session: Session) => SessionScoping;

interface SessionState {
  readonly dshSessionId: string;
  readonly ovSessionId: string;
  /** The peer this session's workspace resolved to, fixed at creation. */
  readonly peerId: string;
  readonly legacyPeerId: string;
  /**
   * The configuration this session's requests are built from. Derived on every
   * {@link OpenVikingRuntime.adoptScoping} rather than frozen at creation, so a
   * committed settings change reaches sessions that are already running.
   */
  config: ResolvedConfig;
  /** The client carrying this session's identity headers. */
  client: OpenVikingClient;
  /** What this session's account allows; re-read on every step. */
  scoping: SessionScoping;
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
  private client: OpenVikingClient;
  private config: ResolvedConfig;
  private readonly logger: PluginLogger;
  /** The plan a session without an account scoping of its own falls back to. */
  private injection: InjectionPlan;
  private readonly scoping: SessionScopingResolver | undefined;
  private readonly states = new Map<string, SessionState>();
  /**
   * One client per account space. A client is a config plus a fetch closure, so
   * the map is cheap; it exists because the identity travels in request headers
   * that a call site cannot override.
   */
  private readonly clients = new Map<string, OpenVikingClient>();
  /** Which account space a live session's pending writes belong to. */
  private readonly sessionOwners = new Map<string, string>();
  private drainTimer: NodeJS.Timeout | null = null;
  private drainRunning = false;
  private drainHealth: boolean | null = null;
  /** Built once; the answer for every session this runtime cannot attribute. */
  private deployment: SessionScoping | undefined;

  constructor(
    client: OpenVikingClient,
    config: ResolvedConfig,
    logger: PluginLogger,
    injection: InjectionPlan,
    scoping?: SessionScopingResolver,
  ) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.injection = injection;
    this.scoping = scoping;
  }

  /**
   * Adopt a re-resolved configuration — what a committed settings change hands
   * over. The identity clients are keyed by account and built from the config,
   * so they are dropped rather than kept: the next request any session makes
   * builds a client for the new endpoint and credentials, and every session's
   * plan is re-read from its account on that same step.
   */
  reconfigure(config: ResolvedConfig, injection: InjectionPlan): void {
    this.config = config;
    this.injection = injection;
    this.clients.clear();
    this.deployment = undefined;
    this.client = new OpenVikingClient(config);
  }

  stateFor(session: Session): SessionState {
    let state = this.states.get(session.id);
    if (state) {
      // Attribution can land after the session starts: a restarted host
      // resumes chats before their browser half re-claims them. Re-reading the
      // scoping here is what lets such a session pick up its account (and its
      // per-account switches) without being recreated.
      this.adoptScoping(state, session);
      return state;
    }
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
      peerId: peer.peerId,
      legacyPeerId: peer.legacyPeerId,
      config: this.config,
      client: this.client,
      scoping: this.deploymentScoping(),
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
    this.adoptScoping(state, session);
    this.states.set(session.id, state);
    return state;
  }

  /**
   * Bind a state to the account space its session belongs to. The plan and the
   * client are only ever swapped together: a session whose attribution arrives
   * late starts reading the account's space on the same step its switches take
   * effect, and a session whose account is never resolved is left alone.
   */
  private adoptScoping(state: SessionState, session: Session): void {
    const scoping = this.scoping?.(session) ?? this.deploymentScoping();
    const user = scoping.user ?? this.config.user;
    state.scoping = scoping;
    state.config = {
      ...this.config,
      peerId: state.peerId,
      legacyPeerId: state.legacyPeerId,
      user,
    };
    state.client = this.clientFor(user);
    const owner = scoping.user;
    if (owner === undefined) this.sessionOwners.delete(state.ovSessionId);
    else this.sessionOwners.set(state.ovSessionId, owner);
  }

  /**
   * The client an account's own reads speak with: the page that shows a person
   * what the assistant remembers has to read the same space that person's chats
   * read. With per-account scoping off there is one space for everybody, so the
   * deployment's own client is the honest answer rather than a new identity.
   */
  readClientFor(user: string, scoped: boolean): OpenVikingClient {
    return scoped ? this.clientFor(user) : this.client;
  }

  /** The scoping of a session nobody has claimed: the configured one. */
  private deploymentScoping(): SessionScoping {
    this.deployment ??= Object.freeze({
      allowed: true,
      plan: this.injection,
    });
    return this.deployment;
  }

  /** The client that speaks as one OpenViking user, created on first use. */
  private clientFor(user: string): OpenVikingClient {
    if (user === "" || user === this.config.user) return this.client;
    let client = this.clients.get(user);
    if (client === undefined) {
      client = new OpenVikingClient({ ...this.config, user });
      this.clients.set(user, client);
    }
    return client;
  }

  /**
   * The client a queued write must be replayed with.
   *
   * A queue is a file on disk that outlives the process, and the identity is
   * not part of what gets queued, so an entry is attributed through the session
   * that wrote it. When that session is not known to this process — a restart
   * that has not resumed it yet — the replay refuses to send rather than guess:
   * a write sent as the wrong account is worse than one that waits for its
   * session to come back. Deployments without per-account scoping keep the
   * single deployment identity, where nothing can be misattributed.
   */
  private clientForQueued(path: string): OpenVikingClient | undefined {
    if (this.scoping === undefined) return this.client;
    const sessionId = ovSessionIdFromPath(path);
    if (sessionId === undefined) return this.client;
    const user = this.sessionOwners.get(sessionId);
    if (user === undefined) return undefined;
    return this.clientFor(user);
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
    const client = state.client;
    const health = await client.healthResult();
    if (!health.ok) {
      state.initializationRetryable = isRetryableFailure(health);
      return state;
    }
    const ensured = await client.ensureSessionResult(
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
    const profile = this.profileWanted(state)
      ? await buildProfileBlock(
          (path, init, options) => client.fetchJSON(path, init, options),
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
  private profileWanted(state: SessionState): boolean {
    return state.scoping.plan.startupProfile || state.scoping.plan.stepProfile;
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
      (path, init, options) => state.client.fetchJSON(path, init, options),
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
    if (!state.scoping.allowed || !state.config.syncTurns) return;
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
      const response = await state.client.addMessage(
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
    if (!state.scoping.allowed || !state.config.syncTurns) return;
    this.enqueueWrite(state, async () => {
      if (state.hasPendingWrites) return;
      if (!state.ready && !(await this.ensureState(state)).ready) return;
      const metadata = await state.client.getSession(
        state.ovSessionId,
        state.config.peerId,
      );
      if (
        Number(metadata?.pending_tokens || 0) <
        state.config.commitTokenThreshold
      )
        return;
      const response = await state.client.commitSession(
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
        if (!state.scoping.allowed || !state.config.syncTurns) return;
        const commitPayload = {
          keep_recent_count: state.config.commitKeepRecentCount,
        };
        if (state.hasPendingWrites) {
          await this.enqueueFinalCommit(state, commitPayload);
          return;
        }
        if (!state.ready && !(await this.ensureState(state)).ready) return;
        const response = await state.client.commitSession(
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
   * Replay the pending queue. Each entry is sent through the account space of
   * the session that queued it ({@link clientForQueued}); the session-start
   * path calls this without options and keeps consuming retries, while the
   * drainer passes consumeRetries:false so transient failures stay retryable.
   */
  async replayPendingQueue(
    options: { readonly consumeRetries?: boolean } = {},
  ): Promise<void> {
    await replayPending(
      (path, init) => {
        const client = this.clientForQueued(path);
        if (client !== undefined) return client.fetchJSON(path, init);
        // Nothing was sent: status 0 reads as a transient failure, so the
        // entry stays queued instead of landing in the wrong account space.
        return Promise.resolve({
          ok: false,
          result: null,
          status: 0,
          error: {
            message:
              "the session that queued this write is not attached to an account space yet",
          },
        });
      },
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
    if (this.client.connected) return true;
    for (const client of this.clients.values()) {
      if (client.connected) return true;
    }
    return false;
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
 * The OpenViking session id inside one queued request path. The queue builds
 * that path itself, so this reads back exactly the shape it wrote.
 */
function ovSessionIdFromPath(path: string): string | undefined {
  const captured = /\/api\/v1\/sessions\/([^/]+)\//.exec(path)?.[1];
  if (captured === undefined) return undefined;
  try {
    return decodeURIComponent(captured);
  } catch {
    return undefined;
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
