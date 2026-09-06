import type { Context } from "@deepseek-ai/cordis";
import type { HostLoggerLike } from "@yadsh/dsh-plugin-log";

import type { SessionEvent } from "./core.js";
import type { ScopeSession } from "./host-api.js";
import type { ScopeAwareFileSystem, ScopeFsTarget } from "./scope-fs.js";
import type { ScopeProcessOwner, ScopeProcessServices } from "./scope-processes.js";
import type {
  ScopeConfinedArgv,
  ScopeSandboxPolicy,
} from "./scope-sandbox-linux.js";
import type { DelegatedScopeSession } from "./scope-delegation.js";
import type {
  ScopeToolDispatcher,
  ScopeToolExecution,
  ScopeToolExecutionResult,
} from "./tool-guard.js";

export type Disposer = () => void;

export interface SandboxPolicyRequest {
  session?: ScopeSession;
  [key: string]: unknown;
}

export interface SandboxPolicyLike extends ScopeSandboxPolicy {
  extraWritableRoots?: string[];
}

export interface SandboxPolicyServiceLike {
  workspaceRoot: string;
  resolve(request?: SandboxPolicyRequest): SandboxPolicyLike;
}

export type ResolvePolicyLike = (request?: SandboxPolicyRequest) => SandboxPolicyLike;

export interface SandboxedFsTarget extends ScopeFsTarget {
  targetKey: string;
}

export interface SandboxedFileSystemLike extends ScopeAwareFileSystem {
  resolve(
    path: string,
    options?: { cwd?: string; signal?: AbortSignal },
  ): Promise<SandboxedFsTarget>;
  checkedTarget(
    target: SandboxedFsTarget,
    sandboxPolicy?: SandboxPolicyLike,
  ): Promise<SandboxedFsTarget>;
}

export interface SandboxProviderLike {
  confine(argv: readonly string[], policy: SandboxPolicyLike): ScopeConfinedArgv;
}

export interface PromptContextLike {
  agent?: { session?: ScopeSession };
  scope?: { session?: ScopeSession };
}

interface PromptEntryLike {
  text(context: PromptContextLike): string;
}

export interface SystemPromptServiceLike {
  layers?: {
    global?: {
      contexts?: {
        data?: Map<string, PromptEntryLike>;
      };
    };
  };
  context?(entry: {
    name: string;
    order: number;
    text(context: PromptContextLike): string;
  }): Disposer;
}

export interface HostSessionLike extends ScopeSession {
  append(type: "session-scope/set", data: Parameters<ScopeSession["append"]>[1]): unknown;
  append(
    type: "workspace-scope/selection",
    data: { roots: string[]; workspaceRoot: string; workspace: boolean },
  ): unknown;
}

export interface AgentLike extends ScopeProcessOwner {
  session: HostSessionLike;
}

export interface CommandInvocationLike {
  agent: AgentLike;
  rawInput: string;
}

export interface CommandResultLike {
  kind: "success" | "error";
  text: string;
}

interface CommandDefinitionLike {
  name: string;
  description: string;
  input: { hint: string };
  handler(invocation: CommandInvocationLike): CommandResultLike | Promise<CommandResultLike>;
}

export interface CommandsServiceLike {
  register(definition: CommandDefinitionLike): unknown;
}

export interface CommandContextLike {
  commands: CommandsServiceLike;
}

export type HostToolExecution = Omit<ScopeToolExecution, "agent"> & {
  agent?: AgentLike;
};

export interface ToolsServiceLike extends ScopeToolDispatcher {
  guard(check: (execution: HostToolExecution) => string | undefined): Disposer;
}

export interface ToolContextLike {
  tools: ToolsServiceLike;
  on(
    event: "tools/execute",
    listener: (
      execution: HostToolExecution,
      next: () => Promise<ScopeToolExecutionResult>,
    ) => Promise<ScopeToolExecutionResult>,
  ): Disposer;
}

export interface SessionStoreLike {
  get(id: string): DelegatedScopeSession | undefined;
}

export interface ParseSchemaLike<T> {
  parse(value: unknown): T;
}

export interface SessionScopeProjectionState {
  mode: "full" | "focused" | "isolated";
  workspaceRoot: string;
  roots: string[];
  navigationRoots: string[];
  hasSnapshot: boolean;
}

export interface SessionScopeProjectionView extends Omit<SessionScopeProjectionState, "hasSnapshot"> {
  capabilities: {
    focused: boolean;
    isolated: boolean;
    isolatedBackend: "bwrap" | null;
  };
}

export interface WorkspaceScopeProjectionState {
  workspaceRoot: string;
  roots: string[];
  workspace: boolean;
}

export interface ProjectionEventLike extends SessionEvent {
  data?: Record<string, unknown>;
}

interface ProjectionWireLike<TState, TView> {
  viewSchema: ParseSchemaLike<TView>;
  view(state: TState): TView;
}

interface ProjectionDefinitionLike<TState, TView> {
  key: string;
  stateSchema: ParseSchemaLike<TState>;
  init(): TState;
  apply(state: TState, event: ProjectionEventLike): TState;
  wire: ProjectionWireLike<TState, TView>;
  stateVersion: number;
}

export interface SessionProjectionsServiceLike {
  register<TState, TView>(definition: ProjectionDefinitionLike<TState, TView>): unknown;
}

export interface ProjectionContextLike {
  sessionProjections: SessionProjectionsServiceLike;
}

interface HostServices {
  sandboxPolicy: SandboxPolicyServiceLike;
  sandbox: SandboxProviderLike;
  systemPrompt: SystemPromptServiceLike;
  fs: SandboxedFileSystemLike;
  sessions: SessionStoreLike;
  terminals: ScopeProcessServices["terminals"];
  jobs: ScopeProcessServices["jobs"];
}

export interface HostContextLike {
  sandboxPolicy: SandboxPolicyServiceLike;
  logger?: HostLoggerLike;
  get<K extends keyof HostServices>(name: K): HostServices[K] | undefined;
  provide?: (...args: unknown[]) => unknown;
  on(
    event: "agent/pre-step",
    listener: (payload: { agent?: AgentLike }, next: () => unknown) => unknown,
    options?: { global?: boolean; prepend?: boolean },
  ): Disposer;
  on(
    event: "session/created",
    listener: (session: DelegatedScopeSession) => void,
    options?: { global?: boolean },
  ): Disposer;
  inject<TContext>(services: readonly string[], callback: (ctx: TContext) => void): unknown;
}

/** Cordis owns the runtime context; this cast is isolated to the Remote constructor seam. */
export function asCordisContext(ctx: HostContextLike): Context {
  return ctx as unknown as Context;
}
