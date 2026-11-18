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
  let releasePromise: Promise<void> | undefined;
  let finished = false;
  const descendants = new Set([childId]);
  const countToolCalls =
    budget.maxToolCalls > 0 || budget.maxConsecutiveRefusals > 0;
  const unsubscribeCreated = countToolCalls
    ? ctx.on(
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
      )
    : undefined;
  let rejectStopped: (error: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  // Cancellation can arrive before the provider returns its activation.
  void stopped.catch(() => undefined);
  const failure = () => new Error(`expert execution stopped: ${reason}`);
  const disposeActivation = (): Promise<void> => {
    const current = activation;
    if (current === undefined) return Promise.resolve();
    return (releasePromise ??= Promise.resolve().then(() => current.dispose()));
  };
  const cancelActivation = () => {
    if (activation === undefined) return;
    void disposeActivation().then(
      () => rejectStopped(failure()),
      () =>
        rejectStopped(
          new Error(
            `expert execution stopped: ${reason}; activation disposal failed`,
          ),
        ),
    );
  };
  const stop = (cause: string) => {
    if (finished || reason !== undefined) return;
    reason = cause;
    cancelActivation();
  };
  const unsubscribe = countToolCalls
    ? ctx.on(
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
      )
    : undefined;
  const timer =
    budget.timeoutMs > 0
      ? setTimeout(() => stop("review-timeout"), budget.timeoutMs)
      : undefined;
  const abort = () => stop("review-aborted");
  budget.signal.addEventListener("abort", abort, { once: true });
  if (budget.signal.aborted) abort();
  const cleanup = () => {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    unsubscribeCreated?.();
    clearTimeout(timer);
    budget.signal.removeEventListener("abort", abort);
  };
  return {
    cleanup,
    bind(value: SubagentActivation): SubagentActivation {
      activation = value;
      if (reason !== undefined) cancelActivation();
      const result = Promise.race([value.result, stopped])
        .then(async (outcome) => {
          if (reason !== undefined) {
            await disposeActivation();
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
          await disposeActivation();
        },
      };
    },
  };
}
