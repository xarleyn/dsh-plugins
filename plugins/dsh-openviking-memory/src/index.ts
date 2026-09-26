/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * DSH host entry. The plugin wires one OpenViking integration and keeps five
 * capabilities independent of each other (SPEC §36):
 *
 *   connection ── tools (MCP bridge)
 *              ── skills (skill provider)
 *              ── capture / commit
 *              ── `viking://` guard
 *              └─ automatic context presentation ── startup profile
 *                                                ── per-step profile
 *                                                ── automatic recall
 *
 * Only the last branch is governed by `autoInject` and its three granular
 * knobs. When it is switched off the plugin still connects, still mounts tools
 * and skills, still guards URIs and still captures and commits conversations —
 * it simply never calls `profileMessage`/`recallMessage`, so no profile or
 * recall request is ever issued (SPEC §9-§12).
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

import { OpenVikingClient } from "./api-client.js";
import {
  Config as ConfigSchema,
  MCP_SERVER_NAME,
  resolveConfig,
  resolveInjectionPlan,
  snapshotConfig,
  type Config,
  type InjectionPlan,
  type LiveConfig,
  type ResolvedConfig,
} from "./config.js";
import { injectStartupProfile } from "./lifecycle.js";
import { createOpenVikingLogger } from "./logging.js";
import { mountOpenVikingMcp } from "./mcp.js";
import { QaMemoryIdentity, type QaMemorySurface } from "./qa/identity.js";
import { readUserMemoryOverview } from "./qa/overview.js";
import {
  QaUserMemorySettingsStore,
  effectiveInjectionPlan,
} from "./qa/user-settings.js";
import { OpenVikingRuntime, type SessionScoping } from "./runtime.js";
import type { QaUserMemoryOverview } from "./types.js";
import { mountOpenVikingSkills } from "./skills.js";
import { guardVikingUri } from "./uri-guard.js";

/** Cordis plugin id. */
export const name = "dsh-openviking-memory";

/**
 * The host services the integration builds on. `agents`, `sessions` and `tools`
 * are all owned by the host and never bundled here, so the plugin waits for the
 * real ones instead of racing their registration.
 */
export const inject = ["agents", "sessions", "tools"] as const;

export {
  Config,
  MCP_SERVER_NAME,
  resolveConfig,
  resolveInjectionPlan,
  snapshotConfig,
} from "./config.js";
export type {
  Config as OpenVikingConfig,
  InjectionPlan,
  LiveConfig,
  ResolvedConfig,
} from "./config.js";
export { OpenVikingClient } from "./api-client.js";
export { OPENVIKING_PLUGIN_SOURCE } from "./capture.js";
export { injectStartupProfile } from "./lifecycle.js";
export { buildMcpConfig, PROXY_PATH } from "./mcp.js";
export { OpenVikingRuntime } from "./runtime.js";
export {
  buildSkillsConfig,
  SKILL_PROVIDER_NAME,
  SKILLS_DIR,
} from "./skills.js";
export { guardVikingUri } from "./uri-guard.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** OpenViking memory integration: runtime, resolved config and injection plan. */
    openvikingMemory: OpenVikingMemory;
  }
}

/** Snapshot of the plugin's own state, for diagnostics and tests. */
export interface OpenVikingMemoryStatus {
  readonly connected: boolean;
  readonly endpoint: string;
  readonly peerId: string;
  readonly capture: boolean;
  readonly injection: InjectionPlan;
  readonly liveSessions: number;
}

export default class OpenVikingMemory extends TypertRemoteService {
  static Config = ConfigSchema;
  static inject = inject;

