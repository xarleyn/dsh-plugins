// @ts-nocheck -- DSH service types are not published by the upstream packages.
// dsh-session-scope — host half.
//
// Mounted as a normal plugin row in the profile composition. Scope is a
// durable per-session policy axis, independent from sandbox/permission mode.
//
// The host registers the `session-scope/set` event, projection, write-only
// `/scope` command, read RPC, and model-facing context. An AsyncLocalStorage
// execution carrier connects concurrent tool calls to the correct session;
// the filesystem seam then gates reads and mutations and filters navigation
// listings. A monotonic `tools.guard()` covers known path-aware tools before
// permission/approval can run. Legacy selected-workspace-write patches remain
// below only to resume old upstream session logs during migration; they are no
// longer advertised as a permission preset.

import { FsError } from "@deepseek-ai/dsh-fs";
import { WIDER_MODES } from "@deepseek-ai/dsh-sandbox";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import {
  MODE,
  SELECTION_EVENT,
  ancestryCrumbs,
  augmentConfinedArgv,
  canonicalPath,
  isPathUnder,
  listDirectoryLevel,
  normalizeRoots,
  normalizeSelectionRoots,
  renderSelectedPolicyText,
  selectionOf,
  tempWritableRoots,
} from "./core.js";
import {
  getScope,
  getScopeCapabilities,
  setScope,
} from "./host-api.js";
import {
  SESSION_SCOPE_EVENT,
  effectiveSessionScope,
} from "./session-scope.js";
import { renderSessionScopeContext } from "./scope-context.js";
import { SessionScopeReadService } from "./scope-remote.js";
import { initializeDelegatedSessionScope } from "./scope-delegation.js";
import { SessionScopeRuntime } from "./scope-fs.js";
import {
  SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE,
  SessionScopeProcessActivity,
} from "./scope-processes.js";
import {
  attachSessionScopePolicy,
  confineIsolatedBwrap,
  detectBwrapIsolation,
  sessionScopeFromPolicy,
} from "./scope-sandbox-linux.js";
import {
  ScopeToolAdapterRegistry,
  dispatchScopedSearchExecution,
  guardScopeToolExecution,
} from "./tool-guard.js";

export * from "./host-api.js";
export * from "./scope-context.js";
export * from "./scope-delegation.js";
export * from "./scope-fs.js";
export * from "./scope-processes.js";
export * from "./scope-remote.js";
export * from "./scope-sandbox-linux.js";
export * from "./scope-visibility.js";
export * from "./session-scope.js";
export * from "./tool-guard.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-session-scope";

/** Required host services (cordis fiber inject). */
export const inject = [
  "sandboxPolicy",
  "sandbox",
  "fs",
  "tools",
  "systemPrompt",
  "commands",
  "sessionProjections",
  "sessions",
];

/**
 * The session's workspace root: its immutable header cwd, or the deployment
 * fallback for sessions without one.
 * @param session - the live session.
 * @param fallback - `ctx.sandboxPolicy.workspaceRoot`.
 * @returns the workspace root for the session.
 */
function workspaceRootOf(session, fallback) {
  const cwd = session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : fallback;
}

/**
 * Patch `ctx.sandboxPolicy.resolve`: when the resolved mode is the new mode,
 * attach the session's selected roots as `extraWritableRoots` so every
 * enforcing consumer (fs fence, bash provider, terminal) sees them. Core
 * modes pass through untouched.
 * @param service - the sandbox-policy service instance.
 * @returns the restore disposer.
 */
function patchResolve(service) {
  const original = service.resolve.bind(service);
  service.resolve = (request = {}) => {
    const resolved = original(request);
    const session = request.session;
    let patched = resolved;
    if (resolved.mode === MODE) {
      if (session === void 0) {
        patched = { ...resolved, extraWritableRoots: [resolved.workspaceRoot] };
      } else {
        const selection = selectionOf(session.events);
        // The workspace is an ORDINARY member of the selection: it is writable
        // exactly when it is in the list. With no recorded selection the default
        // is workspace-writable.
        const roots = selection.workspace && !selection.roots.includes(resolved.workspaceRoot)
          ? [resolved.workspaceRoot, ...selection.roots]
          : selection.roots;
        patched = { ...resolved, extraWritableRoots: roots };
      }
    }
    return session === void 0
      ? patched
      : attachSessionScopePolicy(patched, getScope(session, resolved.workspaceRoot));
  };
  return () => {
    service.resolve = original;
  };
}

