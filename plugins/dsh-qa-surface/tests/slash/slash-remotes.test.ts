import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { createQaSlashRemotes } from "../../src/slash/remotes.js";
import type {
  QaSlashSubmitAttachment,
  ResolvedQaSurfaceConfig,
} from "../../src/types.js";

/**
 * Host admission is the security boundary of the slash interface: the browser
 * may be stale, buggy or hostile, and every decision here is taken again from
 * the deployment's own configuration and the native registries.
 */

interface NativeCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string; readonly attachments?: boolean };
}

const SKILLS = [
  {
    name: "generate-tkp",
    description: "Сформировать ТКП",
    modelInvocable: true,
  },
  { name: "user-only", description: "Только человеком", modelInvocable: false },
];

const COMMANDS: NativeCommand[] = [
  { name: "compact", description: "Compact conversation" },
  {
    name: "goal",
    description: "Set the objective",
    input: { hint: "[<objective>|clear]", attachments: true },
  },
];

interface WorldOptions {
  readonly config?: ResolvedQaSurfaceConfig;
  readonly skills?: readonly (typeof SKILLS)[number][] | undefined;
  readonly skillsFail?: boolean;
  readonly commands?: readonly NativeCommand[] | undefined;
  readonly noCommandService?: boolean;
  readonly agent?: unknown;
  /** Simulate a chat with no live agent. */
  readonly noAgent?: boolean;
  readonly execute?: ReturnType<typeof vi.fn>;
  readonly grant?: readonly string[] | undefined;
  readonly grantThrows?: boolean;
}

function world(options: WorldOptions = {}) {
  const effects: (() => void)[] = [];
  const list = vi.fn(() =>
    options.commands === undefined
      ? COMMANDS
      : options.commands.map((command) => command),
  );
  const execute =
    options.execute ??
    vi.fn(async () => ({
      commandId: "cmd-1",
      result: { kind: "success" as const, text: "Готово" },
    }));
  const skillList = vi.fn(async () => {
    if (options.skillsFail === true) throw new Error("skills registry is down");
    return { skills: options.skills ?? SKILLS };
  });
  const sessionSkillCatalog =
    options.skills === undefined && options.skillsFail !== true
      ? { list: skillList }
      : { list: skillList };
  const commands =
    options.noCommandService === true ? undefined : { list, execute };
  const agent =
    options.noAgent === true ? undefined : (options.agent ?? { id: "agent" });
  const ctx = {
    inject: (
      names: readonly string[],
      callback: (target: Record<string, unknown>) => unknown,
    ) => {
      const target: Record<string, unknown> = {
        effect: (fn: () => () => void) => {
          effects.push(fn());
        },
      };
      if (names.includes("sessionSkillCatalog")) {
        target.sessionSkillCatalog = sessionSkillCatalog;
      }
      if (names.includes("commands") && commands !== undefined) {
        target.commands = commands;
      }
      callback(target);
    },
    agents: { get: () => agent },
  } as never;
  const grant = vi.fn(async () => {
    if (options.grantThrows === true)
      throw new Error("(reason: auth-required)");
    return options.grant;
  });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const remotes = createQaSlashRemotes({
    ctx,
    getConfig: () => options.config ?? ENABLED,
    logger: logger as never,
    sessionGrant: grant,
  });
  return { remotes, execute, list, skillList, grant, logger };
}

/** Slash enabled, every skill admitted by name, every command denied. */
const ENABLED = resolveConfig({
  lockdown: { allowSlashCommands: true },
  slashCommands: {
    skills: { mode: "allow-list", allow: ["generate-tkp"] },
    commands: { mode: "deny-all", allow: [] },
  },
} as never);

/** The same deployment with the user-only skill named as well. */
const ENABLED_WITH_USER_SKILL = resolveConfig({
  lockdown: { allowSlashCommands: true },
  slashCommands: {
    skills: { mode: "allow-list", allow: ["generate-tkp", "user-only"] },
    commands: { mode: "deny-all", allow: [] },
  },
} as never);

const COMMANDS_ALLOWED = resolveConfig({
  lockdown: { allowSlashCommands: true },
  slashCommands: {
    skills: { mode: "allow-list", allow: ["generate-tkp"] },
    commands: { mode: "allow-list", allow: ["compact", "goal"] },
  },
} as never);

