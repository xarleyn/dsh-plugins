/**
 * Manifest-level contract of the scaffold. These assertions cover what a build
 * cannot observe — publication metadata, the documentation a consumer reads,
 * and the option axes. Whether the declared outputs actually exist is proved by
 * `matrix.test.ts`, which builds, loads and packs the generated package.
 */

import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { describe, expect, it } from "vitest";

import generatePlugin, { type Schema } from "../src/index";

interface Manifest {
  name: string;
  version: string;
  license: string;
  type: string;
  main: string;
  types: string;
  exports: Record<string, unknown>;
  files: string[];
  dsh: Record<string, unknown>;
  engines: Record<string, string>;
  keywords: string[];
  repository: Record<string, string>;
  homepage: string;
  bugs: Record<string, string>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  publishConfig: Record<string, string>;
  scripts: Record<string, string>;
}

function createTestTree() {
  const tree = createTreeWithEmptyWorkspace();
  tree.write("LICENSE", "MIT License\n");
  return tree;
}

async function scaffold(options: Schema, root = "plugins/dsh-example-plugin") {
  const tree = createTestTree();
  await generatePlugin(tree, options);
  const manifest = JSON.parse(
    tree.read(`${root}/package.json`, "utf8") ?? "{}",
  ) as Manifest;
  const read = (file: string) => tree.read(`${root}/${file}`, "utf8") ?? "";
  return { tree, manifest, root, read };
}