/**
 * Patch the `sandbox:policy` prompt contribution: the core renderer throws
 * on the new mode ("unreachable sandbox mode"), so the global layer's entry
 * text is swapped for one that renders the new mode and delegates to the
 * original text for every core mode. The entry object is mutated in place
 * (the layer's NamedEntries table is read by `Map` merge, so a replaced
 * `text` is what every request sees) and restored on dispose.
 * @param systemPrompt - the system-prompt service instance.
 * @param resolvePolicy - the patched policy resolver.
 * @returns the restore disposer.
 */
function patchPolicyContext(systemPrompt, resolvePolicy) {
  const contexts = systemPrompt?.layers?.global?.contexts;
  const entry = contexts?.data?.get("sandbox:policy");
  if (entry === void 0 || typeof entry.text !== "function") return () => {};
  const originalText = entry.text;
  entry.text = (context) => {
    const session = context.agent?.session;
    if (session === void 0) return "";
    const policy = resolvePolicy({ session });
    return policy.mode === MODE ? renderSelectedPolicyText(policy) : originalText(context);
  };
  return () => {
    entry.text = originalText;
  };
}

/**
 * Patch the fs fence (`ctx.fs.checkedTarget`): under the new mode the core
 * allow-list is empty (unknown mode), so containment is checked against the
 * platform temp areas PLUS the selected roots — the writable set IS the
 * selection (the workspace root included when selected), mirroring the core
 * fence's canonicalize-then-contain sequence and its structured
 * `FS_SANDBOX_DENIED` refusal. Core modes delegate to the original fence.
 * @param fs - the sandboxed filesystem service instance.
 * @param resolvePolicy - the patched policy resolver.
 * @returns the restore disposer.
 */
function patchFsFence(fs, resolvePolicy) {
  if (fs === void 0 || typeof fs.checkedTarget !== "function") return () => {};
  const original = fs.checkedTarget.bind(fs);
  fs.checkedTarget = async (target, sandboxPolicy) => {
    const policy = sandboxPolicy ?? resolvePolicy();
    if (policy.mode !== MODE) return original(target, sandboxPolicy);
    const fresh = await fs.resolve(target.displayPath);
    const roots = tempWritableRoots();
    for (const root of policy.extraWritableRoots ?? []) roots.push(root);
    for (const root of roots) {
      if (await isPathUnder(fresh.targetKey, root)) return fresh;
    }
    throw new FsError(
      `cannot write "${target.displayPath}": file access denied under selected-workspace-write mode`,
      "FS_SANDBOX_DENIED",
    );
  };
  return () => {
    fs.checkedTarget = original;
  };
}

/**
 * Patch `ctx.sandbox.confine`: under the new mode the writable set IS the
 * selection — the base is a `read-only` translation and the platform temp
 * areas plus every selected root (the workspace root included when
 * selected) are spliced into the selected runner's dialect. Other modes
 * delegate to the original provider untouched.
 * @param provider - the local sandbox provider instance.
 * @returns the restore disposer.
 */
function patchConfine(provider, scopeRuntime) {
  if (provider === void 0 || typeof provider.confine !== "function") return () => {};
  const original = provider.confine.bind(provider);
  provider.confine = (argv, policy) => {
    const runtimeSession = scopeRuntime.currentSession();
    const scope = sessionScopeFromPolicy(policy)
      ?? (runtimeSession === void 0 ? void 0 : getScope(runtimeSession, policy.workspaceRoot));
    if (scope?.mode === "isolated") {
      if (policy.mode !== "read-only" && policy.mode !== "workspace-write") {
        throw new Error("SESSION_SCOPE_ISOLATION_UNAVAILABLE: isolated scope requires read-only or workspace-write permission");
      }
      const execution = scopeRuntime.currentExecution();
      const args = execution?.arguments !== null && typeof execution?.arguments === "object"
        ? execution.arguments
        : {};
      const workdir = execution?.name === "bash"
        ? args.workdir
        : execution?.name === "terminal_open" ? args.cwd : void 0;
      return confineIsolatedBwrap(original(argv, policy), policy, scope, workdir);
    }
    if (policy.mode !== MODE) return original(argv, policy);
    const extra = (policy.extraWritableRoots ?? []).filter(
      (root) => typeof root === "string" && root.length > 0,
    );
    const base = original(argv, { ...policy, mode: "read-only" });
    return augmentConfinedArgv(base, extra, tempWritableRoots());
  };
  return () => {
    provider.confine = original;
  };
}

