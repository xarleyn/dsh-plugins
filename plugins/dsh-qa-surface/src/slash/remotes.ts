import type { Context } from "@deepseek-ai/cordis";
import type { SkillListValue } from "@deepseek-ai/dsh-api-session-controller";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { isUserInvocable, type SkillSummary } from "@deepseek-ai/dsh-skill";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type {
  QaSlashCatalog,
  QaSlashCatalogEntry,
  QaSlashCommandOutcome,
  QaSlashCommandSurface,
  QaSlashExecution,
  QaSlashRefusal,
  QaSlashSubmitAttachment,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import {
  buildSlashCatalog,
  type QaSlashNativeCommand,
  type QaSlashNativeSkill,
} from "./catalog.js";
import { parseSlashLine } from "./parser.js";
import { allowsSlashName, type QaSlashPolicy } from "./policy.js";

/**
 * Structural view of the native command runtime.
 *
 * `@deepseek-ai/dsh-commands` is not a dependency on purpose: a deployment may
 * compose the QA surface without it, and a hard import would turn that into a
 * load failure instead of a palette with no commands. The shape below is the
 * published contract of `ctx.commands`; the service is reached through
 * `ctx.inject`, so its absence is an ordinary state rather than an error.
 */
interface QaNativeCommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly input?: {
    readonly hint: string;
    readonly attachments?: boolean;
  };
}

interface QaNativeCommandExecution {
  readonly commandId: string;
  readonly result:
    | {
        readonly kind: "success";
        readonly text?: string;
        readonly sourceEventSeq?: number;
      }
    | { readonly kind: "error"; readonly text: string };
}

interface QaNativeCommands {
  list(agent: unknown): readonly QaNativeCommandDescriptor[];
  execute(
    agent: unknown,
    line: string,
    attachments: readonly QaSlashSubmitAttachment[],
    signal: AbortSignal,
  ): Promise<QaNativeCommandExecution | undefined>;
}

/** Session-addressed, cold-readable skill catalog the native web client uses. */
interface QaNativeSkillCatalog {
  list(
    request: { readonly sessionId: SessionId },
    signal: AbortSignal,
  ): Promise<SkillListValue>;
}

/**
 * The reads below are bounded by the Remote transport and by the caller's own
 * patience; an internal deadline would only cut off a slow filesystem scan.
 */
const NO_CANCELLATION = new AbortController().signal;

const REFUSAL_COPY: Readonly<Record<QaSlashRefusal, string>> = Object.freeze({
  "slash-disabled": "Slash actions are disabled on this deployment.",
  "unknown-command": "No such command.",
  "not-allowed": "This command is not allowed on this deployment.",
  "attachments-unsupported": "This command does not accept attachments.",
  "inactive-session": "The command surface needs a live chat.",
});

function refusal(reason: QaSlashRefusal, detail?: string): QaSlashExecution {
  return Object.freeze({
    kind: "refused" as const,
    reason,
    message: detail ?? REFUSAL_COPY[reason],
  });
}

/**
 * Host-side bodies of the slash remotes. The `@Remote`-decorated signatures
 * stay on the `QaSurface` service class (typert code generation reads the class
 * shape); this context owns everything behind them.
 *
 * The division of labour is the whole feature in one sentence: QA decides what
 * the palette may show and whether a line may run, and the native registries
 * decide what a skill and a command *mean*. Nothing here reads a SKILL.md,
 * injects instructions or re-implements a registry.
 */
export interface QaSlashRemotes {
  /** The catalog this browser may render, already policy-filtered. */
  catalog(token: string, sessionId: string): Promise<QaSlashCatalog>;
  /** Run one human command line through the native command runtime. */
  execute(
    token: string,
    sessionId: string,
    line: string,
    attachments: readonly QaSlashSubmitAttachment[],
  ): Promise<QaSlashExecution>;
}

export interface QaSlashRemotesOptions {
  readonly ctx: Context;
  readonly getConfig: () => ResolvedQaSurfaceConfig;
  readonly logger: PluginLogger;
  /**
   * Ownership and role check for the current QA session. Runs only while the
   * deployment gates QA users with accounts; it throws on refusal, which is
   * what makes a foreign session unreadable instead of merely unowned.
   *
   * @returns the role's user-skill grant, or `undefined` when the access
   * system has no opinion about this session's skills.
   */
  readonly sessionGrant: (
    token: string,
    sessionId: string,
    agent: unknown,
  ) => Promise<readonly string[] | undefined>;
}

