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

    const root = "plugins/example-plugin";
    const packageJson = JSON.parse(
      tree.read(`${root}/package.json`, "utf8") ?? "{}",
    );

    expect(packageJson.name).toBe("@yadsh/dsh-example-plugin");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.types).toBe("./lib/index.d.ts");
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
    expect(tree.exists(`${root}/src/logger.ts`)).toBe(true);
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
      name: "client-only",
      client: true,
      withTests: false,
    });

    const root = "plugins/client-only";
    const packageJson = JSON.parse(
      tree.read(`${root}/package.json`, "utf8") ?? "{}",
    );

    expect(packageJson.exports["./client"]).toEqual({
      types: "./lib/client.d.ts",
      default: "./lib/client.js",
    });
    expect(packageJson.scripts.test).toBeUndefined();
    expect(tree.exists(`${root}/src/client.ts`)).toBe(true);
    expect(tree.exists(`${root}/tests/index.test.ts`)).toBe(false);
  });

  it("rejects duplicate plugin directories", async () => {
    const tree = createTestTree();
    tree.write("plugins/existing/package.json", "{}");

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