/** A session projection schema shaped like the core zod usage: a `parse` face. */
const workspaceScopeSchema = {
  parse(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("workspace-scope projection must be an object");
    }
    const roots = Array.isArray(value.roots)
      ? value.roots.filter((root) => typeof root === "string")
      : [];
    return {
      workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : "",
      roots,
      workspace: value.workspace !== false,
    };
  },
};

/** Projection wire schema for the independent scope policy axis. */
const sessionScopeStateSchema = {
  parse(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("session-scope projection must be an object");
    }
    const mode = value.mode === "focused" || value.mode === "isolated" ? value.mode : "full";
    return {
      mode,
      workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : "",
      roots: Array.isArray(value.roots) ? value.roots.filter((root) => typeof root === "string") : [],
      navigationRoots: Array.isArray(value.navigationRoots)
        ? value.navigationRoots.filter((root) => typeof root === "string")
        : [],
      hasSnapshot: value.hasSnapshot === true,
    };
  },
};

const sessionScopeViewSchema = {
  parse(value) {
    const state = sessionScopeStateSchema.parse(value);
    const { hasSnapshot: _hasSnapshot, ...view } = state;
    const capabilities = value?.capabilities;
    return {
      ...view,
      capabilities: {
        focused: capabilities?.focused === true,
        isolated: capabilities?.isolated === true,
        isolatedBackend: capabilities?.isolatedBackend === "bwrap" ? "bwrap" : null,
      },
    };
  },
};

/** Host command for the independent session-scope axis. */
function handleScope(invocation, ctx, capabilities, processActivity) {
  const session = invocation.agent.session;
  const raw = invocation.rawInput.trim();
  const space = raw.indexOf(" ");
  const verb = space === -1 ? raw : raw.slice(0, space);
  const rest = space === -1 ? "" : raw.slice(space + 1).trim();
  const fallbackWorkspaceRoot = ctx.sandboxPolicy?.workspaceRoot ?? "";
  const current = getScope(session, fallbackWorkspaceRoot);

  switch (verb) {
    case "":
      return { kind: "success", text: "scope: verbs: full | focused | isolated" };
    case "full": {
      if (processActivity.hasActive(invocation.agent, {
        terminals: ctx.get("terminals"),
        jobs: ctx.get("jobs"),
      })) {
        return { kind: "error", text: `${SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE}.` };
      }
      const event = setScope(session, { mode: "full", roots: [], source: "command" }, fallbackWorkspaceRoot);
      return { kind: "success", text: JSON.stringify(event) };
    }
    case "focused":
    case "isolated": {
      if (processActivity.hasActive(invocation.agent, {
        terminals: ctx.get("terminals"),
        jobs: ctx.get("jobs"),
      })) {
        return { kind: "error", text: `${SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE}.` };
      }
      if (verb === "isolated" && !capabilities.isolated) {
        return { kind: "error", text: "SESSION_SCOPE_ISOLATION_UNAVAILABLE: isolated scope is unavailable on this host." };
      }
      if (verb === "isolated" && ctx.sandboxPolicy.resolve({ session }).mode === "danger-full-access") {
        return { kind: "error", text: "SESSION_SCOPE_ISOLATION_UNAVAILABLE: isolated scope is incompatible with danger-full-access permission." };
      }
      let roots = current.roots;
      if (rest !== "") {
        try {
          roots = JSON.parse(rest);
        } catch {
          return { kind: "error", text: `scope: "${verb}" expects an optional JSON array of directory paths` };
        }
      }
      try {
        const event = setScope(session, { mode: verb, roots, source: "command" }, fallbackWorkspaceRoot);
        return { kind: "success", text: JSON.stringify(event) };
      } catch (error) {
        const code = typeof error?.code === "string" ? `${error.code}: ` : "";
        return { kind: "error", text: `${code}${error instanceof Error ? error.message : String(error)}` };
      }
    }
    default:
      return { kind: "error", text: `scope: unknown verb "${verb}" (verbs: full | focused | isolated)` };
  }
}

