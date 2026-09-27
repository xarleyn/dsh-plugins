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

import type {
  PresetComposition,
  PresetRosterFace,
} from "../src/host/preset-reader.js";
import { PresetPersonaEditor } from "../src/host/service.js";

/** A composition with a persona row this editor reads. */
const OWNED = [
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    prefix: A shipped-looking persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

const INHERITED = "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'\n";

/** A roster over the compositions a test declares, in the roster's own order. */
function rosterOf(
  entries: Record<string, { content: string | null; broken?: string }>,
  defaultId = "",
): PresetRosterFace {
  const rows = () =>
    Object.entries(entries).map(([id, entry]) => ({
      id,
      name: `preset ${id}`,
      ...(entry.broken === undefined ? {} : { broken: entry.broken }),
    }));
  const resolve = async (id?: string) => {
    const key = id ?? defaultId;
    const entry = entries[key];
    if (entry === undefined) throw new Error("agent-preset/not-found");
    return {
      id: key,
      name: `preset ${key}`,
      ...(entry.broken === undefined ? {} : { broken: entry.broken }),
    };
  };
  return {
    list: async () => rows(),
    resolve,
    readDocument: async (agentPreset: string): Promise<PresetComposition> => {
      const entry = entries[agentPreset];
      if (entry === undefined || entry.content === null) {
        throw new Error("agent-preset/not-found");
      }
      return {
        agentPreset,
        content: entry.content,
        name: `preset ${agentPreset}`,
      };
    },
    defaultId,
  };
}

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
          demo: { content: OWNED },
          plain: { content: INHERITED },
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
    const service = build(rosterOf({ demo: { content: OWNED } }));
    const document = await service.readPersona("demo");
    expect(document.editable).toBe(true);
    expect(document.hasRow).toBe(true);
    expect(document.persona.prefix).toBe("A shipped-looking persona.");
    expect(document.source).toBe(OWNED);
    expect(document.rowCount).toBe(2);
  });

  it("reads the section orders the prompt service publishes", async () => {
    const roster = rosterOf({ demo: { content: OWNED } });
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

  it("reports a preset the roster calls broken, with the roster's reason", async () => {
    const service = build(
      rosterOf({ demo: { content: OWNED, broken: "a row names nothing" } }),
    );
    const document = await service.readPersona("demo");
    expect(document.broken).toBe("a row names nothing");
    expect(document.editable).toBe(false);
    expect(document.persona.prefix).toBe("A shipped-looking persona.");
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
  });

  it("publishes no write operation", () => {
    const service = build(rosterOf({})) as unknown as Record<string, unknown>;
    for (const write of ["savePersona", "resetPersona", "copyPreset"]) {
      expect(service[write]).toBeUndefined();
    }
  });
});
