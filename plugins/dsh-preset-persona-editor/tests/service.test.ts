/**
 * The host service: the Remote surface a client drives, wired to a real roster
 * shape and a real composition.
 *
 * The cordis context is a bare one — `provide` for the two services the plugin
 * injects — so what is under test is the plugin's own wiring, not a deployment:
 * the wire methods exist, they answer with the editor's DTOs, and every refusal
 * arrives as a typed Remote failure the host's reason is logged beside.
 */

import { Context } from "@deepseek-ai/cordis";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it, vi } from "vitest";

import type { PresetRosterFace } from "../src/host/preset-reader.js";
import { PresetPersonaEditor } from "../src/host/service.js";
import {
  INHERITED_PRESET,
  OWNED_PRESET,
  rosterOf,
} from "./preset-roster.helpers.js";

function contextOf(
  roster: PresetRosterFace,
  orders: (name: string) => number = () => 0,
): Context {
  const ctx = new Context();
  ctx.provide("agentPresets", roster);
  ctx.provide("systemPrompt", { getSectionOrder: orders });
  return ctx;
}

function build(roster: PresetRosterFace): PresetPersonaEditor {
  return new PresetPersonaEditor(contextOf(roster), {
    logger: silentPluginLogger(),
  });
}

describe("PresetPersonaEditor", () => {
  it("registers itself under the wire service key", () => {
    const ctx = contextOf(rosterOf({}));
    new PresetPersonaEditor(ctx, { logger: silentPluginLogger() });
    expect(ctx.get("presetPersonaEditor")).toBeDefined();
  });

  it("lists the roster with each preset's persona state", async () => {
    const service = build(
      rosterOf(
        {
          demo: { content: OWNED_PRESET },
          plain: { content: INHERITED_PRESET },
          retired: { content: null },
        },
        "plain",
      ),
    );
    const catalog = await service.listPersonas();
    expect(catalog.presets.map((row) => row.id)).toEqual([
      "demo",
      "plain",
      "retired",
    ]);
    expect(catalog.presets.map((row) => row.persona)).toEqual([
      "local",
      "none",
      "unreadable",
    ]);
    expect(catalog.presets.map((row) => row.broken)).toEqual(["", "", ""]);
    expect(catalog.presets[1]?.isDefault).toBe(true);
  });

  it("reads one preset and keeps the composition the registry rendered", async () => {
    const service = build(rosterOf({ demo: { content: OWNED_PRESET } }));
    const document = await service.readPersona("demo");
    expect(document.readError).toBe("");
    expect(document.hasRow).toBe(true);
    expect(document.persona.prefix).toBe("You are the shipped demo persona.");
    expect(document.source).toBe(OWNED_PRESET);
    expect(document.rowCount).toBe(2);
  });

  it("reads the section orders the prompt service publishes", async () => {
    const roster = rosterOf({ demo: { content: OWNED_PRESET } });
    const service = new PresetPersonaEditor(
      contextOf(roster, (name) =>
        name === "DEPLOYMENT_PERSONA_PREFIX" ? 0 : 10200,
      ),
      { logger: silentPluginLogger() },
    );
    const document = await service.readPersona("demo");
    expect(document.prefixOrder).toBe(0);
    expect(document.suffixOrder).toBe(10200);
  });

  it("reads a broken preset's composition and carries the roster's reason", async () => {
    const service = build(
      rosterOf({
        demo: { content: OWNED_PRESET, broken: "a row names nothing" },
      }),
    );
    const document = await service.readPersona("demo");
    expect(document.broken).toBe("a row names nothing");
    // Being unable to compose a session is not being unreadable: the registry
    // renders the declarations of a preset that failed to activate.
    expect(document.readError).toBe("");
    expect(document.persona.prefix).toBe("You are the shipped demo persona.");
  });

  it("answers an unknown preset with the editor's not-found code", async () => {
    const service = build(rosterOf({}));
    await expect(service.readPersona("ghost")).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
  });

  it("logs the host's own reason beside the not-found it answers with", async () => {
    const warn = vi.fn();
    const service = new PresetPersonaEditor(contextOf(rosterOf({})), {
      logger: { ...silentPluginLogger(), warn },
    });
    await expect(service.readPersona("ghost")).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
    expect(warn).toHaveBeenCalledWith(
      "preset-persona.read-refused",
      expect.objectContaining({ agentPreset: "ghost" }),
    );
    expect(JSON.stringify(warn.mock.calls[0])).toContain("not in the roster");
    expect(JSON.stringify(warn.mock.calls[0])).toContain(
      "Unknown agent preset: ghost",
    );
  });

  it("logs the registry's reason for a composition it will not render", async () => {
    const warn = vi.fn();
    const service = new PresetPersonaEditor(
      contextOf(rosterOf({ retired: { content: null } })),
      { logger: { ...silentPluginLogger(), warn } },
    );
    const document = await service.readPersona("retired");
    expect(document.persona.prefix).toBe("");
    expect(document.readError).toContain("Unknown agent preset: retired");
    expect(warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      expect.objectContaining({
        agentPreset: "retired",
        reason: expect.stringContaining("Unknown agent preset: retired"),
      }),
    );
  });

  it("reads a host without readDocument as unreadable presets, not as a failed call", async () => {
    const warn = vi.fn();
    const service = new PresetPersonaEditor(
      contextOf(
        rosterOf({ demo: { content: OWNED_PRESET } }, "demo", {
          withoutReadDocument: true,
        }),
      ),
      { logger: { ...silentPluginLogger(), warn } },
    );
    const catalog = await service.listPersonas();
    expect(catalog.presets[0]?.persona).toBe("unreadable");
    expect(catalog.presets[0]?.broken).toBe("");
    const document = await service.readPersona("demo");
    expect(document.readError).toMatch(/does not answer readDocument/u);
    expect(warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      expect.objectContaining({ agentPreset: "demo" }),
    );
  });

  it("says what a readDocument that answers no composition refused", async () => {
    const service = build(
      rosterOf({ demo: { content: OWNED_PRESET } }, "demo", {
        answerNothing: true,
      }),
    );
    const document = await service.readPersona("demo");
    expect(document.persona.prefix).toBe("");
    expect(document.source).toBe("");
    // The page promises the host's own words for a refusal. An answer that is
    // not a composition has no words, so the card gets this page's rather than
    // the TypeError that reading `.content` off it would throw.
    expect(document.readError).toMatch(/without a composition to read/u);
    expect(document.readError).not.toMatch(/Cannot read properties/u);
  });

  it("publishes no write operation", () => {
    const service = build(rosterOf({})) as unknown as Record<string, unknown>;
    for (const write of ["savePersona", "resetPersona", "copyPreset"]) {
      expect(service[write]).toBeUndefined();
    }
  });
});