describe("QA slash catalog remote", () => {
  it("answers with the switch off before touching any registry", async () => {
    const { remotes, skillList } = world({ config: resolveConfig() });
    await expect(remotes.catalog("", "session-1")).resolves.toEqual({
      enabled: false,
      entries: [],
      commandSurface: "unavailable",
      deniedSkills: [],
    });
    expect(skillList).not.toHaveBeenCalled();
  });

  it("offers the session's user-invocable skills the policy admits", async () => {
    const { remotes } = world();
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.enabled).toBe(true);
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "skill:generate-tkp",
    ]);
    // A skill the policy withholds is named, so the browser can warn about a
    // `/name` typed inside an ordinary sentence.
    expect(catalog.deniedSkills).toEqual(["user-only"]);
  });

  it("offers a user-only skill the policy names", async () => {
    // `disable-model-invocation: true` keeps a skill out of the model catalog
    // but not out of the palette; the native catalog decides that, not QA.
    const { remotes } = world({ config: ENABLED_WITH_USER_SKILL });
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "skill:generate-tkp",
      "skill:user-only",
    ]);
    expect(catalog.deniedSkills).toEqual([]);
  });

  it("hides a skill the chat's role withholds, and says so", async () => {
    const { remotes } = world({ grant: [] });
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.entries).toEqual([]);
    expect(catalog.deniedSkills).toEqual(["generate-tkp", "user-only"]);
  });

  it("keeps the skills half working when the command registry is absent", async () => {
    const { remotes } = world({ noCommandService: true });
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.commandSurface).toBe("unavailable");
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "skill:generate-tkp",
    ]);
  });

  it("keeps the commands half working when the skills half fails", async () => {
    const { remotes } = world({
      config: COMMANDS_ALLOWED,
      skillsFail: true,
    });
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "command:compact",
      "command:goal",
    ]);
    expect(catalog.deniedSkills).toEqual([]);
  });

  it("treats a cold chat as having no commands, not as an error", async () => {
    const { remotes } = world({ config: COMMANDS_ALLOWED, noAgent: true });
    const catalog = await remotes.catalog("", "session-1");
    expect(catalog.commandSurface).toBe("inactive");
    expect(catalog.entries.map((entry) => entry.kind)).toEqual(["skill"]);
  });

  it("refuses to name anything for a chat the caller does not own", async () => {
    const { remotes } = world({ grantThrows: true });
    await expect(remotes.catalog("stale", "session-1")).rejects.toThrow(
      /auth-required/u,
    );
  });

  it("checks ownership before it reads a command surface", async () => {
    const { remotes, list } = world({
      grantThrows: true,
      config: COMMANDS_ALLOWED,
    });
    await expect(
      remotes.execute("stale", "session-1", "/compact", []),
    ).rejects.toThrow(/auth-required/u);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("QA slash command admission", () => {
  it("refuses every command while the master switch is off", async () => {
    const { remotes, execute } = world({ config: resolveConfig() });
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({ kind: "refused", reason: "slash-disabled" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a command the deployment did not admit", async () => {
    // `compact` exists natively and the palette would show it under a permissive
    // policy — a hand-typed line must still be refused by the default.
    const { remotes, execute } = world();
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({ kind: "refused", reason: "not-allowed" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a line that is not a command at all", async () => {
    const { remotes, execute } = world({ config: COMMANDS_ALLOWED });
    await expect(
      remotes.execute("", "s", "/usr/bin/env", []),
    ).resolves.toMatchObject({ kind: "refused", reason: "unknown-command" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an admitted name the native registry no longer resolves", async () => {
    const { remotes, execute } = world({
      config: COMMANDS_ALLOWED,
      commands: [{ name: "goal", description: "" }],
    });
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({ kind: "refused", reason: "unknown-command" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes an admitted line through and reports the outcome", async () => {
    const { remotes, execute } = world({ config: COMMANDS_ALLOWED });
    await expect(remotes.execute("", "s", "/compact", [])).resolves.toEqual({
      kind: "executed",
      commandId: "cmd-1",
      outcome: { kind: "success", text: "Готово" },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      "/compact",
      [],
      expect.anything(),
    );
  });

  it("keeps the sourceEventSeq a richer presentation is built from", async () => {
    const execute = vi.fn(async () => ({
      commandId: "cmd-9",
      result: { kind: "success" as const, text: "Сжато", sourceEventSeq: 42 },
    }));
    const { remotes } = world({ config: COMMANDS_ALLOWED, execute });
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({
      outcome: { kind: "success", sourceEventSeq: 42 },
    });
  });

  it("admits attachments only for a command that declares them", async () => {
    const image: QaSlashSubmitAttachment = {
      type: "image",
      mediaType: "image/png",
      data: "AA",
    };
    const refused = world({ config: COMMANDS_ALLOWED });
    await expect(
      refused.remotes.execute("", "s", "/compact", [image]),
    ).resolves.toMatchObject({
      kind: "refused",
      reason: "attachments-unsupported",
    });
    expect(refused.execute).not.toHaveBeenCalled();

    const admitted = world({ config: COMMANDS_ALLOWED });
    await expect(
      admitted.remotes.execute("", "s", "/goal ship it", [image]),
    ).resolves.toMatchObject({ kind: "executed" });
    expect(admitted.execute).toHaveBeenCalledWith(
      expect.anything(),
      "/goal ship it",
      [image],
      expect.anything(),
    );
  });

  it("never passes attachments through on a bare invocation", async () => {
    const { remotes, execute } = world({ config: COMMANDS_ALLOWED });
    await remotes.execute("", "s", "/compact", []);
    expect(execute.mock.calls[0]?.[2]).toEqual([]);
  });

  it("refuses with the native reason when the command needs a live chat", async () => {
    const { remotes } = world({ config: COMMANDS_ALLOWED, noAgent: true });
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({
      kind: "refused",
      reason: "inactive-session",
    });
  });

  it("reports a thrown handler as a consumed submission with an error", async () => {
    // The runtime already appended command/done with the failure, so the row
    // reaches the transcript either way; the composer must not keep the draft.
    const execute = vi.fn(async () => {
      throw new Error("compaction refused");
    });
    const { remotes } = world({ config: COMMANDS_ALLOWED, execute });
    await expect(remotes.execute("", "s", "/compact", [])).resolves.toEqual({
      kind: "executed",
      commandId: "",
      outcome: { kind: "error", text: "compaction refused" },
    });
  });

  it("reports a native error result without inventing a refusal", async () => {
    const execute = vi.fn(async () => ({
      commandId: "cmd-2",
      result: { kind: "error" as const, text: "/compact is unavailable here" },
    }));
    const { remotes } = world({ config: COMMANDS_ALLOWED, execute });
    await expect(
      remotes.execute("", "s", "/compact", []),
    ).resolves.toMatchObject({
      kind: "executed",
      outcome: { kind: "error", text: "/compact is unavailable here" },
    });
  });

  it("logs names, never the text the user typed", async () => {
    const { remotes, logger } = world({ config: COMMANDS_ALLOWED });
    await remotes.execute("", "s", "/goal засекреченный текст", []);
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain("goal");
    expect(logged).not.toContain("засекреченный");
  });
});
