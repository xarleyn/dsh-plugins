import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { afterAll, describe, expect, it } from "vitest";
import generatePlugin from "../src/index";

function createTestTree() {
  const tree = createTreeWithEmptyWorkspace();
  tree.write("LICENSE", "MIT License\n");
  return tree;
}

describe("dsh-plugin generator", () => {
  it("creates a buildable package contract", async () => {
    const tree = createTestTree();

    await generatePlugin(tree, {
      name: "example-plugin",
      description: "Example plugin",
    });

    const root = "plugins/dsh-example-plugin";
    const packageJson = JSON.parse(
      tree.read(`${root}/package.json`, "utf8") ?? "{}",
    );

    expect(packageJson.name).toBe("@yadsh/dsh-example-plugin");
    expect(packageJson.version).toBe("0.0.0");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.types).toBe("./lib/index.d.ts");
    expect(packageJson.engines.node).toBe("^22.19.0 || >=24.0.0");
    expect(packageJson.files).toContain("compatibility.json");
    expect(packageJson.exports["./package.json"]).toBe("./package.json");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/xarleyn/dsh-plugins.git",
      directory: root,
    });
    expect(packageJson.homepage).toBe(
      `https://github.com/xarleyn/dsh-plugins/tree/main/${root}#readme`,
    );
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/xarleyn/dsh-plugins/issues",
    });
    expect(packageJson.keywords).toEqual([
      "deepseek",
      "deepseek-harness",
      "dsh",
      "dsh-plugin",
      "cordis",
      "dsh-example-plugin",
    ]);
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(packageJson.dependencies["@yadsh/dsh-plugin-log"]).toBe(
      "workspace:^",
    );
    expect(packageJson.devDependencies).not.toHaveProperty("tsdown");
    expect(packageJson.scripts).toMatchObject({
      build: "tsc -p tsconfig.build.json && tsdown",
      check:
        "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run verify",
      lint: "eslint src tests scripts",
      test: "vitest run",
      typecheck: "tsc --noEmit",
      verify: "pnpm run verify:package",
      prepack: "pnpm run build && pnpm run verify",
    });
    expect(packageJson.dependencies).not.toHaveProperty(
      "@yadsh/dsh-plugin-kit",
    );
    expect(packageJson.dependencies).not.toHaveProperty("@yadsh/dsh-ui-kit");
    expect(tree.exists(`${root}/src/index.ts`)).toBe(true);
    expect(tree.exists(`${root}/src/logger.ts`)).toBe(false);
    expect(tree.exists(`${root}/src/logging`)).toBe(false);
    expect(tree.read(`${root}/src/index.ts`, "utf8")).toMatch(
      /from ['"]@yadsh\/dsh-plugin-log['"]/,
    );
    expect(tree.read(`${root}/LICENSE`, "utf8")).toBe("MIT License\n");
    expect(
      JSON.parse(tree.read(`${root}/compatibility.json`, "utf8") ?? "{}"),
    ).toMatchObject({
      deepseekHarness: {
        range: ">=0.1.5-rc.2 <0.2.0",
        testedReleases: ["0.1.5-rc.2"],
      },
      node: "^22.19.0 || >=24.0.0",
    });
    expect(tree.read(`${root}/tsconfig.json`, "utf8")).toContain(
      "@yadsh/dsh-config/tsconfig/node",
    );
    expect(tree.exists(`${root}/tsconfig.build.json`)).toBe(true);
    expect(tree.exists(`${root}/scripts/verify-package.mjs`)).toBe(true);
    expect(packageJson.scripts["verify:package"]).toBe(
      "node scripts/verify-package.mjs",
    );
    expect(tree.exists(`${root}/src/client.ts`)).toBe(false);
    expect(tree.exists(`${root}/tsdown.config.ts`)).toBe(false);
    expect(tree.exists(`${root}/tests/index.test.ts`)).toBe(true);

    const patch = tree.read(`${root}/cordis.patch.yml`, "utf8") ?? "";
    expect(patch).toContain("id: dsh-example-plugin");
    // formatFiles (prettier) re-quotes the YAML scalar; accept either style.
    expect(patch).toMatch(/name: ['"]@yadsh\/dsh-example-plugin['"]/);
  });

  it("supports a client entrypoint and optional tests", async () => {
    const tree = createTestTree();

    await generatePlugin(tree, {
      name: "dsh-client-only",
      client: true,
      scope: "@example",
      withTests: false,
    });

    const root = "plugins/dsh-client-only";
    const packageJson = JSON.parse(
      tree.read(`${root}/package.json`, "utf8") ?? "{}",
    );

    expect(packageJson.name).toBe("@example/dsh-client-only");
    expect(packageJson.exports["./client"]).toEqual({
      types: "./lib/client.d.ts",
      default: "./lib/client.js",
    });
    expect(packageJson.dsh.client).toEqual({ platform: "web" });
    expect(packageJson.devDependencies.tsdown).toBe("catalog:tooling");
    expect(packageJson.scripts.build).toBe(
      "tsc -p tsconfig.build.json && tsdown",
    );
    expect(packageJson.scripts.lint).toBe(
      "eslint src scripts tsdown.config.ts",
    );
    expect(packageJson.scripts["verify:client"]).toBe(
      "node scripts/verify-client-bundle.mjs",
    );
    expect(packageJson.scripts.check).toBe(
      "pnpm run lint && pnpm run typecheck && pnpm run build && pnpm run verify",
    );
    expect(packageJson.scripts.verify).toBe(
      "pnpm run verify:package && pnpm run verify:client",
    );
    expect(packageJson.scripts.test).toBeUndefined();
    expect(tree.read(`${root}/tsconfig.json`, "utf8")).toContain(
      "@yadsh/dsh-config/tsconfig/client",
    );
    expect(tree.exists(`${root}/src/client/index.tsx`)).toBe(true);
    expect(tree.exists(`${root}/tests/index.test.ts`)).toBe(false);

    const clientSource =
      tree.read(`${root}/src/client/index.tsx`, "utf8") ?? "";
    expect(clientSource).toContain("export function apply(");
    expect(clientSource).not.toContain("initializeClient");

    const buildConfig = tree.read(`${root}/tsdown.config.ts`, "utf8") ?? "";
    expect(buildConfig).toContain(
      'window.__ModuleLoader__.load({ id: "@example/dsh-client-only"',
    );
    expect(buildConfig).not.toContain(
      'window.__ModuleLoader__.load({ id: "dsh-client-only"',
    );
    expect(buildConfig).toMatch(/format: \[['"]cjs['"]\]/);
    expect(buildConfig).toMatch(/entryFileNames: ['"]client\.js['"]/);

    const verifier =
      tree.read(`${root}/scripts/verify-client-bundle.mjs`, "utf8") ?? "";
    expect(verifier).toContain("JSON.stringify(packageJson.name)");
    expect(verifier).toContain("classic ModuleLoader script");
  });

  it("rejects duplicate plugin directories", async () => {
    const tree = createTestTree();
    tree.write("plugins/dsh-existing/package.json", "{}");

    await expect(generatePlugin(tree, { name: "existing" })).rejects.toThrow(
      "already exists",
    );
  });

  describe("generated verify-package.mjs", () => {
    const fixtures: string[] = [];

    afterAll(async () => {
      for (const directory of fixtures.splice(0)) {
        await rm(directory, { recursive: true, force: true });
      }
    });

    async function materializeGeneratedPlugin() {
      const tree = createTestTree();
      tree.write("LICENSE", "MIT License\n");
      await generatePlugin(tree, { name: "example-plugin" });

      const root = path.join("plugins", "dsh-example-plugin");
      const output = mkdtempSync(path.join(tmpdir(), "dsh-generated-"));
      fixtures.push(output);
      for (const file of [
        "package.json",
        "cordis.patch.yml",
        "README.md",
        "LICENSE",
        path.join("scripts", "verify-package.mjs"),
      ]) {
        const target = path.join(output, root, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, tree.read(path.join(root, file), "utf8") ?? "");
      }
      const lib = path.join(output, root, "lib");
      mkdirSync(lib, { recursive: true });
      writeFileSync(path.join(lib, "index.js"), "export {};\n");
      writeFileSync(path.join(lib, "index.d.ts"), "export {};\n");
      return path.join(output, root);
    }

    it("is free of control characters and keeps a real word boundary", async () => {
      const root = await materializeGeneratedPlugin();
      const verifier = readFileSync(
        path.join(root, "scripts", "verify-package.mjs"),
        "utf8",
      );
      // A backspace (U+0008) inside the emitted template literal would leave
      // the patch-id gate unable to match any cordis.patch.yml.
      // eslint-disable-next-line no-control-regex -- detecting control characters is the point
      expect(verifier).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u);
      expect(verifier).toContain("/id: dsh-example-plugin\\b/u");
    });

    it("parses and passes against the generated plugin tree", async () => {
      const root = await materializeGeneratedPlugin();
      const verifier = path.join(root, "scripts", "verify-package.mjs");
      execFileSync(process.execPath, ["--check", verifier]);
      const output = execFileSync(process.execPath, [verifier], {
        encoding: "utf8",
      });
      expect(output).toContain("verify-package: all gates passed");
    });
  });
});
