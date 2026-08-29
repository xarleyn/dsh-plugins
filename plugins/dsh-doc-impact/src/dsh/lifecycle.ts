import { createUserMessage } from '@deepseek-ai/dsh-llm';

/** Structural view of the host context — no cordis import needed by tests. */
export interface LifecycleContext {
  on(event: string, listener: (...args: never[]) => unknown): unknown;
  logger: {
    info(message: string, ...values: unknown[]): void;
    warn(message: string, ...values: unknown[]): void;
    error(message: string, ...values: unknown[]): void;
  };
}

interface SessionLike {
  readonly id: string;
  readonly header: { readonly cwd?: string } | undefined;
  readonly events: readonly { readonly type: string; readonly data: unknown }[];
}

interface AgentLike {
  readonly id: string;
  readonly session: SessionLike;
  steer(message: unknown): void;
}

interface EngineFacade {
  ensureBaseline(sessionId: string, cwd: string, turn: number): Promise<void>;
  evaluateStop(
    sessionId: string,
    cwd: string,
    turn: number,
    options?: { dryRun?: boolean },
  ): Promise<{ steer: string | undefined }>;
  disposeTurn(sessionId: string, turn: number): void;
  disposeSession(sessionId: string): void;
}

/**
 * The number of the currently open turn, or the last closed one. Turn keys in
 * the engine follow this value, so tool/command call sites mid-turn and at the
 * stop boundary address the same runtime.
 */
export function currentTurnNumber(events: SessionLike['events']): { turn: number; open: boolean } {
  let turn = 0;
  let open = false;
  for (const event of events) {
    if (event.type === 'turn/start') {
      const next = (event.data as { turn?: unknown }).turn;
      if (typeof next === 'number') {
        turn = next;
        open = true;
      }
    } else if (event.type === 'turn/end') {
      open = false;
    }
  }
  return { turn, open };
}

function sessionCwd(session: SessionLike): string | undefined {
  const cwd = session.header?.cwd;
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined;
}

function steerMessage(text: string): unknown {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'doc-impact',
      form: 'notice',
      summary: 'Documentation impact check',
    },
  });
}

/**
 * DSH lifecycle wiring (SPEC §65-§66):
 * - `session/event` turn/start warms the baseline, turn/end frees the runtime;
 * - `agent/pre-step` of step 1 awaits the baseline before any model action, so
 *   it always precedes the agent's first mutation;
 * - `agent/turn-stopping` runs the stop check and steers the agent when
 *   unresolved impacts demand another step. Every listener fails open: a
 *   plugin error must never break the agent loop.
 */
export function registerLifecycle(ctx: LifecycleContext, engine: EngineFacade): void {
  ctx.on('session/event', ((session: SessionLike, event: { type: string; data: unknown }) => {
    const cwd = sessionCwd(session);
    if (cwd === undefined) return;
    const sessionId = String(session.id);
    const data = event.data as { turn?: unknown };
    if (event.type === 'turn/start' && typeof data.turn === 'number') {
      void engine.ensureBaseline(sessionId, cwd, data.turn).catch(() => undefined);
    } else if (event.type === 'turn/end' && typeof data.turn === 'number') {
      engine.disposeTurn(sessionId, data.turn);
    }
  }) as never);

  ctx.on('session/disposed', ((session: SessionLike) => {
    engine.disposeSession(String(session.id));
  }) as never);

  ctx.on('agent/pre-step', (async (
    payload: { agent?: AgentLike; turn?: number; step?: number; signal?: AbortSignal },
    next: () => Promise<unknown>,
  ) => {
    try {
      const { agent, turn, step } = payload;
      const cwd = agent === undefined ? undefined : sessionCwd(agent.session);
      if (agent !== undefined && cwd !== undefined && turn !== undefined && step === 1) {
        await engine.ensureBaseline(String(agent.id), cwd, turn);
      }
    } catch {
      // Baseline problems must not block the step; evaluateStop fails open too.
    }
    return next();
  }) as never);

  ctx.on('agent/turn-stopping', (async (payload: { agent?: AgentLike; turn?: number; signal?: AbortSignal }) => {
    try {
      const { agent, turn, signal } = payload;
      if (agent === undefined || turn === undefined) return;
      if (signal?.aborted === true) return;
      const cwd = sessionCwd(agent.session);
      if (cwd === undefined) return;
      const decision = await engine.evaluateStop(String(agent.id), cwd, turn);
      if (decision.steer !== undefined) {
        agent.steer(steerMessage(decision.steer));
      }
    } catch (error) {
      ctx.logger.warn('dsh-doc-impact: turn-stopping check failed; allowing stop (%s)', error);
    }
  }) as never);
}
