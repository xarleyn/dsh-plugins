import { describe, expect, it } from "vitest";
import { DEFAULT_QA_TEXT_EXTENSIONS } from "../src/attachment-rules.js";
import { resolveConfig } from "../src/resolve-config.js";
import { DEFAULT_THINKING_PHRASES } from "../src/thinking-phrases.js";
import { schemaParse } from "./config.helpers.js";

describe("qa surface config", () => {
  it("hides other users' chats by default and allows admins to opt in", () => {
    expect(resolveConfig().accounts.showOtherUsersChats).toBe(false);
    expect(
      resolveConfig({ accounts: { showOtherUsersChats: true } }).accounts
        .showOtherUsersChats,
    ).toBe(true);
  });

  it("allows operators to opt into reasoning and tool activity", () => {
    expect(
      resolveConfig({
        ui: { showReasoning: true, showToolActivity: true },
      }).ui,
    ).toMatchObject({ showReasoning: true, showToolActivity: true });
  });

  it("normalizes optional strings and suggested questions", () => {
    const config = resolveConfig({
      session: { workspaceId: "  workspace-1 " },
      suggestedQuestions: [" First? ", "First?", ""],
    });
    expect(config.session.workspaceId).toBe("workspace-1");
    expect(config.suggestedQuestions).toEqual(["First?"]);
  });

  it("allows the default quick questions to be disabled", () => {
    expect(
      resolveConfig({ suggestedQuestions: [] }).suggestedQuestions,
    ).toEqual([]);
  });

  it("normalizes the running phrases", () => {
    const config = resolveConfig({
      thinkingPhrases: [" Точу ", "Точу", "", "  "],
    });
    expect(config.thinkingPhrases).toEqual(["Точу"]);
  });

  it("defaults attachment intake to text files with a 200-line paste rule", () => {
    expect(resolveConfig().attachments).toEqual({
      textFiles: true,
      pastedTextLines: 200,
      maxFileBytes: 10_485_760,
      maxPending: 8,
      extensions: DEFAULT_QA_TEXT_EXTENSIONS,
    });
  });

  it("normalizes the configured extension list", () => {
    const config = resolveConfig({
      attachments: { extensions: [".MD", "TXT", "md", "a b", ""] },
    });
    expect(config.attachments.extensions).toEqual(["md", "txt"]);
  });

  it("bounds the attachment numbers and pins the paste rule to integers", () => {
    expect(() =>
      resolveConfig({ attachments: { pastedTextLines: -1 } }),
    ).toThrow(/attachments\.pastedTextLines/u);
    expect(() =>
      resolveConfig({ attachments: { pastedTextLines: 1.5 } }),
    ).toThrow(/attachments\.pastedTextLines/u);
    expect(() => resolveConfig({ attachments: { maxFileBytes: 512 } })).toThrow(
      /attachments\.maxFileBytes/u,
    );
    expect(() => resolveConfig({ attachments: { maxPending: 0 } })).toThrow(
      /attachments\.maxPending/u,
    );
    // Zero is meaningful: it turns the paste conversion off without
    // disabling text files.
    expect(
      resolveConfig({ attachments: { pastedTextLines: 0 } }).attachments
        .pastedTextLines,
    ).toBe(0);
  });

  it("restores the built-in running phrases for an empty list", () => {
    // Unlike quick questions, an empty list cannot hide the indicator, so it
    // degrades back to the shipped phrases instead of silencing the label.
    expect(resolveConfig({ thinkingPhrases: [] }).thinkingPhrases).toEqual(
      DEFAULT_THINKING_PHRASES,
    );
    expect(resolveConfig({ thinkingPhrases: ["  "] }).thinkingPhrases).toEqual(
      DEFAULT_THINKING_PHRASES,
    );
  });

  it("rejects a running phrase that cannot fit the indicator", () => {
    expect(() => resolveConfig({ thinkingPhrases: ["я".repeat(121)] })).toThrow(
      /thinking phrases/u,
    );
  });

  it("requires a named permission preset while lockdown is enabled", () => {
    expect(() =>
      resolveConfig({ lockdown: { permissionPreset: "  " } }),
    ).toThrow(/permissionPreset/u);
  });

  it("blocks interactions until the deployment opts into the QA view", () => {
    expect(resolveConfig().interaction).toEqual({
      approvals: "blocked",
      questions: "unsupported",
    });
    expect(
      resolveConfig({ interaction: { approvals: "interactive" } }).interaction,
    ).toEqual({ approvals: "interactive", questions: "unsupported" });
    expect(
      resolveConfig({ interaction: { questions: "interactive" } }).interaction,
    ).toEqual({ approvals: "blocked", questions: "interactive" });
  });

  it("reads the documented `enabled` spelling of the question seam", () => {
    // A deployment may write either name; the resolved config carries one, so
    // every reader below compares against a single value.
    expect(resolveConfig({ interaction: { questions: "enabled" } })).toEqual(
      resolveConfig({ interaction: { questions: "interactive" } }),
    );
    expect(
      resolveConfig(schemaParse({ interaction: { questions: "enabled" } }))
        .interaction.questions,
    ).toBe("interactive");
  });

  it("requires explicit reset authorization when the reset control is shown", () => {
    expect(() => resolveConfig({ ui: { showReset: true } })).toThrow(
      /allowSessionReset/u,
    );
  });

  it.each([
    ["allowPermissionChanges", true],
    ["allowSettingsMutation", true],
    ["allowSessionRename", true],
    ["allowSessionDelete", true],
    ["allowArbitrarySessionOpen", true],
  ])("rejects capability expansion through %s", (field, value) => {
    expect(() =>
      resolveConfig({
        lockdown: { [field]: value },
      } as never),
    ).toThrow(new RegExp(field, "u"));
  });

  /**
   * The slash master switch is the one capability flag a deployment may set:
   * a switch that refuses to be turned on is dead configuration. It opens
   * nothing by itself, which is what the two assertions below pin.
   */
  it("accepts the slash master switch and keeps its policy inert", () => {
    const resolved = resolveConfig({
      lockdown: { allowSlashCommands: true },
    } as never);
    expect(resolved.lockdown.allowSlashCommands).toBe(true);
    expect(resolved.slashCommands.enabled).toBe(true);
    // Declared only as the switch: legacy compatibility, skills at `all` and
    // commands denied, reported so the Host can say so out loud.
    expect(resolved.slashCommands.skills.mode).toBe("all");
    expect(resolved.slashCommands.commands.mode).toBe("deny-all");
    expect(resolved.slashCommands.legacyDefaults).toBe(true);
    // Nothing about the execution policy moved with it.
    expect(resolved.lockdown.sandboxMode).toBe("read-only");
    expect(resolved.lockdown.approvalPolicy).toBe("never");
    expect(resolved.lockdown.toolPolicy).toEqual({
      mode: "allow-list",
      allow: [],
    });
    expect(resolved.lockdown.allowPermissionChanges).toBe(false);
    expect(resolved.lockdown.allowSettingsMutation).toBe(false);
  });

  it("keeps the slash master switch off unless the deployment turns it on", () => {
    expect(resolveConfig().lockdown.allowSlashCommands).toBe(false);
    expect(resolveConfig().slashCommands.enabled).toBe(false);
    // Declaring a policy without the switch changes nothing at all.
    const declared = resolveConfig({
      slashCommands: {
        skills: { mode: "all", allow: [] },
        commands: { mode: "all", allow: [] },
      },
    } as never);
    expect(declared.slashCommands.enabled).toBe(false);
    expect(declared.slashCommands.commands.mode).toBe("all");
  });
});
