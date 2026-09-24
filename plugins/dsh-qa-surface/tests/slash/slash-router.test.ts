import { describe, expect, it } from "vitest";
import { resolveSlashRoute } from "../../src/client/slash/slash-router.js";
import type { QaSlashCatalogEntry } from "../../src/types.js";
import { slashEntry } from "../helpers/slash.js";

const SKILL_TKP = slashEntry("skill", "generate-tkp", {
  description: "Сформировать ТКП",
});
const SKILL_PLAN = slashEntry("skill", "plan");
const COMMAND_PLAN = slashEntry("command", "plan");
const COMMAND_COMPACT = slashEntry("command", "compact");

const ENTRIES: readonly QaSlashCatalogEntry[] = [
  SKILL_TKP,
  SKILL_PLAN,
  COMMAND_PLAN,
  COMMAND_COMPACT,
];

function route(
  text: string,
  overrides: Partial<Parameters<typeof resolveSlashRoute>[0]> = {},
) {
  return resolveSlashRoute({
    text,
    enabled: true,
    catalogReady: true,
    entries: ENTRIES,
    deniedSkills: [],
    picked: null,
    ...overrides,
  });
}

describe("slash router", () => {
  it("leaves ordinary text to the model", () => {
    expect(route("Что ты умеешь?")).toEqual({ kind: "prompt" });
    // A `/name` in the middle of a sentence is not a command line and stays
    // ordinary prose — the native consumer handles the gesture, not this.
    expect(route("ordinary /foo text")).toEqual({ kind: "prompt" });
  });

  it("routes a user-invocable skill to the prompt path", () => {
    expect(route("/generate-tkp Сделай ТКП")).toEqual({
      kind: "skill",
      entry: SKILL_TKP,
    });
  });

  it("routes an admitted command to the command runtime", () => {
    expect(route("/compact")).toEqual({
      kind: "command",
      entry: COMMAND_COMPACT,
    });
    expect(route("/compact now")).toEqual({
      kind: "command",
      entry: COMMAND_COMPACT,
    });
  });

  it("refuses a name nothing offers", () => {
    expect(route("/does-not-exist")).toEqual({
      kind: "unknown",
      name: "does-not-exist",
    });
  });

  it("refuses every slash line while the deployment runs with it off", () => {
    expect(route("/compact", { enabled: false })).toEqual({ kind: "disabled" });
    expect(route("/generate-tkp x", { enabled: false })).toEqual({
      kind: "disabled",
    });
    // Ordinary text is never touched by the switch.
    expect(route("просто текст", { enabled: false })).toEqual({
      kind: "prompt",
    });
  });

  it("refuses to guess while the catalog is unreadable", () => {
    // Never silently as a prompt: the native consumer would act on it.
    expect(route("/compact", { catalogReady: false })).toEqual({
      kind: "unavailable",
      name: "compact",
    });
  });

  describe("collision", () => {
    it("asks the user when a skill and a command share the name", () => {
      expect(route("/plan")).toEqual({
        kind: "ambiguous",
        name: "plan",
        entries: [SKILL_PLAN, COMMAND_PLAN],
      });
    });

    it("honours the identity the user picked", () => {
      expect(route("/plan", { picked: "skill:plan" })).toEqual({
        kind: "skill",
        entry: SKILL_PLAN,
      });
      expect(route("/plan", { picked: "command:plan" })).toEqual({
        kind: "command",
        entry: COMMAND_PLAN,
      });
      expect(
        route("/plan сделать зарядку", { picked: "command:plan" }),
      ).toEqual({
        kind: "command",
        entry: COMMAND_PLAN,
      });
    });

    it("ignores a pick that no longer matches the draft", () => {
      // The user edited the name after picking: the draft decides again.
      expect(route("/compact", { picked: "skill:plan" })).toEqual({
        kind: "command",
        entry: COMMAND_COMPACT,
      });
      expect(route("/gone", { picked: "skill:gone" })).toEqual({
        kind: "unknown",
        name: "gone",
      });
    });
  });

  describe("withheld skills", () => {
    it("flags a mention of a skill this deployment withholds", () => {
      expect(
        route("Пожалуйста, используй /gap-analysis для этих требований", {
          deniedSkills: ["gap-analysis"],
        }),
      ).toEqual({ kind: "prompt", withheld: ["gap-analysis"] });
    });

    it("does not flag a path that merely looks like a name", () => {
      expect(
        route("смотри /usr/bin и /gap-analysis", {
          deniedSkills: ["gap-analysis"],
        }),
      ).toEqual({ kind: "prompt", withheld: ["gap-analysis"] });
      expect(
        route("смотри /usr/bin", { deniedSkills: ["gap-analysis"] }),
      ).toEqual({ kind: "prompt" });
    });

    it("does not flag a withheld name inside a command line", () => {
      // The leading token already decided the route; the rest is its argument.
      expect(
        route("/compact /gap-analysis", { deniedSkills: ["gap-analysis"] }),
      ).toEqual({ kind: "command", entry: COMMAND_COMPACT });
    });

    it("stays quiet while the deployment runs with slashes off", () => {
      expect(
        route("используй /gap-analysis", {
          enabled: false,
          deniedSkills: ["gap-analysis"],
        }),
      ).toEqual({ kind: "prompt" });
    });
  });
});
