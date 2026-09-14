/**
 * Bundle and packaging contract (SPEC §17, §25, §26).
 *
 * The live profile install (`dsh plugin --profile … add <tarball>` plus
 * `dsh --profile … --dump-config`) is the real integration gate, but it needs a
 * DSH CLI, which is not installed in this environment. This file covers what
 * can be checked offline and without a host: the Cordis composition row parses
 * with the same YAML loader DSH uses and names exactly this package, the
 * manifest publishes every artefact the runtime references, the licence and
 * upstream attribution survive packing, and the plugin's own cleanup path is
 * idempotent.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeAgent,
  createHarness,
  type Harness,
} from "./helpers/harness.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(packageRoot, path), "utf8")) as T;
}

async function readText(path: string): Promise<string> {
  return readFile(join(packageRoot, path), "utf8");
}

interface PatchRow {
  readonly id?: string;
  readonly name?: string;
  readonly group?: boolean;
  readonly isolate?: unknown;
  readonly config?: unknown;
}

interface Manifest {
  readonly name: string;
  readonly description: string;
  readonly license: string;
  readonly engines: { readonly node: string };
  readonly files: readonly string[];
  readonly exports: Record<string, unknown>;
  readonly scripts: Record<string, string>;
  readonly keywords: readonly string[];
  readonly dependencies: Record<string, string>;
  readonly peerDependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly dsh: { readonly bundle: { readonly patch: string } };
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("bundle composition (SPEC §17)", () => {
  it("declares one canonical insert row naming the published package", async () => {
    const manifest = await readJson<Manifest>("package.json");
    const patch = await readText("cordis.patch.yml");

    const document = parseYaml(patch) as { insert?: PatchRow[] }[];
    expect(Array.isArray(document)).toBe(true);
    expect(document).toHaveLength(1);

    const rows = document[0]?.insert ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? {};

    // `id` is the runtime identity (and the client-bundle URL segment); `name`
    // is the exact npm name the host resolves. Either drifting is a breaking
    // migration for every profile patch that targets the row.
    expect(row.id).toBe("dsh-openviking-memory");
    expect(row.name).toBe(manifest.name);
    expect(manifest.name).toBe("@yadsh/dsh-openviking-memory");

    // Upstream wrapped the same plugin in a `cordis-plugin-group` row with
    // `isolate`; this repository's canonical shape is a single flat insert.
    expect(row.group).toBeUndefined();
    expect(row.isolate).toBeUndefined();
    expect(row.config).toBeUndefined();
    expect(Object.keys(row).sort()).toEqual(["id", "name"]);
  });

  it("points dsh.bundle.patch at the file that is shipped", async () => {
    const manifest = await readJson<Manifest>("package.json");

    expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
    expect(manifest.files).toContain("cordis.patch.yml");
    expect(manifest.exports["./package.json"]).toBe("./package.json");
  });
});

describe("package hygiene (SPEC §25)", () => {
  it("publishes every artefact the runtime references and no documentation", async () => {
    const manifest = await readJson<Manifest>("package.json");

    for (const entry of [
      "lib",
      "skills",
      "cordis.patch.yml",
      "compatibility.json",
      "README.md",
      "LICENSE",
    ]) {
      expect(manifest.files).toContain(entry);
    }
    // SPEC.md, UPSTREAM.md, docs/** and CHANGELOG.md stay in the repository:
    // the package-hygiene gate keeps documentation out of the tarball.
    for (const forbidden of [
      "SPEC.md",
      "UPSTREAM.md",
      "ROADMAP.md",
      "CHANGELOG.md",
      "docs",
    ]) {
      expect(manifest.files).not.toContain(forbidden);
    }
    expect(manifest.files.some((entry) => entry.startsWith("docs/"))).toBe(
      false,
    );
  });

  it("treats DSH runtime packages as peers and logs through the shared plugin log", async () => {
    const manifest = await readJson<Manifest>("package.json");

    for (const name of Object.keys(manifest.dependencies)) {
      expect(
        name.startsWith("@deepseek-ai/"),
        `${name} must not be a runtime dependency`,
      ).toBe(false);
    }
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(
        manifest.devDependencies[name],
        `${name} needs a development copy`,
      ).toBeDefined();
    }
    expect(manifest.dependencies["@yadsh/dsh-plugin-log"]).toBe("workspace:^");
    expect(manifest.scripts["verify:package"]).toBeDefined();
    expect(manifest.scripts.prepack).toBeDefined();
  });

  it("keeps discoverability metadata and its declared compatibility in sync", async () => {
    const manifest = await readJson<Manifest>("package.json");
    const compatibility = await readJson<{
      node: string;
      deepseekHarness: { range: string; testedReleases: string[] };
    }>("compatibility.json");

    for (const keyword of [
      "deepseek-harness",
      "dsh",
      "dsh-plugin",
      "cordis",
      "openviking",
      "memory",
    ]) {
      expect(manifest.keywords).toContain(keyword);
    }
    expect(manifest.description).toMatch(/deepseek harness/i);
    expect(compatibility.node).toBe(manifest.engines.node);
    expect(compatibility.deepseekHarness.range).toBe(">=0.1.5-rc.2 <0.2.0");
    expect(compatibility.deepseekHarness.testedReleases).toEqual([
      "0.1.5-rc.2",
    ]);
  });
});

describe("licence and upstream attribution (SPEC §4)", () => {
  it("ships the Apache-2.0 text rather than the repository's MIT licence", async () => {
    const manifest = await readJson<Manifest>("package.json");
    const license = await readText("LICENSE");
    const rootLicense = await readFile(
      fileURLToPath(new URL("../../../LICENSE", import.meta.url)),
      "utf8",
    );

    expect(manifest.license).toBe("Apache-2.0");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).not.toBe(rootLicense);
  });

  it("records the pinned upstream revision and keeps the attribution in the README", async () => {
    const upstream = await readText("UPSTREAM.md");
    const readme = await readText("README.md");

    expect(upstream).toContain("https://github.com/volcengine/OpenViking");
    expect(upstream).toContain("@openviking/dsh-memory-plugin");
    expect(upstream).toContain("688f78e923d2269d96c27096fe2dad10156ebdb8");
    expect(upstream).toContain("0.3.2");
    expect(upstream).toContain("not an official OpenViking distribution");

    // The README is the published artefact, so it has to carry the notice even
    // though UPSTREAM.md itself stays in the repository.
    expect(readme).toContain(
      "not maintained or endorsed by the OpenViking project",
    );
    expect(readme).toContain("https://github.com/volcengine/OpenViking");
    expect(readme).toContain("Apache License 2.0");
    // Running both the official plugin and this fork is unsupported.
    expect(readme).toMatch(/Remove or disable the official/iu);
  });

  it("keeps the changed-file notice on every module ported from upstream", async () => {
    const ported = [
      "src/client.ts",
      "src/servers/mcp-proxy.ts",
      ...(await readdir(join(packageRoot, "src/openviking")))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `src/openviking/${name}`),
    ];

    expect(ported.length).toBeGreaterThan(10);
    for (const path of ported) {
      const source = await readText(path);
      expect(source, path).toContain(
        "Derived from OpenViking's @openviking/dsh-memory-plugin.",
      );
      expect(source, path).toContain(
        "Licensed under the Apache License, Version 2.0.",
      );
    }
  });

  it("ships the vendored skill with its front matter intact", async () => {
    const skill = await readText(
      join("skills", "openviking-memory", "SKILL.md"),
    );

    expect(skill.split("\n")[0]).toBe("---");
    expect(skill).toMatch(/^---\nname: openviking-memory\n/);
    expect(skill).toContain("description:");
    expect(skill).toContain("viking://");
    expect(skill).not.toContain("\r\n");
  });
});

describe("plugin lifecycle cleanup (SPEC §3.4)", () => {
  it("disposes idempotently and leaves no tracked session behind", async () => {
    harness = await createHarness({ autoInject: false, syncTurns: true });
    const fake = createFakeAgent({ sessionId: "dsh-cleanup" });

    await harness.plugin.runtime.initialize(fake.agent);
    expect(harness.plugin.runtime.liveSessions).toBe(1);

    const disposers = harness.disposers;
    expect(disposers.length).toBeGreaterThanOrEqual(2);
    for (const entry of disposers) await entry.dispose();
    // A second pass must be safe: reload or removal calls it again.
    for (const entry of disposers) await entry.dispose();

    expect(harness.plugin.runtime.liveSessions).toBe(0);
    // The drainer interval is gone, so nothing keeps the process alive.
    expect(harness.plugin.runtime.startDrainer()).toBeDefined();
    harness.plugin.runtime.stopDrainer();
    expect(harness.plugin.runtime.startDrainer()).toBeDefined();
  });
});
