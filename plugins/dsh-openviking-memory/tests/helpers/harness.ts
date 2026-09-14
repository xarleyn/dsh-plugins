/**
 * Test harness: a real Cordis context with a recording `on`/`effect`, an
 * isolated OpenViking environment, and a stub `fetch` that records every
 * request the plugin makes.
 *
 * The harness exists so the injection tests can be written as assertions about
 * *requests*, not about mocks of the runtime: `autoInject: false` has to mean
 * "no profile or recall request was issued", which is only observable at the
 * transport layer (SPEC §12).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";

import OpenVikingMemory, { type Config } from "../../src/index.js";

/** A recorded listener; the plugin registers one per event name. */
export type RecordedListener = (...args: never[]) => unknown;

/** One recorded HTTP request. */
export interface RecordedRequest {
  readonly path: string;
  readonly search: string;
  readonly method: string;
  readonly body: unknown;
}

export interface HarnessOptions {
  /** Response bodies keyed by pathname; a function may build one per request. */
  readonly responses?: Record<string, unknown>;
  /** Let a test override the stubbed transport entirely. */
  readonly fetchImpl?: (
    path: string,
    init: RequestInit | undefined,
  ) => Promise<Response>;
  /** Skip the environment isolation (for the config tests that set it themselves). */
  readonly isolateEnv?: boolean;
}

export interface Harness {
  readonly ctx: Context;
  readonly plugin: OpenVikingMemory;
  readonly listeners: Map<string, RecordedListener>;
  readonly disposers: {
    readonly name: string;
    readonly dispose: () => unknown;
  }[];
  readonly requests: RecordedRequest[];
  /**
   * Plugins the entry passed to `ctx.plugin`. Mounting is recorded instead of
   * performed: the real MCP bridge spawns a child process, which no unit test
   * should do.
   */
  readonly mounted: { readonly plugin: unknown; readonly config: unknown }[];
  /** Every requested pathname, in order. */
  paths(): string[];
  /** How many requests hit a pathname prefix. */
  countRequests(prefix: string): number;
  /** Requests to one exact pathname. */
  requestsFor(path: string): RecordedRequest[];
  /** Run every registered disposer, then restore the environment and transport. */
  dispose(): Promise<void>;
}

const ENV_KEYS_TO_CLEAR = [
  "OPENVIKING_URL",
  "OPENVIKING_BASE_URL",
  "OPENVIKING_MCP_URL",
  "OPENVIKING_API_KEY",
  "OPENVIKING_BEARER_TOKEN",
  "OPENVIKING_ACCOUNT",
  "OPENVIKING_USER",
  "OPENVIKING_PEER_ID",
  "OPENVIKING_WORKSPACE_PEER",
  "OPENVIKING_RECALL_PEER_SCOPE",
  "OPENVIKING_RECALL_QUERY_EXPANSION",
  "OPENVIKING_RECALL_LIMIT",
  "OPENVIKING_CREDENTIAL_SOURCE",
  "OPENVIKING_CREDENTIALS_SOURCE",
];

