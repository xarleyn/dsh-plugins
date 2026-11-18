import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface ReviewAgent {
  readonly id: string;
  readonly ctx: ForegroundReviewContext;
}
interface ActivationResult {
  readonly stopReason: string;
  readonly output: readonly unknown[];
  readonly structured?: unknown;
  readonly diagnostic?: string;
}
interface Activation {
  readonly childId: string;
  readonly name?: string;
  readonly result: Promise<ActivationResult>;
  dispose(): void | Promise<void>;
}
interface ActivationSpec {
  readonly parent: object;
  readonly provider: string;
  readonly signal: AbortSignal;
  readonly childId?: string;
  readonly name?: string;
  readonly delivery: "parent" | "caller";
}
interface Runtime {
  startActivation(spec: ActivationSpec): Promise<Activation>;
  getProvider(
    name: string,
  ): { readonly prepareContinuable?: unknown } | undefined;
}
interface Execution {
  readonly agent?: object;
}
interface Result {
  readonly content: readonly unknown[];
}
interface Decision {
  readonly kind: string;
  readonly value?: unknown;
  readonly content?: readonly unknown[];
}
/** Structural Host view: this Node-only adapter has no Host-version dependency. */
export interface ForegroundReviewContext {
  get(name: string): unknown;
  effect(callback: () => () => void): unknown;
  on(
    event: "agent/created",
    callback: (event: { agent: ReviewAgent }) => void,
    options: { global: true },
  ): () => void;
  on(
    event: "tools/pre-execute",
    callback: (
      execution: Execution & { name: string },
      next: () => Promise<Decision>,
    ) => Promise<Decision>,
    options: { prepend: true },
  ): () => void;
  on(
    event: "tools/execute",
    callback: (
      exec: Execution,
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): () => void;
  on(
    event: "tools/post-execute",
    callback: (
      exec: Execution,
      result: Result,
      next: () => Promise<Decision>,
    ) => Promise<Decision>,
  ): () => void;
}
interface Frame {
  readonly agent: object;
  readonly context: ForegroundReviewContext;
  readonly allowedTools?: readonly string[];
  readonly completed: { name: string; result: ActivationResult }[];
}
interface Adapter {
  readonly supportsToolPolicy: true;
  readonly storage: AsyncLocalStorage<Frame>;
  readonly wrapped: Runtime["startActivation"];
  readonly original: PropertyDescriptor | undefined;
  users: number;
}

const adapterKey = Symbol.for("dsh.review.foreground.adapter");
const originalKey = Symbol.for("cordis.original");
const reviewers = new WeakSet<object>();
const toolPolicies = new WeakMap<object, readonly string[]>();

export function isForegroundReviewAgent(agent: object): boolean {
  return reviewers.has(agent);
}

/**
 * Native delegation tools close over their composition's service, so a scoped
 * replacement service cannot affect them. Bridge only startActivation, and
 * only inside a marked agent's tool dispatch. Preserve the original receiver,
 * argument validation, provider/preset/route policy, approvals and output schema.
 * The exact method descriptor is restored when the final owning scope unloads.
 */
function retainAdapter(runtime: Runtime): Adapter {
  const target = (Reflect.get(runtime, originalKey) ?? runtime) as Runtime;
  const existing = Reflect.get(target, adapterKey) as Adapter | undefined;
  if (existing !== undefined) {
    existing.users++;
    return existing;
  }
  const original = Object.getOwnPropertyDescriptor(target, "startActivation");
  const start = target.startActivation;
  const storage = new AsyncLocalStorage<Frame>();
  const wrapped: Runtime["startActivation"] = async function (
    this: Runtime,
    spec,
  ) {
    const frame = storage.getStore();
    if (frame === undefined || spec.parent !== frame.agent)
      return start.call(this, spec);
    const local =
      this.getProvider(spec.provider)?.prepareContinuable !== undefined;
    if (frame.allowedTools && !local)
      throw new Error(
        "This reviewer requires a locally managed worker to enforce its tool policy.",
      );
    const childId = local ? (spec.childId ?? randomUUID()) : undefined;
    let policyInstalled = false;
    const unsubscribe =
      childId === undefined
        ? () => {}
        : frame.context.on(
            "agent/created",
            ({ agent }) => {
              if (String(agent.id) !== childId) return;
              if (frame.allowedTools)
                installReviewToolPolicy(agent.ctx, agent, frame.allowedTools);
              installForegroundReview(agent.ctx, agent);
              policyInstalled = true;
            },
            { global: true },
          );
    let activation: Activation;
    try {
      // Caller-delivered external runs cannot have catalog names.
      const { name, ...request } = spec;
      activation = await start.call(this, {
        ...request,
        ...(local && name !== undefined ? { name } : {}),
        ...(childId === undefined ? {} : { childId }),
        delivery: "caller",
      });
    } finally {
      unsubscribe();
    }
    let disposal: Promise<void> | undefined;
    const dispose = () =>
      (disposal ??= Promise.resolve().then(() => activation.dispose()));
    const abort = () => {
      void dispose().catch(() => {});
    };
    spec.signal.addEventListener("abort", abort, { once: true });
    try {
      if (
        frame.allowedTools &&
        (!policyInstalled || activation.childId !== childId)
      )
        throw new Error(
          "The worker did not install the reviewer's tool policy.",
        );
      if (spec.signal.aborted) await dispose();
      const result = await activation.result;
      spec.signal.throwIfAborted();
      if (result.stopReason !== "completed")
        throw new Error(
          `Delegated review task ended with ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ""}`,
        );
      frame.completed.push({
        name: activation.name ?? activation.childId,
        result,
      });
      return activation;
    } finally {
      spec.signal.removeEventListener("abort", abort);
      await dispose();
    }
  };
  const adapter: Adapter = {
    storage,
    wrapped,
    original,
    users: 1,
    supportsToolPolicy: true,
  };
  Object.defineProperty(target, "startActivation", {
    configurable: true,
    writable: true,
    value: wrapped,
  });
  Object.defineProperty(target, adapterKey, {
    configurable: true,
    value: adapter,
  });
  return adapter;
}

/**
 * Make all delegations in this reviewer (and its local descendants) foreground.
 * Tool calls retain their canonical contract; post-execute adds the completed
 * child's actual answer to model content. A verdict cannot overtake its workers.
 */
export function installForegroundReview(
  context: ForegroundReviewContext,
  agent: object,
): void {
  if (reviewers.has(agent)) return;
  const runtime = context.get("subagents") as Runtime | undefined;
  if (runtime === undefined)
    throw new Error("Foreground review requires the subagents service.");
  const adapter = retainAdapter(runtime);
  const completed = new WeakMap<Execution, Frame["completed"]>();
  reviewers.add(agent);
  context.effect(() => () => {
    reviewers.delete(agent);
    if (--adapter.users > 0) return;
    const target = (Reflect.get(runtime, originalKey) ?? runtime) as Runtime;
    if (target.startActivation === adapter.wrapped) {
      if (adapter.original === undefined)
        Reflect.deleteProperty(target, "startActivation");
      else Object.defineProperty(target, "startActivation", adapter.original);
    }
    Reflect.deleteProperty(target, adapterKey);
  });
  const prompt = context.get("systemPrompt") as
    | {
        context?: (section: {
          name: string;
          order: number;
          text: string;
        }) => unknown;
      }
    | undefined;
  prompt?.context?.({
    name: "review-foreground-delegation",
    order: 1000,
    text: "This review uses foreground delegation. Every subagent/expert tool call waits for the child's completed result and returns it in that same call. This overrides generic tool guidance about background execution, automatic completion notices, or ending your turn to wait. You may delegate within the configured depth and capacity limits. Evaluate the completed evidence before your final answer or structured_output.",
  });
  context.on("tools/execute", async (exec, next) => {
    if (exec.agent !== agent) return next();
    const allowedTools = toolPolicies.get(agent);
    const frame: Frame = {
      agent,
      context,
      completed: [],
      ...(allowedTools && { allowedTools }),
    };
    try {
      return await adapter.storage.run(frame, next);
    } finally {
      if (frame.completed.length > 0) completed.set(exec, frame.completed);
    }
  });
  context.on("tools/post-execute", async (exec, result, next) => {
    const children = completed.get(exec);
    completed.delete(exec);
    const decision = await next();
    if (
      children === undefined ||
      decision.kind !== "accept" ||
      decision.value !== undefined
    )
      return decision;
    return {
      ...decision,
      content: [
        ...(decision.content ?? result.content),
        ...children.flatMap(({ name, result: child }) => [
          {
            type: "text",
            text: `Subagent ${name} completed; its result follows.`,
          },
          ...child.output,
          ...(child.structured === undefined
            ? []
            : [
                {
                  type: "text",
                  text: `Structured result: ${JSON.stringify(child.structured)}`,
                },
              ]),
        ]),
      ],
    };
  });
}

/** Apply an operator's tool list in this scope and to future foreground workers. */
export function installReviewToolPolicy(
  context: ForegroundReviewContext,
  agent: object,
  names: readonly string[],
): void {
  const runtime = context.get("subagents") as Runtime | undefined;
  if (!runtime)
    throw new Error(
      "The Host cannot enforce a reviewer tool policy without subagents.",
    );
  const target = Reflect.get(runtime, originalKey) ?? runtime;
  const active = Reflect.get(target, adapterKey) as Adapter | undefined;
  if (active && active.supportsToolPolicy !== true)
    throw new Error(
      "The active foreground adapter cannot propagate the reviewer's tool policy.",
    );
  const tools = context.get("tools") as
    | {
        get(name: string, scope: object): unknown;
        restrict(filter: { allow: string[] }): () => void;
        guard(
          check: (execution: { name: string }) => string | undefined,
        ): () => void;
      }
    | undefined;
  if (
    !tools ||
    typeof tools.guard !== "function" ||
    typeof tools.restrict !== "function" ||
    typeof tools.get !== "function"
  )
    throw new Error("The Host cannot enforce a scoped reviewer tool policy.");
  const previous = toolPolicies.get(agent);
  const allowed = new Set([
    ...names.filter((name) => !previous || previous.includes(name)),
    "structured_output",
  ]);
  // The Host mask accepts only inherited names. A scope-local or later
  // registration is still checked by the dispatch guard on every invocation.
  const inherited: string[] = [];
  for (const name of allowed) {
    if (tools.get(name, agent) === undefined) continue;
    try {
      tools.restrict({ allow: [name] })();
      inherited.push(name);
    } catch (error) {
      if (!(
        error instanceof Error && error.message.includes("unknown global tool")
      ))
        throw error;
    }
  }
  tools.restrict({ allow: inherited });
  const denial = ({ name }: { name: string }) =>
    allowed.has(name)
      ? undefined
      : "This tool is outside the reviewer's configured tool policy.";
  // Refuse before an interactive approval can park the parent. The dispatch
  // guard also covers calls made directly by other Host executors.
  context.on(
    "tools/pre-execute",
    async (execution, next) => {
      const reason = execution.agent === agent ? denial(execution) : undefined;
      return reason ? { kind: "deny", reason } : next();
    },
    { prepend: true },
  );
  tools.guard(denial);
  toolPolicies.set(agent, [...allowed]);
  context.effect(() => () => {
    toolPolicies.delete(agent);
  });
}