  /** The config this entry booted with, before anything was derived from it. */
  readonly entryConfig: Config;
  /**
   * Every knob resolved, plus the derived peer/user-agent fields. Re-resolved
   * when a committed settings change moves one of the live references.
   */
  resolved: ResolvedConfig;
  /** Which automatic context additions are enabled after `autoInject` gating. */
  injection: InjectionPlan;
  /** Per-session capture, commit, profile and recall. */
  readonly runtime: OpenVikingRuntime;
  private readonly logger: PluginLogger;
  /** The host context, kept for the lazily resolved QA surface. */
  private readonly owner: Context;
  /** Per-account attribution, once a QA surface is known to be mounted. */
  private readonly identity = new QaMemoryIdentity(() => this.qaSurface());
  /** Per-account switches; the file behind the QA settings page. */
  private userSettings: QaUserMemorySettingsStore;
  /**
   * The configuration source: one live reference per knob, which the Host keeps
   * current as the settings document changes.
   */
  private readonly liveConfig: Config | LiveConfig;
  /**
   * The last snapshot adopted. `resolveConfig()` reads files and probes the
   * workspace, so a committed change is detected by comparing the cheap snapshot
   * and only then re-resolved.
   */
  private adoptedConfig: Config;
  /** Set the first time a QA surface is actually reachable. */
  private surface: QaMemorySurface | undefined;
  /**
   * Sessions asked about before any account claimed them, mapped to the moment
   * they were first missing. One line per session, answered by
   * `qa_memory_attributed` when the claim lands later — without that pair a
   * reader cannot tell a chat that merely started before its browser half from
   * one nobody is ever going to claim.
   */
  private readonly unattributed = new Map<string, number>();

