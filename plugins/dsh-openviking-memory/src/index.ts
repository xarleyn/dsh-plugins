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

import { Service, type Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

import { OpenVikingClient } from "./client.js";
import {
  Config as ConfigSchema,
  MCP_SERVER_NAME,
  resolveConfig,
  resolveInjectionPlan,
  type Config,
  type InjectionPlan,
  type ResolvedConfig,
} from "./config.js";
import { injectStartupProfile } from "./lifecycle.js";
import { createOpenVikingLogger } from "./logging.js";
import { mountOpenVikingMcp } from "./mcp.js";
import { OpenVikingRuntime } from "./runtime.js";
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
} from "./config.js";
export type {
  Config as OpenVikingConfig,
  InjectionPlan,
  ResolvedConfig,
} from "./config.js";
export { OpenVikingClient } from "./client.js";
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

export default class OpenVikingMemory extends Service {
  static Config = ConfigSchema;
  static inject = inject;

  /** The config exactly as the user wrote it, before defaults were resolved. */
  readonly entryConfig: Config;
  /** Every knob resolved, plus the derived peer/user-agent fields. */
  readonly resolved: ResolvedConfig;
  /** Which automatic context additions are enabled after `autoInject` gating. */
  readonly injection: InjectionPlan;
  /** Per-session capture, commit, profile and recall. */
  readonly runtime: OpenVikingRuntime;
  private readonly logger: PluginLogger;

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, "openvikingMemory");
    this.entryConfig = config;
    this.resolved = resolveConfig(config);
    this.injection = resolveInjectionPlan(this.resolved);
    this.logger = createOpenVikingLogger(ctx.logger);

    const client = new OpenVikingClient(this.resolved);
    this.runtime = new OpenVikingRuntime(
      client,
      this.resolved,
      this.logger,
      this.injection,
    );

    const skipMemory = (session: Session | undefined): boolean =>
      Boolean(
        this.resolved.skipSubagentSessions &&
        session?.header?.origin === "subagent",
      );

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

    ctx.on("agent/session-start", ({ agent }) => {
      if (skipMemory(agent.session)) return false;
      agent.ctx.effect(
        () => () => this.runtime.dispose(agent.session),
        "openvikingMemory.disposeSession()",
      );
      if (!this.injection.startupProfile) {
        this.logger.debug("startup_profile_skipped", {
          sessionId: String(agent.session.id),
        });
        return false;
      }
      // `emit` dispatch does not await the returned promise, and this is the
      // very first thing a fresh agent does — so a failure has to be caught
      // here rather than surfacing as an unhandled rejection. Per-step profile
      // delivery covers the case where the agent left `idle` before this
      // landed.
      return injectStartupProfile(agent, this.runtime).catch(
        (error: unknown) => {
          this.logger.warn("startup_profile_failed", {
            sessionId: String(agent.session.id),
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        },
      );
    });

    // prepend: downstream waterfall listeners run first, so this plugin sees
    // the final claimed batch and appends after every other contributor.
    // Profile + recall are independent after `next()`; run them concurrently so
    // the agent/pre-step waterfall spends less wall time.
    ctx.on(
      "agent/pre-step",
      async ({ agent, signal }, next): Promise<PreStepDecision> => {
        const decision = await next();
        if (skipMemory(agent.session)) return decision;
        if (decision.kind !== "enter" || signal.aborted) return decision;

        // Zero-work gating (SPEC §12): a disabled capability contributes no task
        // at all, so neither `profileMessage` nor `recallMessage` runs — and no
        // OpenViking request is issued on its behalf.
        const tasks: Promise<UserMessage | null>[] = [];
        if (this.injection.stepProfile) {
          tasks.push(this.runtime.profileMessage(agent));
        }
        if (this.injection.recall) {
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
      if (skipMemory(session)) return;
      this.runtime.capture(session, event);
      this.runtime.maybeCommit(session, event);
    });

    ctx.on("session/flush", async (session) => {
      if (skipMemory(session)) return;
      await this.runtime.flush(session);
    });

    ctx.on("tools/pre-execute", guardVikingUri);

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
      mcpServerName: MCP_SERVER_NAME,
    });
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