const DEFAULT_RESPONSES: Record<string, unknown> = {
  "/health": {},
  "/api/v1/sessions": {},
  "/api/v1/system/status": { user: "default" },
  "/api/v1/fs/ls": [],
  "/api/v1/content/read": "",
  "/api/v1/search/search": { rendered: "", entries: [], digest: "", stats: {} },
  "/api/v1/search/find": { memories: [], resources: [], skills: [] },
  "/api/v1/search/recall": { rendered: "" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Start one plugin instance against an isolated environment.
 *
 * The temporary state/pending directories and the redirected credential paths
 * keep a developer's real `~/.openviking` out of the test, so the assertions
 * hold on any machine.
 */
export async function createHarness(
  config: Config = {},
  options: HarnessOptions = {},
): Promise<Harness> {
  const stateDir = await mkdtemp(join(tmpdir(), "ov-state-"));
  const pendingDir = await mkdtemp(join(tmpdir(), "ov-pending-"));
  const missingCreds = join(stateDir, "absent.conf");

  const savedEnv = new Map<string, string | undefined>();
  const savedFetch = globalThis.fetch;

  if (options.isolateEnv !== false) {
    for (const key of [
      ...ENV_KEYS_TO_CLEAR,
      "OPENVIKING_STATE_DIR",
      "OPENVIKING_PENDING_DIR",
      "OPENVIKING_CLI_CONFIG_FILE",
      "OPENVIKING_CONFIG_FILE",
    ]) {
      savedEnv.set(key, process.env[key]);
    }
    for (const key of ENV_KEYS_TO_CLEAR) delete process.env[key];
    process.env.OPENVIKING_STATE_DIR = stateDir;
    process.env.OPENVIKING_PENDING_DIR = pendingDir;
    process.env.OPENVIKING_CLI_CONFIG_FILE = missingCreds;
    process.env.OPENVIKING_CONFIG_FILE = missingCreds;
  }

  const requests: RecordedRequest[] = [];
  const responses = { ...DEFAULT_RESPONSES, ...options.responses };

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    requests.push({
      path: url.pathname,
      search: url.search,
      method: init?.method ?? "GET",
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (options.fetchImpl) return options.fetchImpl(url.pathname, init);
    if (!Object.hasOwn(responses, url.pathname)) {
      return jsonResponse(
        { status: "error", error: { code: "NOT_FOUND" } },
        404,
      );
    }
    return jsonResponse({ status: "ok", result: responses[url.pathname] });
  }) as typeof globalThis.fetch;

  const ctx = new Context();
  const listeners = new Map<string, RecordedListener>();
  const disposers: {
    readonly name: string;
    readonly dispose: () => unknown;
  }[] = [];

  // Record while still registering for real: the plugin's own registration
  // path stays exercised, and a test can invoke a listener by name.
  const originalOn = ctx.on.bind(ctx);
  Object.defineProperty(ctx, "on", {
    configurable: true,
    value: (name: string, listener: RecordedListener, opts?: unknown) => {
      listeners.set(name, listener);
      return (originalOn as (n: string, l: never, o?: unknown) => unknown)(
        name,
        listener as never,
        opts,
      );
    },
  });

  const originalEffect = ctx.effect.bind(ctx);
  Object.defineProperty(ctx, "effect", {
    configurable: true,
    value: (execute: () => () => unknown, name?: string) => {
      const result = (
        originalEffect as unknown as (
          e: () => () => unknown,
          n?: string,
        ) => () => void
      )(execute, name);
      disposers.push({ name: name ?? "anonymous", dispose: execute() });
      return result;
    },
  });

  // The MCP bridge spawns a real child process on activation, so the entry's
  // mounts are recorded rather than performed.
  const mounted: { readonly plugin: unknown; readonly config: unknown }[] = [];
  Object.defineProperty(ctx, "plugin", {
    configurable: true,
    value: (plugin: unknown, pluginConfig?: unknown) => {
      mounted.push({ plugin, config: pluginConfig });
      return () => {};
    },
  });

  const plugin = new OpenVikingMemory(ctx, config);

  return {
    ctx,
    plugin,
    listeners,
    disposers,
    requests,
    mounted,
    paths: () => requests.map((request) => request.path),
    countRequests: (prefix: string) =>
      requests.filter((request) => request.path.startsWith(prefix)).length,
    requestsFor: (path: string) =>
      requests.filter((request) => request.path === path),
    dispose: async () => {
      for (const entry of disposers) await entry.dispose();
      globalThis.fetch = savedFetch;
      if (options.isolateEnv !== false) {
        for (const [key, value] of savedEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      await rm(stateDir, { recursive: true, force: true });
      await rm(pendingDir, { recursive: true, force: true });
    },
  };
}

/** A fake agent with just the surface the plugin touches. */
export function createFakeAgent(
  options: {
    readonly sessionId?: string;
    readonly cwd?: string;
    readonly origin?: "subagent";
    readonly status?: "idle" | "running";
    readonly ownEvents?: readonly unknown[];
    readonly inbox?: {
      readonly nextTurn?: readonly unknown[];
      readonly nextStep?: readonly unknown[];
    };
  } = {},
): {
  agent: Agent;
  injected: UserMessage[];
  sessionDisposers: (() => unknown)[];
} {
  const sessionId = options.sessionId ?? "dsh-session-1";
  const injected: UserMessage[] = [];
  const sessionDisposers: (() => unknown)[] = [];

  const session = {
    id: sessionId,
    header: {
      version: 1,
      id: sessionId,
      createdAt: 0,
      isSeeded: false,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    ownEvents: () => options.ownEvents ?? [],
    snapshotEvents: () => options.ownEvents ?? [],
  };

  const agent = {
    session,
    status: options.status ?? "idle",
    inbox: {
      nextTurn: options.inbox?.nextTurn ?? [],
      nextStep: options.inbox?.nextStep ?? [],
    },
    inject: (message: UserMessage) => {
      injected.push(message);
    },
    ctx: {
      effect: (execute: () => () => unknown) => {
        sessionDisposers.push(execute());
        return () => {};
      },
    },
  };

  return {
    agent: agent as unknown as Agent,
    injected,
    sessionDisposers,
  };
}

/** A fake session object for the session-scoped listeners. */
export function createFakeSession(
  sessionId: string,
  header: Record<string, unknown> = {},
): Session {
  return {
    id: sessionId,
    header: {
      version: 1,
      id: sessionId,
      createdAt: 0,
      isSeeded: false,
      ...header,
    },
    ownEvents: () => [],
  } as unknown as Session;
}

/** A DSH user message like the agent loop builds. */
export function userMessage(
  text: string,
  source: Record<string, unknown> = { kind: "user" },
): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: source as never,
  });
}

/** A `pre-step` waterfall carrier that yields an `enter` decision. */
export function preStepPayload(
  agent: Agent,
  messages: readonly UserMessage[],
): {
  agent: Agent;
  messages: UserMessage[];
  turn: number;
  step: number;
  signal: AbortSignal;
} {
  return {
    agent,
    messages: [...messages],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  };
}

/** The `enter` decision a downstream listener would return. */
export function enterDecision(messages: readonly UserMessage[]): {
  kind: "enter";
  messages: UserMessage[];
} {
  return { kind: "enter", messages: [...messages] };
}

/** Invoke one recorded listener by event name. */
export async function emit(
  harness: Harness,
  name: string,
  ...args: unknown[]
): Promise<unknown> {
  const listener = harness.listeners.get(name);
  if (!listener) throw new Error(`no listener registered for ${name}`);
  return await (
    listener as unknown as (...values: unknown[]) => Promise<unknown>
  )(...args);
}