  constructor(ctx: Context, config: Config | LiveConfig = {}) {
    super(ctx, "openvikingMemory", { namespace: "openvikingMemory" });
    this.owner = ctx;
    this.liveConfig = config;
    this.entryConfig = snapshotConfig(config);
    this.adoptedConfig = this.entryConfig;
    this.resolved = resolveConfig(this.entryConfig);
    this.injection = resolveInjectionPlan(this.resolved);
    this.logger = createOpenVikingLogger(ctx.logger);
    this.userSettings = new QaUserMemorySettingsStore(
      this.resolved.qaUserSettingsPath,
      (stage, data) => this.logger.warn(stage, data),
    );

    const client = new OpenVikingClient(this.resolved);
    this.runtime = new OpenVikingRuntime(
      client,
      this.resolved,
      this.logger,
      this.injection,
      (session) => this.scopingFor(session),
    );

    // The lineage of delegated sessions is recorded from the first chat on, so
    // a child is never mistaken for an unclaimed session.
    this.identity.install(ctx);

    // Session disposal has to outlive every injection decision, so it is
    // registered before the startup-profile branch can return.
    ctx.effect(
      () => async () => {
        await this.runtime.disposeAll();
        await this.logger.close();
      },
      "dsh-openviking-memory.lifecycle",
    );

    // The pending-queue drainer is the in-process recovery path: without it a
    // single transient write failure latches capture/commit until the next dsh
    // restart. Started here so every session shares one single-flight drainer.
    this.runtime.startDrainer();
    ctx.effect(
      () => () => this.runtime.stopDrainer(),
      "dsh-openviking-memory.drainer",
    );

    // `agent/created` is a serial event: its listeners are awaited and a throw or
    // rejection fails agent creation and skips the later listeners. So every
    // failure below is logged and swallowed — a memory integration that cannot
    // read a profile must never take a chat down with it.
    ctx.on("agent/created", ({ agent }): undefined | Promise<undefined> => {
      const sessionId = String(agent.session.id);
      try {
        // Registered before any decision to skip this session: attribution can
        // arrive after the session starts (a restart resumes chats before their
        // browser half claims them), and a state created once that happened still
        // has to be committed and dropped when the agent is gone.
        agent.ctx.effect(
          () => () => {
            // The commit runs inside this promise, so it is returned rather than
            // dropped: callers await the disposer to know the session is gone.
            const disposed = this.runtime.dispose(agent.session);
            this.identity.forget(sessionId);
            this.unattributed.delete(sessionId);
            return disposed;
          },
          "openvikingMemory.disposeSession()",
        );
        const scoping = this.activeScoping(agent.session);
        if (scoping === undefined || !scoping.plan.startupProfile) {
          this.logger.debug("startup_profile_skipped", { sessionId });
          return undefined;
        }
        // The host awaits `agent/created` listeners and holds queued input until
        // they finish, which is exactly when a startup profile belongs in the
        // context: before the agent's first step. A rejected read is swallowed
        // here rather than thrown, because a throw would fail the creation this
        // plugin was asked to observe; `agent/pre-step` still delivers a profile
        // the agent left `idle` before this landed.
        return injectStartupProfile(agent, this.runtime)
          .then(() => undefined)
          .catch((error: unknown) => {
            this.logger.warn("startup_profile_failed", {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
          });
      } catch (error: unknown) {
        this.logger.warn("startup_profile_failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return undefined;
    });

    // prepend: downstream waterfall listeners run first, so this plugin sees
    // the final claimed batch and appends after every other contributor.
    // Profile + recall are independent after `next()`; run them concurrently so
    // the agent/pre-step waterfall spends less wall time.
    ctx.on(
      "agent/pre-step",
      async ({ agent, signal }, next): Promise<PreStepDecision> => {
        const decision = await next();
        const scoping = this.activeScoping(agent.session);
        if (scoping === undefined) return decision;
        if (decision.kind !== "enter" || signal.aborted) return decision;

        // Zero-work gating (SPEC §12): a disabled capability contributes no task
        // at all, so neither `profileMessage` nor `recallMessage` runs — and no
        // OpenViking request is issued on its behalf. The plan is this session's
        // own: an account that switched a path off issues no request for it,
        // exactly like a deployment that configured it off.
        const tasks: Promise<UserMessage | null>[] = [];
        if (scoping.plan.stepProfile) {
          tasks.push(this.runtime.profileMessage(agent));
        }
        if (scoping.plan.recall) {
          tasks.push(this.runtime.recallMessage(agent, decision.messages));
        }
        if (tasks.length === 0) return decision;

        const additions = (await Promise.all(tasks)).filter(
          (message): message is UserMessage => message !== null,
        );
        if (signal.aborted) return decision;
        return additions.length > 0
          ? { kind: "enter", messages: [...decision.messages, ...additions] }
          : decision;
      },
      { prepend: true },
    );

    ctx.on("session/event", (session, event) => {
      if (this.activeScoping(session) === undefined) return;
      this.runtime.capture(session, event);
      this.runtime.maybeCommit(session, event);
    });

    ctx.on("session/flush", async (session) => {
      if (this.activeScoping(session) === undefined) return;
      await this.runtime.flush(session);
    });

    // A profile plugin is mounted through a scoped Cordis context, while the
    // tool execution is routed to the agent's scope.  Keep this policy global
    // so every agent using the shared OpenViking bridge is protected; without
    // the explicit option the listener only sees calls in the plugin's scope.
    ctx.on("tools/pre-execute", guardVikingUri, { global: true });

    // Mounted last, and deliberately not awaited: the bridge's apply blocks on
    // its first tools/list, so a server that accepts the connection but never
    // answers would otherwise hold up every registration above it.
    mountOpenVikingMcp(ctx, this.resolved);
    mountOpenVikingSkills(ctx);

    this.logger.info("openviking.ready", {
      endpoint: this.resolved.endpoint,
      hasApiKey: Boolean(this.resolved.apiKey),
      peerId: this.resolved.peerId,
      injection: this.injection,
      syncTurns: this.resolved.syncTurns,
      captureToolResults: this.resolved.captureToolResults,
      skipSubagentSessions: this.resolved.skipSubagentSessions,
      qaUserScoping: this.resolved.qaUserScoping,
      mcpServerName: MCP_SERVER_NAME,
    });

    // A volatile Config publishes the entry as a settings namespace, and the
    // Host by default draws a page for it. This plugin ships its own card for
    // that namespace, so the generated page is turned off and the operator has
    // one editor of one document, as before the settings rewrite. `settings` is
    // an *optional* service — a profile that mounts no settings provider simply
    // keeps the generated page — and `configure` accepts one policy per fiber,
    // so it is registered once, from the fiber that owns the entry.
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.effect(() => {
        // Without a settings provider there is no generated page to turn off,
        // so the effect simply has nothing to dispose.
        const dispose = settingsCtx.settings?.configure(
          { auto: false },
          ctx.fiber,
        );
        return () => dispose?.();
      }, "dsh-openviking-memory.settings-page");
    });
  }

  /**
   * Adopt a committed settings change, if there is one.
   *
   * Since 0.1.7 the plugin's configuration *is* the settings document: every
   * knob of `static Config` is a volatile reference the Host keeps current, so
   * no callback registers this plugin as a listener. The snapshot is cheap and
   * re-resolving it is not (credentials files, workspace probes), so the change
   * is detected by comparing snapshots at the start of an operation.
   */
  private refreshConfig(): void {
    const next = snapshotConfig(this.liveConfig);
    if (JSON.stringify(next) === JSON.stringify(this.adoptedConfig)) return;
    this.adoptedConfig = next;
    this.reapplySettings(next);
  }

  /**
   * Put a fresh configuration to work.
   *
   * Everything the plugin decides per request is re-resolved and handed to the
   * runtime, so an edited switch — or a corrected endpoint — reaches a session
   * that is already running. The one thing that cannot follow live is the
   * bridged MCP tool surface: it is a child process whose transport is fixed
   * when it starts, so a connection change is logged to say so rather than
   * silently leaving the tools on the old server.
   */
  private reapplySettings(next: Config): void {
    let resolved: ResolvedConfig;
    try {
      resolved = resolveConfig(next);
    } catch (error: unknown) {
      // The schema rejected the stored value; keep running on what we have.
      this.logger.warn("settings_rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const previous = this.resolved;
    this.resolved = resolved;
    this.injection = resolveInjectionPlan(resolved);
    this.runtime.reconfigure(resolved, this.injection);
    if (resolved.qaUserSettingsPath !== previous.qaUserSettingsPath) {
      this.userSettings = new QaUserMemorySettingsStore(
        resolved.qaUserSettingsPath,
        (stage, data) => this.logger.warn(stage, data),
      );
    }

    const connectionChanged =
      resolved.endpoint !== previous.endpoint ||
      resolved.apiKey !== previous.apiKey ||
      resolved.account !== previous.account ||
      resolved.user !== previous.user;
    this.logger.info("settings_applied", {
      injection: this.injection,
      endpoint: resolved.endpoint,
      qaUserScoping: resolved.qaUserScoping,
      connectionChanged,
      note: connectionChanged
        ? "the bridged MCP tools keep the endpoint they were mounted with until the plugin reloads"
        : undefined,
    });
  }

  /**
   * The account space and the effective plan for one session, or `undefined`
   * when this session must be left alone entirely.
   *
   * This is the gate every per-session operation passes through, so it is also
   * where a committed settings change is picked up: an edit made in the browser
   * reaches a session that is already running by the time it asks anything.
   */
  private activeScoping(session: Session): SessionScoping | undefined {
    this.refreshConfig();
    if (
      this.resolved.skipSubagentSessions &&
      session.header?.origin === "subagent"
    ) {
      return undefined;
    }
    const scoping = this.scopingFor(session);
    return scoping.allowed ? scoping : undefined;
  }

  /**
   * Per-account scoping for one session; also what the runtime asks before it
   * touches OpenViking.
   *
   * Without a QA surface the plugin owns one memory space for the whole
   * installation, exactly as before this option existed. With one mounted, a
   * session that no account has claimed yet is not attributed to *anybody*:
   * its capture, commit, profile and recall are all skipped until its browser
   * half claims it, so a conversation can never read or write memory in an
   * account space it does not belong to.
   */
  private scopingFor(session: Session): SessionScoping {
    const plan = this.injection;
    const surface = this.qaSurface();
    if (surface === undefined || !this.resolved.qaUserScoping) {
      return { allowed: true, plan };
    }
    const userId = this.identity.userIdFor(session);
    if (userId === undefined) {
      this.noteUnattributed(session);
      return { allowed: false, plan };
    }
    this.noteAttributed(session, userId);
    return {
      allowed: true,
      user: userId,
      plan: effectiveInjectionPlan(plan, this.userSettings.read(userId)),
    };
  }

  /**
   * The QA surface, resolved on first use and remembered afterwards.
   *
   * A QA chat is created *through* that surface, so by the time a session the
   * plugin could be asked about exists, the surface is either active or this
   * deployment has none — there is no window in which a QA session is
   * mistaken for an unmanaged one.
   */
  private qaSurface(): QaMemorySurface | undefined {
    if (this.surface !== undefined) return this.surface;
    const candidate = this.owner.get("qaSurface") as
      Partial<QaMemorySurface> | undefined;
    if (
      candidate === undefined ||
      typeof candidate.principalForSession !== "function" ||
      typeof candidate.principalForToken !== "function"
    ) {
      return undefined;
    }
    this.surface = candidate as QaMemorySurface;
    this.logger.info("qa_user_scoping_active", {
      enabled: this.resolved.qaUserScoping,
      settingsPath: this.userSettings.path(),
    });
    return this.surface;
  }

  /** Say once per session why it is being left alone. */
  private noteUnattributed(session: Session): void {
    const sessionId = String(session.id);
    if (this.unattributed.has(sessionId)) return;
    this.unattributed.set(sessionId, Date.now());
    this.logger.info("qa_memory_unattributed", { sessionId });
  }

  /**
   * Say once, and with the delay it took, that a session which had been left
   * alone is now claimed by an account. A chat is claimed when its browser half
   * opens it, which regularly trails the moment the session starts, so without
   * this line the two outcomes — late claim and never claimed — look identical
   * in the log.
   */
  private noteAttributed(session: Session, userId: string): void {
    const sessionId = String(session.id);
    const since = this.unattributed.get(sessionId);
    if (since === undefined) return;
    this.unattributed.delete(sessionId);
    this.logger.info("qa_memory_attributed", {
      sessionId,
      userId,
      afterMs: Date.now() - since,
    });
  }

  /** Whether this deployment is configured to keep one space per account. */
  private scoped(): boolean {
    return this.resolved.qaUserScoping && this.qaSurface() !== undefined;
  }

  /** The signed-in account must exist; the browser supplies no identity. */
  private requireAccount(token: string): string {
    const userId = this.qaSurface()?.principalForToken(token)?.userId;
    if (userId === undefined) {
      throw new Error(
        "The OpenViking Memory page needs a signed-in QA account.",
      );
    }
    return userId;
  }

  /**
   * What the memory holds about the signed-in account, as its page reads it.
   *
   * Read-only on purpose. The switches that decide whether the assistant uses
   * the memory at all belong to the deployment, and are configured where the
   * deployment's own configuration lives; a page in a person's settings dialog
   * is the place to *show* what the assistant remembers about them, not to let
   * them switch the product's memory off.
   */
  @Remote("userMemoryOverview")
  async userMemoryOverview(token: string): Promise<QaUserMemoryOverview> {
    const userId = this.requireAccount(token);
    const scoped = this.scoped();
    return await readUserMemoryOverview(
      this.runtime.readClientFor(userId, scoped),
      { scoped },
    );
  }

  /** Snapshot of the plugin's current state, for diagnostics and tests. */
  status(): OpenVikingMemoryStatus {
    return {
      connected: this.runtime.connected,
      endpoint: this.resolved.endpoint,
      peerId: this.resolved.peerId,
      capture: this.resolved.syncTurns,
      injection: this.injection,
      liveSessions: this.runtime.liveSessions,
    };
  }
}