function policyOf(
  mode: QaSlashPolicy["mode"],
  allow: readonly string[],
): QaSlashPolicy {
  return { mode, allow };
}

/**
 * User-invocable skills of this chat that no row of the palette represents.
 * The list exists so the browser can say "this `/name` will not load" about a
 * gesture typed inside a sentence, which it can only do if it can tell a real
 * but withheld skill from a path that merely looks like one.
 */
function withheldSkills(
  skills: readonly QaSlashNativeSkill[] | undefined,
  entries: readonly QaSlashCatalogEntry[],
): readonly string[] {
  if (skills === undefined) return Object.freeze([]);
  const shown = new Set(
    entries
      .filter((entry) => entry.kind === "skill")
      .map((entry) => entry.name),
  );
  return Object.freeze(
    skills.map((skill) => skill.name).filter((name) => !shown.has(name)),
  );
}

export function createQaSlashRemotes(
  options: QaSlashRemotesOptions,
): QaSlashRemotes {
  const { ctx, getConfig, logger, sessionGrant } = options;
  let skillCatalog: QaNativeSkillCatalog | undefined;
  let nativeCommands: QaNativeCommands | undefined;

  // Both surfaces are optional capabilities. The session-addressed catalog is
  // preferred because it answers for a cold chat too; the registry below is
  // the fallback for a composition that has skills but no session controller.
  ctx.inject(["sessionSkillCatalog"], (catalogCtx) => {
    skillCatalog =
      catalogCtx.sessionSkillCatalog as unknown as QaNativeSkillCatalog;
    catalogCtx.effect(
      () => () => {
        skillCatalog = undefined;
      },
      "dsh-qa-surface.slash-skill-catalog",
    );
  });
  ctx.inject(["commands"], (commandsCtx) => {
    nativeCommands = (commandsCtx as unknown as { commands: QaNativeCommands })
      .commands;
    commandsCtx.effect(
      () => () => {
        nativeCommands = undefined;
      },
      "dsh-qa-surface.slash-commands",
    );
  });

  function agentOf(sessionId: string): unknown {
    return ctx.agents.get(SessionId(sessionId));
  }

  /** User-invocable skills of the session; `undefined` when unreadable. */
  async function readSkills(
    sessionId: string,
    agent: unknown,
  ): Promise<readonly QaSlashNativeSkill[] | undefined> {
    if (skillCatalog !== undefined) {
      try {
        const value = await skillCatalog.list(
          { sessionId: SessionId(sessionId) },
          NO_CANCELLATION,
        );
        return value.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          modelInvocable: skill.modelInvocable,
          ...(skill.whenToUse === undefined
            ? {}
            : { whenToUse: skill.whenToUse }),
        }));
      } catch (error) {
        logger.warn("slash.catalog.skills-failed", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    }
    if (agent === undefined) return undefined;
    try {
      // Same view the session-addressed catalog builds: the agent is the
      // scope, and its cwd decides which project layer contributes.
      const live = agent as {
        readonly ctx: Context;
        readonly session: { readonly header: { readonly cwd?: string } };
      };
      const cwd = live.session.header.cwd;
      const listed = await live.ctx.skills.list({
        scope: agent as never,
        ...(cwd === undefined ? {} : { cwd }),
      });
      return listed.filter(isUserInvocable).map((skill: SkillSummary) => ({
        name: skill.name,
        description: skill.description,
        modelInvocable: skill.invocation.modelInvocable,
        ...(skill.whenToUse === undefined
          ? {}
          : { whenToUse: skill.whenToUse }),
      }));
    } catch (error) {
      logger.warn("slash.catalog.skills-failed", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  function readCommands(
    agent: unknown,
  ): readonly QaSlashNativeCommand[] | undefined {
    if (nativeCommands === undefined || agent === undefined) return undefined;
    try {
      return nativeCommands.list(agent).map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.input === undefined
          ? {}
          : { inputHint: command.input.hint }),
        ...(command.input?.attachments === undefined
          ? {}
          : { acceptsAttachments: command.input.attachments }),
      }));
    } catch (error) {
      logger.warn("slash.catalog.commands-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  function commandSurfaceOf(
    agent: unknown,
    commands: readonly QaSlashNativeCommand[] | undefined,
  ): QaSlashCommandSurface {
    if (nativeCommands === undefined) return "unavailable";
    if (agent === undefined) return "inactive";
    return commands === undefined ? "unavailable" : "ready";
  }

  return {
    async catalog(token, sessionId) {
      const config = getConfig();
      if (!config.slashCommands.enabled) {
        return Object.freeze({
          enabled: false,
          entries: Object.freeze([]) as readonly QaSlashCatalogEntry[],
          commandSurface: "unavailable" as const,
          deniedSkills: Object.freeze([]) as readonly string[],
        });
      }
      const agent = agentOf(sessionId);
      // Ownership is checked before anything is read: the catalog names the
      // session's skills and its operator's commands, which is exactly the
      // kind of fact a foreign browser must not be able to enumerate.
      const granted = await sessionGrant(token, sessionId, agent);
      const [skills, commands] = [
        await readSkills(sessionId, agent),
        readCommands(agent),
      ];
      const commandSurface = commandSurfaceOf(agent, commands);
      const entries = buildSlashCatalog({
        skills: skills ?? [],
        commands: commands ?? [],
        skillPolicy: policyOf(
          config.slashCommands.skills.mode,
          config.slashCommands.skills.allow,
        ),
        commandPolicy: policyOf(
          config.slashCommands.commands.mode,
          config.slashCommands.commands.allow,
        ),
        grantedSkills: granted,
        commandSurface,
      });
      const deniedSkills = withheldSkills(skills, entries);
      logger.info("slash.catalog.load", {
        sessionId,
        skills: skills?.length ?? 0,
        commands: commands?.length ?? 0,
        entries: entries.length,
        commandSurface,
      });
      return Object.freeze({
        enabled: true,
        entries,
        commandSurface,
        deniedSkills,
      });
    },

    async execute(token, sessionId, line, attachments) {
      const config = getConfig();
      if (!config.slashCommands.enabled) return refusal("slash-disabled");
      const parsed = parseSlashLine(line);
      if (parsed === undefined) return refusal("unknown-command");
      const name = parsed.name;
      // Admission re-derives everything from the line. The browser's catalog is
      // a presentation cache and never an authorization: a name the policy does
      // not admit is refused here even though the palette never showed it.
      if (
        !allowsSlashName(
          policyOf(
            config.slashCommands.commands.mode,
            config.slashCommands.commands.allow,
          ),
          name,
        )
      ) {
        logger.warn("slash.denied", { sessionId, kind: "command", name });
        return refusal("not-allowed");
      }
      // Ownership before execution, exactly as the catalog read does: a
      // command mutates the chat it runs in, so a foreign browser must not be
      // able to reach the native runtime through this surface at all.
      const agent = agentOf(sessionId);
      await sessionGrant(token, sessionId, agent);
      if (nativeCommands === undefined || agent === undefined) {
        return refusal("inactive-session");
      }
      const descriptor = nativeCommands
        .list(agent)
        .find((command) => command.name === name);
      if (descriptor === undefined) {
        logger.warn("slash.unknown", { sessionId, kind: "command", name });
        return refusal("unknown-command");
      }
      if (attachments.length > 0 && descriptor.input?.attachments !== true) {
        // Refused before the handler ran, so the composer keeps its draft and
        // its attachments; the native runtime re-checks this as the authority.
        return refusal("attachments-unsupported");
      }
      logger.info("slash.command.execute", {
        sessionId,
        name,
        attachments: attachments.length,
      });
      let execution: QaNativeCommandExecution | undefined;
      try {
        execution = await nativeCommands.execute(
          agent,
          line,
          attachments,
          NO_CANCELLATION,
        );
      } catch (error) {
        // The handler threw: the runtime already wrote command/done with the
        // failure into the session log, so the transcript row carries the
        // outcome and this only tells the caller the submission was consumed.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("slash.command.error", { sessionId, name, message });
        const failed: QaSlashCommandOutcome = { kind: "error", text: message };
        return Object.freeze({
          kind: "executed" as const,
          commandId: "",
          outcome: Object.freeze(failed),
        });
      }
      if (execution === undefined) {
        logger.warn("slash.unknown", { sessionId, kind: "command", name });
        return refusal("unknown-command");
      }
      const outcome: QaSlashCommandOutcome =
        execution.result.kind === "success"
          ? {
              kind: "success",
              ...(execution.result.text === undefined
                ? {}
                : { text: execution.result.text }),
              ...(execution.result.sourceEventSeq === undefined
                ? {}
                : { sourceEventSeq: execution.result.sourceEventSeq }),
            }
          : { kind: "error", text: execution.result.text };
      logger.info(
        outcome.kind === "success"
          ? "slash.command.success"
          : "slash.command.error",
        { sessionId, name, commandId: execution.commandId },
      );
      return Object.freeze({
        kind: "executed" as const,
        commandId: execution.commandId,
        outcome: Object.freeze(outcome),
      });
    },
  };
}
