/**
 * The key the Plugins page joins for this bundle's row.
 *
 * `plugins.row.config` seats a row's configuration under
 * `<package name>#<row id>`, and the page finds that row through this bundle's
 * own metadata: the package name in `package.json`, the row id in
 * `cordis.patch.yml`. A key that drifts from the pair says nothing when it
 * fails — the row simply never gains its configure control, and the card never
 * reaches the page — so the pair is measured here against the two files rather
 * than against itself.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  QA_SURFACE_ROW_CONFIG_KEY,
  QA_SURFACE_SETTINGS_NAMESPACE,
} from "../../src/shared/settings.js";

const packageRoot = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("package.json", packageRoot), "utf8"),
) as { name: string };
const patch = readFileSync(
  new URL("cordis.patch.yml", packageRoot),
  "utf8",
) as string;

/** The profile entry this bundle declares, which is the row the page lists. */
const rowId = /-\s+id:\s*(\S+)/u.exec(patch)?.[1] ?? "";

describe("settings card seat key", () => {
  it("is the package name joined to the row id this bundle declares", () => {
    expect(rowId).not.toBe("");
    expect(QA_SURFACE_ROW_CONFIG_KEY).toBe(`${manifest.name}#${rowId}`);
  });

  it("keys the seat by the id the settings namespace already is", () => {
    // The Host serves the volatile Config of a profile entry under that entry's
    // id, so this equality is the whole reason a value saved before the seat
    // move still reads back after it.
    expect(rowId).toBe(QA_SURFACE_SETTINGS_NAMESPACE);
  });
});
