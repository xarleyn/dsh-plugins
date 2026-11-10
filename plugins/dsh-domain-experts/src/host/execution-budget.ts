import type { Context } from "@deepseek-ai/cordis";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";

/** In-process limits for an independent review, never model-supplied options. */
export interface ExpertExecutionBudget {
  readonly maxToolCalls: number;
  readonly maxConsecutiveRefusals: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** Observe only the reserved child and release its activation before failing. */
export function expertExecutionBudget(
  ctx: Context,
  childId: string,
  budget: ExpertExecutionBudget,
) {
  let activation: SubagentActivation | undefined;
  let reason: string | undefined;
  let calls = 0;
  let refusals = 0;
  let disposed = false;
  let releasePromise: Promise<void> | undefined;
  let finished = false;
  const descendants = new Set([childId]);
  const unsubscribeCreated = ctx.on(
    "agent/created",
    ({ agent }) => {
      const header = agent.session.header;
      if (
        header.parentSession !== undefined &&
        descendants.has(String(header.parentSession)) &&
        (header.origin === "subagent" || header.isSeeded !== true)
      )
        descendants.add(String(agent.id));
    },
    { global: true },
  );
  let rejectStopped: (error: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  // Cancellation can arrive before the provider returns its activation.
  void stopped.catch(() => undefined);
  const failure = () => new Error(`expert execution stopped: ${reason}`);
  const release = (): Promise<void> => {
    if (releasePromise !== undefined) return releasePromise;
    if (activation === undefined || disposed) return Promise.resolve();
    disposed = true;
    const current = activation;
    releasePromise = (async () => {
      try {
        await current.dispose();
        rejectStopped(failure());
      } catch {
        rejectStopped(
          new Error(
            `expert execution stopped: ${reason}; activation disposal failed`,
          ),
        );
      }
    })();
    return releasePromise;
  };
  const stop = (cause: string) => {
    if (finished || reason !== undefined) return;
    reason = cause;
    void release();
  };
  const unsubscribe = ctx.on(
    "tools/result",
    (exec, result) => {
      if (
        !descendants.has(String(exec.agent?.id)) ||
        (exec.name === "structured_output" && !result.isError)
      )
        return;
      calls += 1;
      refusals = result.isError ? refusals + 1 : 0;
      if (
        budget.maxConsecutiveRefusals > 0 &&
        refusals >= budget.maxConsecutiveRefusals
      )
        stop("max-consecutive-refusals");
      else if (budget.maxToolCalls > 0 && calls >= budget.maxToolCalls)
        stop("max-tool-calls");
    },
    { global: true },
  );
  const timer =
    budget.timeoutMs > 0
      ? setTimeout(() => stop("review-timeout"), budget.timeoutMs)
      : undefined;
  const abort = () => stop("review-aborted");
  budget.signal.addEventListener("abort", abort, { once: true });
  if (budget.signal.aborted) abort();
  const cleanup = () => {
    finished = true;
    unsubscribe();
    unsubscribeCreated();
    clearTimeout(timer);
    budget.signal.removeEventListener("abort", abort);
  };
  return {
    cleanup,
    bind(value: SubagentActivation): SubagentActivation {
      activation = value;
      if (reason !== undefined) void release();
      const result = Promise.race([value.result, stopped])
        .then(async (outcome) => {
          if (reason !== undefined) {
            await release();
            throw failure();
          }
          return outcome;
        })
        .finally(cleanup);
      return {
        ...value,
        result,
        dispose: async () => {
          cleanup();
          if (!disposed) {
            disposed = true;
            await value.dispose();
          }
        },
      };
    },
  };
}
