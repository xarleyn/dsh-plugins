import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { describe, expect, it } from "vitest";
import generatePlugin from "../src/index";

function createTestTree() {
  const tree = createTreeWithEmptyWorkspace();
  tree.write("LICENSE", "MIT License\n");
  tree.write(
    "plugins/dsh-kv-persist/src/logging/dsh-home.ts",
    "export function resolveDshHome(): string { return 'test'; }\n",
  );
  tree.write(
    "plugins/dsh-kv-persist/src/logging/index.ts",
    "export { getPluginLogger } from './plugin-logger.js';\n",
  );
  tree.write(
    "plugins/dsh-kv-persist/src/logging/plugin-logger.ts",
    "export function getPluginLogger(): object { return {}; }\n",
  );
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
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(packageJson.dependencies.pino).toBe("^10.3.1");
    expect(packageJson.scripts).toMatchObject({
      build: "tsc",
      lint: "eslint src tests",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    });
    expect(packageJson.dependencies).not.toHaveProperty(
      "@yadsh/dsh-plugin-kit",
    );
    expect(tree.exists(`${root}/src/index.ts`)).toBe(true);
    expect(tree.exists(`${root}/src/logger.ts`)).toBe(false);
    expect(tree.exists(`${root}/src/logging/dsh-home.ts`)).toBe(true);
    expect(tree.exists(`${root}/src/logging/index.ts`)).toBe(true);
    expect(tree.exists(`${root}/src/logging/plugin-logger.ts`)).toBe(true);
    expect(tree.read(`${root}/LICENSE`, "utf8")).toBe("MIT License\n");
    expect(tree.exists(`${root}/src/client.ts`)).toBe(false);
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
      withTests: false,
    });

    const root = "plugins/dsh-client-only";
    const packageJson = JSON.parse(
      tree.read(`${root}/package.json`, "utf8") ?? "{}",
    );

    expect(packageJson.name).toBe("@yadsh/dsh-client-only");
    expect(packageJson.exports["./client"]).toEqual({
      types: "./lib/client.d.ts",
      default: "./lib/client.js",
    });
    expect(packageJson.dsh.client).toEqual({ platform: "web" });
    expect(packageJson.scripts.test).toBeUndefined();
    expect(tree.exists(`${root}/src/client.ts`)).toBe(true);
    expect(tree.exists(`${root}/tests/index.test.ts`)).toBe(false);
  });

  it("rejects duplicate plugin directories", async () => {
    const tree = createTestTree();
    tree.write("plugins/dsh-existing/package.json", "{}");

    await expect(
      generatePlugin(tree, { name: "existing" }),
    ).rejects.toThrow("already exists");
  });

  it("does not invent a UI contract when ui-kit is absent", async () => {
    const tree = createTestTree();

    await expect(
      generatePlugin(tree, { name: "ui-plugin", withUi: true }),
    ).rejects.toThrow("requires packages/ui-kit");
  });
});
