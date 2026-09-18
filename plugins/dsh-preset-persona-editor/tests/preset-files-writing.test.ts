/**
 * The file layer: reading a preset's persona state, the revision guard, and
 * every refusal that must leave the file exactly as it was.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the ones the file system gives: bytes on disk, modes, the byte-order
 * mark, and the fact that a refused write did not touch the file at all.
 */

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  readDocument,
  type PresetRosterFace,
} from "../src/host/preset-reader.js";
import { resetPersona } from "../src/host/preset-writer.js";
import { DEFAULT_LIMITS, type PersonaLimits } from "../src/host/validation.js";
import type { PersonaDraft } from "../src/types.js";
import {
  DRAFT,
  INHERITED_PRESET,
  OWNED_PRESET,
  preset,
  rosterOf,
  savePersona,
} from "./preset-files.helpers.js";

describe("writing presets", () => {
  const context = (
    roster: PresetRosterFace,
    limits: PersonaLimits = DEFAULT_LIMITS,
  ) => ({
    roster,
    limits,
  });

  it("writes the values and returns the new revision", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    const receipt = await savePersona(
      context(roster),
      "demo",
      DRAFT,
      before.revision,
    );
    expect(receipt.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(receipt.revision).not.toBe(before.revision);
    const after = await readDocument(roster, undefined, "demo");
    expect(after.persona).toEqual(DRAFT);
    expect(after.revision).toBe(receipt.revision);
    // The preset's other row survived byte-for-byte.
    expect(after.source).toContain(
      "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'",
    );
  });

  it("creates the row when the preset inherits its persona", async () => {
    const path = await preset(INHERITED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    expect(before.hasRow).toBe(false);
    await savePersona(context(roster), "demo", DRAFT, before.revision);
    const after = await readDocument(roster, undefined, "demo");
    expect(after.hasRow).toBe(true);
    expect(after.persona).toEqual(DRAFT);
    expect(after.source).toContain("- id: tool-shell");
  });

  it("removes the row on reset, and reset is idempotent", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    const receipt = await resetPersona(
      context(roster),
      "demo",
      before.revision,
    );
    const after = await readDocument(roster, undefined, "demo");
    expect(after.hasRow).toBe(false);
    expect(after.revision).toBe(receipt.revision);
    const again = await resetPersona(context(roster), "demo", receipt.revision);
    expect(again.revision).toBe(receipt.revision);
    expect((await readFile(path, "utf8")).includes("dsh-persona")).toBe(false);
  });

  it("rewriting the same values twice leaves the file unchanged", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    const first = await savePersona(
      context(roster),
      "demo",
      DRAFT,
      before.revision,
    );
    const bytes = await readFile(path);
    const second = await savePersona(
      context(roster),
      "demo",
      DRAFT,
      first.revision,
    );
    expect(second.revision).toBe(first.revision);
    expect((await readFile(path)).equals(bytes)).toBe(true);
  });

  it("refuses a shipped preset and leaves it untouched", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ shipped: { path, trust: "system" } });
    const bytes = await readFile(path);
    await expect(
      savePersona(context(roster), "shipped", DRAFT, ""),
    ).rejects.toMatchObject({ code: "preset-persona/read-only" });
    await expect(
      resetPersona(context(roster), "shipped", ""),
    ).rejects.toMatchObject({ code: "preset-persona/read-only" });
    expect((await readFile(path)).equals(bytes)).toBe(true);
  });

  it("refuses a file that changed since the read, and keeps the external edit", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    const external = `${OWNED_PRESET}\n# an outside editor was here\n`;
    await writeFile(path, external, "utf8");
    await expect(
      savePersona(context(roster), "demo", DRAFT, before.revision),
    ).rejects.toMatchObject({
      code: "preset-persona/conflict",
      details: { agentPreset: "demo", expectedRevision: before.revision },
    });
    expect(await readFile(path, "utf8")).toBe(external);
  });

  it("refuses a malformed composition without rewriting it", async () => {
    const broken = "- id: [unclosed\n";
    const path = await preset(broken);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    await expect(
      savePersona(context(roster), "demo", DRAFT, ""),
    ).rejects.toMatchObject({
      code: "preset-persona/invalid",
    });
    expect(await readFile(path, "utf8")).toBe(broken);
  });

  it("refuses a persona row whose matching key is an expression", async () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: kept",
      "    complete: !!js process.env.PERSONA_COMPLETE === '1'",
      "",
    ].join("\n");
    const path = await preset(text);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    expect(before.foreignKeys).toEqual(["complete"]);
    await expect(
      savePersona(context(roster), "demo", DRAFT, before.revision),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
    expect(await readFile(path, "utf8")).toBe(text);
  });

  it("refuses a complete persona with an empty prefix before touching the file", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await stat(path);
    await expect(
      savePersona(
        context(roster),
        "demo",
        { ...DRAFT, prefix: "   ", complete: true },
        "",
      ),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it("honours the deployment's refusal of complete personas", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    await expect(
      savePersona(
        context(roster, { ...DEFAULT_LIMITS, allowComplete: false }),
        "demo",
        {
          ...DRAFT,
          complete: true,
        },
        "",
      ),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
  });

  it("honours the byte ceiling", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    await expect(
      savePersona(
        context(roster, { ...DEFAULT_LIMITS, maxPersonaBytes: 8 }),
        "demo",
        DRAFT,
        "",
      ),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
  });

  it("refuses a preset the roster does not know", async () => {
    const roster = rosterOf({});
    await expect(
      savePersona(context(roster), "ghost", DRAFT, ""),
    ).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
  });

  it("writes a complete persona and reads the flags back", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const complete: PersonaDraft = {
      prefix: "You are the whole prompt.",
      suffix: "",
      complete: true,
      includeRuntimeContext: false,
    };
    const receipt = await savePersona(context(roster), "demo", complete, "");
    const after = await readDocument(roster, undefined, "demo");
    expect(after.persona).toEqual(complete);
    expect(after.revision).toBe(receipt.revision);
    expect(after.source).toContain("    complete: true");
  });

  it("keeps the byte-order mark and the file mode", async () => {
    const path = await preset(`\uFEFF${OWNED_PRESET}`);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    await savePersona(context(roster), "demo", DRAFT, before.revision);
    const bytes = await readFile(path);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8").startsWith("- id: persona")).toBe(
      true,
    );
  });

  it("keeps a CRLF file in CRLF", async () => {
    const path = await preset(OWNED_PRESET.replace(/\n/gu, "\r\n"));
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    await savePersona(context(roster), "demo", DRAFT, before.revision);
    const text = await readFile(path, "utf8");
    expect(text).toContain(
      "    prefix: |-\r\n      You are a careful reviewer.\r\n",
    );
    expect(text.replace(/\r\n/gu, "")).not.toContain("\r");
  });

  it("reports the revision of the bytes it wrote", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const receipt = await savePersona(context(roster), "demo", DRAFT, "");
    const digest = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    expect(receipt.revision).toBe(digest);
  });
});
