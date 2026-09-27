/**
 * The host service: the Remote surface a client drives, wired to a real roster
 * shape and a real file on disk.
 *
 * The cordis context is a bare one — `provide` for the two services the
 * plugin injects — so what is under test is the plugin's own wiring, not a
 * deployment: the wire methods exist, they answer with the editor's DTOs, and
 * every refusal arrives as a typed Remote failure the host's reason is logged
 * beside.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresetPersonaEditor } from "../src/host/service.js";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";

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

let root = "";
let ctx: Context;
let paths: Record<string, string>;

/** A roster over the presets a test wrote into the temporary root. */
function installRoster(
  entries: Record<string, "system" | "user">,
  defaultId = "",
): void {
  const resolve = async (id?: string) => {
    const key = id ?? "";
    const trust = entries[key];
    if (trust === undefined) throw new Error("agent-preset/not-found");
    return { id: key, trust, path: paths[key] ?? "", name: `preset ${key}` };
  };
  ctx.provide("agentPresets", {
    list: async () =>
      await Promise.all(
        Object.keys(entries).map(async (id) => await resolve(id)),
      ),
    resolve,
    authorable: Object.values(entries).includes("user"),
    defaultId,
    copy: async () => undefined,
  });
  ctx.provide("systemPrompt", {
    getSectionOrder: (name: string) =>
      name === "DEPLOYMENT_PERSONA_PREFIX" ? 0 : 10200,
  });
}

/** Write one composition into the temporary root. */
async function writePreset(id: string, text: string): Promise<void> {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "agent.cordis.yml");
  await writeFile(path, text, "utf8");
  paths[id] = path;
}

function build(): PresetPersonaEditor {
  return new PresetPersonaEditor(ctx, { logger: silentPluginLogger() });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "preset-persona-service-"));
  paths = {};
  ctx = new Context();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PresetPersonaEditor", () => {
  it("registers itself under the wire service key", () => {
    installRoster({});
    build();
    expect(ctx.get("presetPersonaEditor")).toBeDefined();
  });

  it("lists the roster with each preset's persona state", async () => {
    await writePreset("demo", OWNED);
    await writePreset(
      "plain",
      "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'\n",
    );
    installRoster({ demo: "user", plain: "user", shipped: "system" }, "plain");
    // A preset whose file is missing still has to appear, as unreadable.
    paths.shipped = join(root, "shipped", "agent.cordis.yml");
    const catalog = await build().listPersonas();
    expect(catalog.presets.map((row) => row.id)).toEqual([
      "demo",
      "plain",
      "shipped",
    ]);
    expect(catalog.presets.map((row) => row.persona)).toEqual([
      "local",
      "none",
      "unreadable",
    ]);
    expect(catalog.presets[1]?.isDefault).toBe(true);
  });

  it("reads one preset, with the deployment's section orders", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const document = await build().readPersona("demo");
    expect(document.editable).toBe(true);
    expect(document.hasRow).toBe(true);
    expect(document.persona.prefix).toBe("A shipped-looking persona.");
    expect(document.prefixOrder).toBe(0);
    expect(document.suffixOrder).toBe(10200);
    expect(document.source).toBe(OWNED);
    expect(document.path).toBe(paths.demo);
  });

  it("answers an unknown preset with the editor's not-found code", async () => {
    installRoster({});
    const service = build();
    await expect(service.readPersona("ghost")).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
  });

  it("logs the host's own reason beside the not-found it answers with", async () => {
    installRoster({});
    const info = vi.fn();
    const warn = vi.fn();
    const service = new PresetPersonaEditor(ctx, {
      logger: { ...silentPluginLogger(), info, warn },
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
    installRoster({});
    const service = build() as unknown as Record<string, unknown>;
    for (const write of ["savePersona", "resetPersona", "copyPreset"]) {
      expect(service[write]).toBeUndefined();
    }
  });
});