describe("dsh-plugin generator", () => {
  it("publishes the canonical package identity", async () => {
    const { manifest, root, read } = await scaffold({
      name: "example-plugin",
      description: "Example plugin",
    });

    expect(manifest.name).toBe("@yadsh/dsh-example-plugin");
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.type).toBe("module");
    expect(manifest.engines.node).toBe("^22.19.0 || >=24.0.0");
    expect(manifest.files).toEqual([
      "lib",
      "cordis.patch.yml",
      "compatibility.json",
      "README.md",
      "LICENSE",
    ]);
    expect(manifest.dsh).toEqual({
      bundle: { patch: "./cordis.patch.yml" },
    });
    expect(manifest.keywords).toEqual([
      "deepseek",
      "deepseek-harness",
      "dsh",
      "dsh-plugin",
      "cordis",
      "dsh-example-plugin",
    ]);
    expect(manifest.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/xarleyn/dsh-plugins.git",
      directory: root,
    });
    expect(manifest.homepage).toBe(
      `https://github.com/xarleyn/dsh-plugins/tree/main/${root}#readme`,
    );
    expect(manifest.bugs).toEqual({
      url: "https://github.com/xarleyn/dsh-plugins/issues",
    });
    expect(manifest.dependencies["@yadsh/dsh-plugin-log"]).toBe("workspace:^");
    expect(read("LICENSE")).toBe("MIT License\n");
    expect(JSON.parse(read("compatibility.json"))).toMatchObject({
      deepseekHarness: {
        range: ">=0.1.7-rc.2 <0.2.0",
        testedReleases: ["0.1.7-rc.2"],
      },
      node: "^22.19.0 || >=24.0.0",
    });
  });

  it("names the plugin identically in the manifest and the bundle patch", async () => {
    const { manifest, read } = await scaffold({ name: "example-plugin" });

    expect(read("cordis.patch.yml")).toContain("id: dsh-example-plugin");
    // formatFiles (prettier) re-quotes the YAML scalar; accept either style.
    expect(read("cordis.patch.yml")).toMatch(
      /name: ['"]@yadsh\/dsh-example-plugin['"]/,
    );
    expect(manifest.main.startsWith("./lib/")).toBe(true);
    expect(Object.keys(manifest.exports)).toEqual([".", "./package.json"]);
  });

  it("keeps the host entrypoint a Cordis plugin", async () => {
    const { read } = await scaffold({ name: "example-plugin" });
    const entry = read("src/index.ts");

    expect(entry).toMatch(/export const name = ['"]dsh-example-plugin['"]/u);
    expect(entry).toMatch(/export const inject/u);
    expect(entry).toMatch(/export function apply\(\s*ctx: Context/u);
    expect(entry).toMatch(/from ['"]@yadsh\/dsh-plugin-log['"]/u);
  });

  it("separates the pinned dev copy of Cordis from the published peer range", async () => {
    const { manifest } = await scaffold({ name: "example-plugin" });

    expect(manifest.peerDependencies["@deepseek-ai/cordis"]).toBe(
      "catalog:dsh",
    );
    expect(manifest.devDependencies["@deepseek-ai/cordis"]).toBe(
      "catalog:dsh-dev",
    );
  });

  it("lets tsc own the build and keeps the typecheck run emit-free", async () => {
    const { read } = await scaffold({ name: "example-plugin" });
    const typecheck = JSON.parse(read("tsconfig.json")) as {
      extends: string;
      compilerOptions: { noEmit?: boolean };
    };
    const build = JSON.parse(read("tsconfig.build.json")) as {
      extends: string;
      compilerOptions: { noEmit?: boolean; outDir?: string; rootDir?: string };
    };

    expect(typecheck.extends).toBe("@yadsh/dsh-config/tsconfig/node");
    expect(typecheck.compilerOptions.noEmit).toBe(true);
    expect(build.extends).toBe("./tsconfig.json");
    expect(build.compilerOptions.noEmit).toBe(false);
    expect(build.compilerOptions).toMatchObject({
      rootDir: "src",
      outDir: "lib",
    });
  });

  it("declares a client surface only when one is scaffolded", async () => {
    const plain = await scaffold({ name: "example-plugin" });
    expect(plain.manifest.dsh.client).toBeUndefined();
    expect(Object.keys(plain.manifest.exports)).not.toContain("./client");

    const { manifest, read } = await scaffold(
      { name: "example-plugin", client: true },
      "plugins/dsh-example-plugin",
    );
    expect(manifest.dsh).toMatchObject({ client: { platform: "web" } });
    expect(Object.keys(manifest.exports)).toContain("./client");
    expect(read("src/client/index.tsx")).toMatch(/export function apply/u);
    const bundler = read("tsdown.config.ts");
    expect(bundler).toContain("window.__ModuleLoader__.load(");
    expect(bundler).toContain("@yadsh/dsh-example-plugin");
    // The browser entrypoint ships as the tsdown bundle, never as tsc emit.
    expect(JSON.parse(read("tsconfig.build.json")).exclude).toContain(
      "src/client",
    );
  });

  it("toggles the test scaffolding with the withTests option", async () => {
    const withTests = await scaffold({ name: "example-plugin" });
    expect(withTests.manifest.scripts["test"]).toBe("vitest run");
    expect(
      withTests.tree.exists("plugins/dsh-example-plugin/tests/index.test.ts"),
    ).toBe(true);
    expect(
      withTests.tree.exists("plugins/dsh-example-plugin/vitest.config.ts"),
    ).toBe(true);

    const lean = await scaffold(
      { name: "example-plugin", withTests: false, scope: "@example" },
      "plugins/dsh-example-plugin",
    );
    expect(lean.manifest.scripts["test"]).toBeUndefined();
    expect(lean.manifest.name).toBe("@example/dsh-example-plugin");
    expect(
      lean.tree.exists("plugins/dsh-example-plugin/tests/index.test.ts"),
    ).toBe(false);
  });

  it("documents the install command the plugin manager actually accepts", async () => {
    const { read } = await scaffold({ name: "example-plugin" });
    const readme = read("README.md");

    // `dsh plugin add` rejects a call without --profile, so a README that
    // omits it documents a command that cannot work.
    expect(readme).toContain(
      "dsh plugin --profile <profile> add @yadsh/dsh-example-plugin",
    );
    expect(readme).toContain("--profile` is required");
    // SPEC.md is not published, so the README must link it in the repository.
    expect(readme).toContain(
      "https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-example-plugin/SPEC.md",
    );
    expect(read("SPEC.md")).toContain("## 3. Entrypoints");
  });

  it("rejects unusable scaffold requests", async () => {
    const duplicate = createTestTree();
    duplicate.write("plugins/dsh-existing/package.json", "{}");
    await expect(
      generatePlugin(duplicate, { name: "existing" }),
    ).rejects.toThrow("already exists");

    await expect(
      generatePlugin(createTestTree(), { name: "dotted.name" }),
    ).rejects.toThrow("kebab-case");

    await expect(
      generatePlugin(createTestTree(), { name: "ok", scope: "yadsh" }),
    ).rejects.toThrow("npm scope");

    await expect(
      generatePlugin(createTreeWithEmptyWorkspace(), { name: "ok" }),
    ).rejects.toThrow("Root LICENSE");
  });
});