/**
 * One `/workspace-scope` command invocation: the write path for the
 * selection (`set` / `clear`), the read face (`info`), and the host-side
 * listing fallback (`list`) for compositions whose directory picker is the
 * native capability rather than `browse`.
 * @param invocation - the command invocation (agent + rawInput).
 * @param ctx - the plugin context (for the policy fallback root).
 * @returns the command result (a promise for the async `list` verb).
 */
async function handleWorkspaceScope(invocation, ctx) {
  const session = invocation.agent.session;
  const raw = invocation.rawInput.trim();
  const space = raw.indexOf(" ");
  const verb = space === -1 ? raw : raw.slice(0, space);
  const rest = space === -1 ? "" : raw.slice(space + 1).trim();
  const workspaceRoot = workspaceRootOf(session, ctx.sandboxPolicy?.workspaceRoot);
  const selection = selectionOf(session.events);
  const effectiveRoots = selection.workspace && !selection.roots.includes(workspaceRoot)
    ? [workspaceRoot, ...selection.roots]
    : selection.roots;
  // The workspace root is an ordinary member of the selection: the recorded
  // `workspace` marker is derived from the roots themselves.
  const appendSelection = (nextRoots) => {
    session.append(SELECTION_EVENT, {
      roots: nextRoots,
      workspaceRoot,
      workspace: nextRoots.includes(workspaceRoot),
    });
  };
  switch (verb) {
    case "":
      return {
        kind: "success",
        text: `workspace-scope: ${effectiveRoots.length} selected root(s)${effectiveRoots.includes(workspaceRoot) ? " (workspace writable)" : " (workspace read-only)"}; verbs: set <json> | clear | info | list <path>`,
      };
    case "set": {
      let parsed;
      try {
        parsed = JSON.parse(rest);
      } catch {
        return { kind: "error", text: "workspace-scope: \"set\" expects a JSON array of absolute directory paths (the workspace root included when it should be writable)" };
      }
      try {
        // Array form: the FULL selection — the workspace root included when
        // it should be writable. Object form { roots, workspace } is
        // accepted for compatibility and normalized to the same list.
        let rootInput;
        if (Array.isArray(parsed)) {
          rootInput = parsed;
        } else if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.roots)) {
          const rawRoots = normalizeRoots(parsed.roots, canonicalPath);
          rootInput = parsed.workspace === false
            ? rawRoots.filter((root) => root !== workspaceRoot)
            : rawRoots.includes(workspaceRoot) ? rawRoots : [workspaceRoot, ...rawRoots];
        } else {
          return { kind: "error", text: "workspace-scope: \"set\" expects a JSON array of absolute directory paths (the workspace root included when it should be writable)" };
        }
        const normalized = normalizeRoots(rootInput, canonicalPath);
        appendSelection(normalized);
        return {
          kind: "success",
          text: `workspace-scope: ${normalized.length} root(s) selected${normalized.includes(workspaceRoot) ? ", workspace writable" : ", workspace read-only"}`,
        };
      } catch (error) {
        return { kind: "error", text: error instanceof Error ? error.message : String(error) };
      }
    }
    case "clear":
      appendSelection([]);
      return { kind: "success", text: "workspace-scope: selection cleared (workspace read-only)" };
    case "info":
      return {
        kind: "success",
        text: JSON.stringify({ workspaceRoot, roots: effectiveRoots }),
      };
    case "list": {
      if (rest === "" || !rest.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(rest)) {
        return { kind: "error", text: "workspace-scope: \"list\" expects an absolute directory path" };
      }
      try {
        return {
          kind: "success",
          text: JSON.stringify(await listDirectoryLevel(rest)),
        };
      } catch (error) {
        return {
          kind: "error",
          text: `workspace-scope: cannot list ${rest}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    default:
      return {
        kind: "error",
        text: `workspace-scope: unknown verb "${verb}" (verbs: set | clear | info | list)`,
      };
  }
}

/**
 * Plugin body: extend the permission vocabulary and enforce it. Every patch
 * is restored by the returned disposer, so unloading (or HMR) leaves the
 * core services exactly as they were.
 * @param ctx - the plugin context carrying the host services.
 * @returns the combined disposer.
 */
export function apply(ctx) {
  const disposers = [];
  const logger = getPluginLogger({
    pluginId: "dsh-session-scope",
    consoleSink: createHostLoggerSink(ctx.logger ?? console),
  });
  const resolvePolicy = (request = {}) => ctx.sandboxPolicy?.resolve(request);
  const processActivity = new SessionScopeProcessActivity();
  const toolAdapters = new ScopeToolAdapterRegistry();
  const fallbackWorkspaceRoot = ctx.sandboxPolicy?.workspaceRoot ?? "";
  const scopeRuntime = new SessionScopeRuntime(fallbackWorkspaceRoot);
  const provider = ctx.get("sandbox");
  const isolatedBackendReady = detectBwrapIsolation(provider, fallbackWorkspaceRoot);
  const scopeCapabilities = getScopeCapabilities(process.platform, isolatedBackendReady);
  logger.info("plugin.ready", {
    focused: scopeCapabilities.focused,
    isolated: scopeCapabilities.isolated,
    isolatedBackend: scopeCapabilities.isolatedBackend,
  });

  // Typert Remote is a non-durable read boundary for the directory picker.
  // The feature probe keeps lightweight unit harnesses usable without
  // pretending that their plain objects are full Cordis contexts.
  if (typeof ctx.provide === "function") {
    new SessionScopeReadService(ctx, fallbackWorkspaceRoot);
  }

  // 1. The mode resolver: attach selected roots under the new mode.
  const sandboxPolicy = ctx.get("sandboxPolicy");
  if (sandboxPolicy !== void 0) disposers.push(patchResolve(sandboxPolicy));

  // 2. The prompt contribution: render the new mode instead of throwing.
  const systemPrompt = ctx.get("systemPrompt");
  if (systemPrompt !== void 0 && sandboxPolicy !== void 0) {
    disposers.push(patchPolicyContext(systemPrompt, (request) => sandboxPolicy.resolve(request)));
  }
  if (systemPrompt !== void 0 && typeof systemPrompt.context === "function") {
    disposers.push(systemPrompt.context({
      name: "session:scope",
      order: 50,
      text: (context) => {
        const session = context.scope?.session ?? context.agent?.session;
        return session === void 0 ? "" : renderSessionScopeContext(getScope(session, fallbackWorkspaceRoot));
      },
    }));
  }

  // 3. The fs fence: contain writes under workspace + selected roots.
  const fs = ctx.get("fs");
  if (fs !== void 0) {
    disposers.push(patchFsFence(fs, resolvePolicy));
    disposers.push(scopeRuntime.patchFileSystem(fs, fallbackWorkspaceRoot));
  }

  // Workspace instruction and project-skill discovery happen during
  // agent/pre-step rather than inside a filesystem tool. Run every downstream
  // pre-step contributor under the same per-session filesystem carrier; the
  // prepended listener must remain outermost so later plugins cannot escape it.
  disposers.push(ctx.on(
    "agent/pre-step",
    ({ agent }, next) => scopeRuntime.run(agent?.session, next),
    { global: true, prepend: true },
  ));

  // The final tool guard cannot be widened by later permission listeners. The
  // around stage carries the calling session through async filesystem work so
  // concurrent sessions never share scope state.
  ctx.inject(["tools"], (toolCtx) => {
    let searchSplitterActive = false;
    disposers.push(toolCtx.tools.guard((execution) => {
      const session = execution.agent?.session;
      if (processActivity.isProcessTool(execution.name) && execution.agent !== void 0) {
        processActivity.ensureFence(execution.agent, {
          terminals: ctx.get("terminals"),
          jobs: ctx.get("jobs"),
        });
      }
      const sandboxMode = session === void 0 ? void 0 : resolvePolicy({ session })?.mode;
      return guardScopeToolExecution(execution, toolAdapters, fallbackWorkspaceRoot, {
        splitBroadSearches: searchSplitterActive,
        isolatedBackendReady,
        sandboxMode,
      });
    }));
    const disposeSearchSplitter = toolCtx.on("tools/execute", (execution, next) => processActivity.run(
      execution.agent,
      execution.name,
      () => scopeRuntime.run(
        execution.agent?.session,
        () => dispatchScopedSearchExecution(execution, toolCtx.tools, next, fallbackWorkspaceRoot),
        execution,
      ),
    ));
    searchSplitterActive = true;
    disposers.push(() => {
      // Disable the guard exception before removing the matching dispatcher.
      searchSplitterActive = false;
      disposeSearchSplitter();
    });
  });

  // 4. The process sandbox: grant the extra roots in each runner dialect.
  if (provider !== void 0) disposers.push(patchConfine(provider, scopeRuntime));

  // 5. The escalation ladder: under the new mode a denial may still escalate
  //    to full access through the ordinary approval flow.
  if (WIDER_MODES[MODE] === void 0) {
    WIDER_MODES[MODE] = ["danger-full-access"];
    disposers.push(() => {
      delete WIDER_MODES[MODE];
    });
  }

  // 6. The persistence vocabulary: `Session.append` offers no way to stamp
  //    the envelope's `ignorable` marker, so a recorded selection event is a
  //    required event — a harness build that does not recognize the type
  //    refuses to reconstruct the log (SessionFormatUnsupportedError on
  //    history load). Register the type while the plugin is loaded; the
  //    exported set is the same instance the persistence read path consults.
  for (const eventType of [SELECTION_EVENT, SESSION_SCOPE_EVENT]) {
    if (KNOWN_SESSION_EVENT_TYPES.has(eventType)) continue;
    KNOWN_SESSION_EVENT_TYPES.add(eventType);
    disposers.push(() => {
      KNOWN_SESSION_EVENT_TYPES.delete(eventType);
    });
  }

  // Child publication is synchronous and rollback-covered by DSH. Initialize
  // subagent scope here so a missing parent rejects the child before its first
  // model request or tool execution. Forked ordinary sessions already inherit
  // their event prefix directly through the session seed.
  const sessions = ctx.get("sessions");
  if (sessions !== void 0) {
    disposers.push(ctx.on("session/created", (session) => {
      initializeDelegatedSessionScope(session, (id) => sessions.get(id));
    }, { global: true }));
  }

  // 7. Independent scope command plus the legacy compatibility command.
  ctx.inject(["commands"], (commandCtx) => {
    commandCtx.commands.register({
      name: "scope",
      description: "Manage the independent workspace visibility scope for this session",
      input: { hint: "<full|focused|isolated>" },
      handler: (invocation) => handleScope(invocation, ctx, scopeCapabilities, processActivity),
    });
    commandCtx.commands.register({
      name: "workspace-scope",
      description: "Manage the selected-workspace-write directory selection",
      input: { hint: "<set|clear|info|list>" },
      handler: (invocation) => handleWorkspaceScope(invocation, ctx),
    });
  });
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "session-scope",
      stateSchema: sessionScopeStateSchema,
      init: () => ({
        mode: "full",
        workspaceRoot: "",
        roots: [],
        navigationRoots: [],
        hasSnapshot: false,
      }),
      apply: (state, event) => {
        if (event.type === SESSION_SCOPE_EVENT) {
          return {
            ...effectiveSessionScope([event], { cwd: event.data?.workspaceRoot }),
            hasSnapshot: true,
          };
        }
        if (event.type === SELECTION_EVENT && !state.hasSnapshot) {
          return {
            ...effectiveSessionScope([event], { cwd: event.data?.workspaceRoot }),
            hasSnapshot: false,
          };
        }
        return state;
      },
      wire: {
        viewSchema: sessionScopeViewSchema,
        view: ({ hasSnapshot: _hasSnapshot, ...state }) => ({
          ...state,
          capabilities: scopeCapabilities,
        }),
      },
      stateVersion: 1,
    });
    projectionCtx.sessionProjections.register({
      key: "workspace-scope",
      stateSchema: workspaceScopeSchema,
      init: () => ({ workspaceRoot: "", roots: [], workspace: true }),
      apply: (state, event) => {
        if (event.type !== SELECTION_EVENT) return state;
        const workspaceRoot = typeof event.data?.workspaceRoot === "string" ? event.data.workspaceRoot : state.workspaceRoot;
        const workspace = event.data?.workspace !== false;
        return {
          workspaceRoot,
          // Normalize so the folded roots ARE the writable set: the session
          // workspace root is a member exactly when the workspace is writable.
          roots: normalizeSelectionRoots(event.data?.roots, workspaceRoot, workspace),
          workspace,
        };
      },
      wire: {
        viewSchema: workspaceScopeSchema,
        view: (state) => state,
      },
      stateVersion: 1,
    });
  });

  return async () => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]();
      } catch {
        /* restore is best-effort on teardown */
      }
    }
    await logger.close();
  };
}

export { ancestryCrumbs, listDirectoryLevel, workspaceRootOf };
