// Shared Typert Remote artifact generator. The per-plugin
// scripts/generate-typert.mjs files are thin shims passing the plugin's
// identity; the staged-workspace layout and emitted lib/typert.* artifacts
// are identical for every plugin (SPEC §5, remote protocol).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FaceModelEmitter, WorkspaceAnalyzer } from "@deepseek-ai/dsh-typert-generator";

/**
 * @param {object} options
 * @param {URL | string} options.packageRoot - Absolute plugin package root (the shim's `new URL("../", import.meta.url)`).
 * @param {string} options.packageName - Full npm package name, e.g. `@yadsh/dsh-plugin-log-ui`.
 * @param {string} options.runtimeId - Unscoped runtime id for the staged workspace dir, e.g. `dsh-plugin-log-ui`.
 * @param {string} options.serviceName - The Remote service key Typert must discover, e.g. `pluginLogUi`.
 */
export async function generateTypert(options) {
  const packageRoot = resolve(fileURLToPath(options.packageRoot));
  const runtimeId = options.runtimeId;
  const workspaceRoot = join(packageRoot, ".typert-workspace");
  const stagedRoot = join(workspaceRoot, "packages", runtimeId);
  const protocolRoot = join(workspaceRoot, "packages", "dsh-typert-protocol");

  if (!packageRoot.startsWith(resolve(packageRoot))) {
    throw new Error(`refusing to prepare Typert workspace outside ${packageRoot}`);
  }
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(stagedRoot, { recursive: true });
  cpSync(join(packageRoot, "src"), join(stagedRoot, "src"), { recursive: true });
  cpSync(join(packageRoot, "package.json"), join(stagedRoot, "package.json"));
  cpSync(
    join(packageRoot, "node_modules", "@deepseek-ai", "dsh-typert-protocol", "lib", "types"),
    join(protocolRoot, "src"),
    { recursive: true },
  );
  writeFileSync(join(protocolRoot, "package.json"), `${JSON.stringify({
    name: "@deepseek-ai/dsh-typert-protocol",
    type: "module",
    exports: { ".": { types: "./src/index.d.ts", default: "./src/index.js" } },
  }, null, 2)}\n`);

  const compilerOptions = {
    target: "ES2024",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    composite: true,
    baseUrl: workspaceRoot,
    paths: {
      "@deepseek-ai/dsh-typert-protocol": ["packages/dsh-typert-protocol/src/index.d.ts"],
    },
    types: ["node"],
  };
  writeFileSync(join(stagedRoot, "tsconfig.json"), `${JSON.stringify({
    compilerOptions,
    include: ["src/**/*.ts"],
    exclude: ["src/client/**"],
  }, null, 2)}\n`);
  writeFileSync(join(protocolRoot, "tsconfig.json"), `${JSON.stringify({
    compilerOptions,
    include: ["src/**/*.d.ts"],
  }, null, 2)}\n`);
  writeFileSync(join(workspaceRoot, "tsconfig.host.json"), `${JSON.stringify({
    files: [],
    references: [
      { path: "./packages/dsh-typert-protocol" },
      { path: `./packages/${runtimeId}` },
    ],
    compilerOptions,
  }, null, 2)}\n`);

  const workspace = new WorkspaceAnalyzer({
    root: workspaceRoot,
    packages: [options.packageName],
    faces: ["host"],
  }).analyze();
  const face = workspace.faces.find((candidate) => candidate.face === "host");
  const artifact = face === undefined
    ? undefined
    : new FaceModelEmitter(face).emit(options.packageName);
  if (artifact === undefined || artifact.remote === undefined) {
    throw new Error(`Typert did not discover the ${options.serviceName} Remote service: ${JSON.stringify(
      face?.packages.map(({ name, exports, services, invocations }) => ({
        name,
        exports: exports.map((item) => `${item.subpath}:${item.name}`),
        services: services.map((item) => item.key),
        invocations: invocations.map((item) => `${item.namespace}/${item.method}`),
      })),
    )}`);
  }

  const output = join(packageRoot, "lib");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "typert.host.js"), artifact.js);
  writeFileSync(join(output, "typert.host.d.ts"), artifact.dts);
  writeFileSync(join(output, "typert.remote-client.js"), artifact.remote.js);
  writeFileSync(join(output, "typert.remote-client.d.ts"), artifact.remote.dts);
  writeFileSync(join(output, "typert.remote-client.d.ts.map"), artifact.remote.dtsMap);
  rmSync(workspaceRoot, { recursive: true, force: true });
}
