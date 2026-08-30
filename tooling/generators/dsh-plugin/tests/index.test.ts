import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { describe, expect, it } from "vitest";
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
    expect(packageJson.dependencies["@yadsh/dsh-plugin-log"]).toBe(
      "workspace:^",
    );
    expect(packageJson.devDependencies).not.toHaveProperty("tsdown");
    expect(packageJson.scripts).toMatchObject({
      build: "tsc",
      check:
        "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build",
      lint: "eslint src tests",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    });
    expect(packageJson.dependencies).not.toHaveProperty(
      "@yadsh/dsh-plugin-kit",
    );
    expect(tree.exists(`${root}/src/index.ts`)).toBe(true);
    expect(tree.exists(`${root}/src/logger.ts`)).toBe(false);
    expect(tree.exists(`${root}/src/logging`)).toBe(false);
    expect(tree.read(`${root}/src/index.ts`, "utf8")).toMatch(
      /from ['"]@yadsh\/dsh-plugin-log['"]/,
    );
    expect(tree.read(`${root}/LICENSE`, "utf8")).toBe("MIT License\n");
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
    expect(packageJson.scripts.build).toBe("tsc && tsdown");
    expect(packageJson.scripts.lint).toBe(
      "eslint src scripts tsdown.config.ts",
    );
    expect(packageJson.scripts["verify:client"]).toBe(
      "node scripts/verify-client-bundle.mjs",
    );
    expect(packageJson.scripts.check).toBe(
      "pnpm run lint && pnpm run typecheck && pnpm run build && pnpm run verify:client",
    );
    expect(packageJson.scripts.test).toBeUndefined();
    expect(tree.exists(`${root}/src/client.ts`)).toBe(true);
    expect(tree.exists(`${root}/tests/index.test.ts`)).toBe(false);

    const clientSource = tree.read(`${root}/src/client.ts`, "utf8") ?? "";
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

  it("does not invent a UI contract when ui-kit is absent", async () => {
    const tree = createTestTree();

    await expect(
      generatePlugin(tree, { name: "ui-plugin", withUi: true }),
    ).rejects.toThrow("requires packages/ui-kit");
  });
});
