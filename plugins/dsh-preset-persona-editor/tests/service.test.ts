/**
 * The host service: the Remote surface a client drives, wired to a real roster
 * shape and a real file on disk.
 *
 * The cordis context is a bare one — `provide` for the two services the
 * plugin injects — so what is under test is the plugin's own wiring, not a
 * deployment: the wire methods exist, they answer with the editor's DTOs, and
 * every refusal arrives as a typed Remote failure.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresetPersonaEditor } from "../src/host/service.js";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";
import type { PersonaDraft } from "../src/types.js";

/** A composition with a persona row this editor owns. */
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

const DRAFT: PersonaDraft = {
  prefix: "You are a careful reviewer.",
  suffix: "Answer briefly.",
  complete: false,
  includeRuntimeContext: true,
};

let root = "";
let ctx: Context;
let copies: { from: string; id: string; name: string | undefined }[];
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
    copy: async (from: string, id: string, name?: string) => {
      copies.push({ from, id, name });
      // A real copy lands in the user root, so the new id resolves as `user`.
      entries[id] = "user";
      paths[id] = paths[from] ?? "";
      return paths[id];
    },
  });
  ctx.provide("systemPrompt", {
    getSectionOrder: (name: string) =>
      name === "DEPLOYMENT_PERSONA_PREFIX" ? 0 : 10200,
  });
}

/** Write one composition into the temporary root. */
async function writePreset(id: string, text: string): Promise<void> {
  const directory = join(root, id);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "agent.cordis.yml");
  await writeFile(path, text, "utf8");
  paths[id] = path;
}

function build(): PresetPersonaEditor {
  return new PresetPersonaEditor(ctx, {}, { logger: silentPluginLogger() });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "preset-persona-service-"));
  copies = [];
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
    const service = build();
    const catalog = await service.listPersonas();
    expect(catalog.authorable).toBe(true);
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
    expect(catalog.presets[0]?.revision).toMatch(/^[0-9a-f]{64}$/u);
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

  it("saves through the revision check and reports the new revision", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const service = build();
    const before = await service.readPersona("demo");
    const receipt = await service.savePersona("demo", DRAFT, before.revision);
    expect(receipt.revision).not.toBe(before.revision);
    const text = await readFile(paths.demo ?? "", "utf8");
    expect(text).toContain("    prefix: You are a careful reviewer.");
    expect(text).toContain("    suffix: Answer briefly.");
    expect(text).toContain("- id: tool-shell");
    const after = await service.readPersona("demo");
    expect(after.persona).toEqual(DRAFT);
    expect(after.revision).toBe(receipt.revision);
  });

  it("resets the persona row", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const service = build();
    const before = await service.readPersona("demo");
    const receipt = await service.resetPersona("demo", before.revision);
    const after = await service.readPersona("demo");
    expect(after.hasRow).toBe(false);
    expect(after.revision).toBe(receipt.revision);
  });

  it("copies a shipped preset and opens the copy", async () => {
    await writePreset("standard", OWNED);
    installRoster({ standard: "system" });
    const document = await build().copyPreset(
      "standard",
      "standard-copy",
      "My copy",
    );
    expect(copies).toEqual([
      { from: "standard", id: "standard-copy", name: "My copy" },
    ]);
    expect(document.id).toBe("standard-copy");
    expect(document.trust).toBe("user");
  });

  it("refuses a shipped preset with the read-only code", async () => {
    await writePreset("standard", OWNED);
    installRoster({ standard: "system" });
    const service = build();
    await expect(
      service.savePersona("standard", DRAFT, ""),
    ).rejects.toMatchObject({
      code: "preset-persona/read-only",
    });
    await expect(service.resetPersona("standard", "")).rejects.toMatchObject({
      code: "preset-persona/read-only",
    });
    expect(await readFile(paths.standard ?? "", "utf8")).toBe(OWNED);
  });

  it("answers a stale revision with the conflict code and both revisions", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const service = build();
    const before = await service.readPersona("demo");
    await writeFile(paths.demo ?? "", `${OWNED}\n# edited by hand\n`, "utf8");
    await expect(
      service.savePersona("demo", DRAFT, before.revision),
    ).rejects.toMatchObject({
      code: "preset-persona/conflict",
      details: { agentPreset: "demo", expectedRevision: before.revision },
    });
  });

  it("refuses malformed values before it reads the file at all", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const service = build();
    const spy = vi.fn();
    const read = await service.readPersona("demo");
    expect(read.revision).toBeTruthy();
    await expect(
      service.savePersona("demo", { ...DRAFT, complete: true, prefix: "" }, ""),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an unknown preset with the editor's not-found code", async () => {
    installRoster({});
    const service = build();
    await expect(service.readPersona("ghost")).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
    await expect(service.savePersona("ghost", DRAFT, "")).rejects.toMatchObject(
      {
        code: "preset-persona/not-found",
      },
    );
  });

  it("honours the deployment's configuration", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const service = new PresetPersonaEditor(
      ctx,
      { allowComplete: false, maxPersonaBytes: 16 },
      { logger: silentPluginLogger() },
    );
    await expect(
      service.savePersona("demo", { ...DRAFT, complete: true }, ""),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
    await expect(service.savePersona("demo", DRAFT, "")).rejects.toMatchObject({
      code: "preset-persona/invalid",
    });
  });

  it("logs what it wrote without logging the persona text", async () => {
    await writePreset("demo", OWNED);
    installRoster({ demo: "user" });
    const info = vi.fn();
    const logger = { ...silentPluginLogger(), info };
    const service = new PresetPersonaEditor(ctx, {}, { logger });
    await service.savePersona("demo", DRAFT, "");
    const [event, fields] = info.mock.calls[0] ?? [];
    expect(event).toBe("preset-persona.saved");
    expect(fields).toMatchObject({ agentPreset: "demo", complete: false });
    expect(JSON.stringify(fields)).not.toContain("careful reviewer");
  });
});
