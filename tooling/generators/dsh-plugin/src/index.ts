import { formatFiles, names, type Tree } from "@nx/devkit";

export interface Schema {
  name: string;
  client?: boolean;
  description?: string;
  scope?: string;
  withTests?: boolean;
}

type ExportTarget = { types: string; default: string } | string;

const DEFAULT_SCOPE = "@yadsh";

// DSH indexes and npm search find packages through these keywords, so the
// package-hygiene gate rejects a published manifest without them.
const CANONICAL_KEYWORDS = [
  "deepseek",
  "deepseek-harness",
  "dsh",
  "dsh-plugin",
  "cordis",
];

export default async function generatePlugin(
  tree: Tree,
  options: Schema,
): Promise<void> {
  const normalizedName = names(options.name).fileName;
  const pluginName = normalizedName.replace(/^dsh-/, "");
  const projectRoot = `plugins/dsh-${pluginName}`;
  const packageScope = options.scope ?? DEFAULT_SCOPE;
  const packageName = `${packageScope}/dsh-${pluginName}`;
  const withTests = options.withTests ?? true;

  if (!pluginName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginName)) {
    throw new Error("Plugin name must resolve to non-empty kebab-case.");
  }

  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(packageScope)) {
    throw new Error(
      "Scope must be a valid lowercase npm scope such as @yadsh.",
    );
  }

  if (tree.exists(projectRoot)) {
    throw new Error(`Plugin directory already exists: ${projectRoot}`);
  }

  // Each declared path below is produced by the `build` script emitted for the
  // same option set; `scripts/verify-package.mjs` re-checks them after a build.
  const exportsMap: Record<string, ExportTarget> = {
    ".": {
      types: "./lib/index.d.ts",
      default: "./lib/index.js",
    },
  };

  if (options.client) {
    // tsdown writes this bundle; tsc does not emit declarations for the client
    // entrypoint, so the subpath promises no `types` target it cannot keep.
    exportsMap["./client"] = "./lib/client.js";
  }
  exportsMap["./package.json"] = "./package.json";

  const dependencies: Record<string, string> = {
    "@yadsh/dsh-plugin-log": "workspace:^",
  };

  const devDependencies: Record<string, string> = {
    // The peer range below is what a consumer installs against; this dev copy
    // is pinned so the workspace typechecks against one exact host release.
    "@deepseek-ai/cordis": "catalog:dsh-dev",
    "@types/node": "catalog:tooling",
    "@yadsh/dsh-config": "workspace:^",
    eslint: "catalog:tooling",
    typescript: "catalog:tooling",
  };

  // Only the browser bundle needs a bundler; the host entry is plain tsc emit.
  if (options.client) {
    devDependencies.tsdown = "catalog:tooling";
  }

  const lintTargets = [
    "src",
    ...(withTests ? ["tests"] : []),
    "scripts",
    ...(options.client ? ["tsdown.config.ts"] : []),
  ];

  const scripts: Record<string, string> = {
    build: options.client
      ? "tsc -p tsconfig.build.json && tsdown"
      : "tsc -p tsconfig.build.json",
    lint: `eslint ${lintTargets.join(" ")}`,
    typecheck: "tsc --noEmit",
  };

  if (withTests) {
    devDependencies["@yadsh/dsh-test-kit"] = "workspace:^";
    devDependencies.vitest = "catalog:tooling";
    scripts.test = "vitest run";
  }

  scripts["verify:package"] = "node scripts/verify-package.mjs";
  if (options.client) {
    scripts["verify:client"] = "node scripts/verify-client-bundle.mjs";
  }

  scripts.verify = [
    "pnpm run verify:package",
    ...(options.client ? ["pnpm run verify:client"] : []),
  ].join(" && ");

  scripts.check = [
    "pnpm run lint",
    "pnpm run typecheck",
    ...(withTests ? ["pnpm run test"] : []),
    "pnpm run build",
    "pnpm run verify",
  ].join(" && ");
  scripts.prepack = "pnpm run build && pnpm run verify";

  tree.write(
    `${projectRoot}/package.json`,
    JSON.stringify(
      {
        name: packageName,
        version: "0.0.0",
        description: options.description ?? `DSH plugin: ${pluginName}`,
        repository: {
          type: "git",
          url: "git+https://github.com/xarleyn/dsh-plugins.git",
          directory: projectRoot,
        },
        homepage: `https://github.com/xarleyn/dsh-plugins/tree/main/${projectRoot}#readme`,
        bugs: { url: "https://github.com/xarleyn/dsh-plugins/issues" },
        license: "MIT",
        type: "module",
        main: "./lib/index.js",
        types: "./lib/index.d.ts",
        exports: exportsMap,
        files: [
          "lib",
          "cordis.patch.yml",
          "compatibility.json",
          "README.md",
          "LICENSE",
        ],
        dsh: {
          bundle: { patch: "./cordis.patch.yml" },
          ...(options.client ? { client: { platform: "web" } } : {}),
        },
        dependencies,
        peerDependencies: {
          "@deepseek-ai/cordis": "catalog:dsh",
        },
        devDependencies,
        publishConfig: {
          access: "public",
          registry: "https://registry.npmjs.org/",
        },
        engines: { node: "^22.19.0 || >=24.0.0" },
        keywords: [...CANONICAL_KEYWORDS, `dsh-${pluginName}`],
        scripts,
      },
      null,
      2,
    ),
  );

  tree.write(
    `${projectRoot}/tsconfig.json`,
    JSON.stringify(
      {
        extends: options.client
          ? "@yadsh/dsh-config/tsconfig/client"
          : "@yadsh/dsh-config/tsconfig/node",
        compilerOptions: { noEmit: true },
        include: ["src", ...(withTests ? ["tests"] : [])],
      },
      null,
      2,
    ),
  );

  tree.write(
    `${projectRoot}/tsconfig.build.json`,
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          noEmit: false,
          rootDir: "src",
          outDir: "lib",
        },
        include: ["src"],
        // The browser entrypoint ships as the tsdown bundle, never as tsc emit.
        ...(options.client ? { exclude: ["src/client"] } : {}),
      },
      null,
      2,
    ),
  );

  tree.write(
    `${projectRoot}/src/index.ts`,
    `import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";

export const name = "dsh-${pluginName}";
export const inject: readonly string[] = [];

export type ${names(pluginName).className}Config = Record<string, unknown>;

/** Cordis entrypoint: the returned function disposes this plugin instance. */
export function apply(
  ctx: Context,
  config: ${names(pluginName).className}Config = {},
): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  logger.info("plugin.applied", { configKeys: Object.keys(config) });
  return async () => {
    await logger.close();
  };
}
`,
  );

  if (options.client) {
    tree.write(
      `${projectRoot}/src/client/index.tsx`,
      `import type { Context } from "@deepseek-ai/cordis";

export function apply(_ctx: Context): void {
  // Add browser-only Cordis initialization here. Host file logging is intentionally unavailable.
}
`,
    );

    const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`;
    tree.write(
      `${projectRoot}/tsdown.config.ts`,
      `import { defineConfig, type UserConfig } from "tsdown";

const CLIENT_EXTERNALS = ["@deepseek-ai/cordis"];

const client = {
  name: ${JSON.stringify(`${packageName}/client`)},
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: ${JSON.stringify(banner)},
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
} satisfies UserConfig;

export default defineConfig(client);
`,
    );

    tree.write(
      `${projectRoot}/scripts/verify-client-bundle.mjs`,
      `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
const expectedRegistration = \`id: \${JSON.stringify(packageJson.name)}\`;

assert.ok(
  client.includes(expectedRegistration),
  \`client bundle must register the full package name: \${packageJson.name}\`,
);
assert.doesNotMatch(
  client,
  /^\\s*export\\s/m,
  "client bundle must remain a classic ModuleLoader script without ESM exports",
);
`,
    );
  }

  tree.write(
    `${projectRoot}/scripts/verify-package.mjs`,
    `import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", packageRoot), "utf8"),
);
const patch = await readFile(
  new URL("cordis.patch.yml", packageRoot),
  "utf8",
);

assert.equal(manifest.name, ${JSON.stringify(packageName)});
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.ok(Object.hasOwn(manifest.exports, "."));
assert.match(patch, /id: dsh-${pluginName}\\b/u);
assert.match(patch, new RegExp(\`name: ['"]\${manifest.name}['"]\`, "u"));

// A subpath no build step produces is a promise the published package cannot
// keep, so every path the public surface names must exist after a build.
const exportTargets = (target) => {
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.flatMap(exportTargets);
  if (target === null || typeof target !== "object") return [];
  return Object.values(target).flatMap(exportTargets);
};

for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (subpath === "./package.json") continue;
  for (const path of exportTargets(target)) {
    await access(new URL(path, packageRoot));
  }
}

for (const path of ["lib/index.js", "lib/index.d.ts", "README.md", "LICENSE"]) {
  await access(new URL(path, packageRoot));
}

console.log("verify-package: all gates passed");
`,
  );

  tree.write(
    `${projectRoot}/cordis.patch.yml`,
    `# The DSH plugin manager discovers this bundle through package.json.
- insert:
    - id: dsh-${pluginName}
      name: "${packageName}"
`,
  );

  tree.write(
    `${projectRoot}/compatibility.json`,
    JSON.stringify(
      {
        deepseekHarness: {
          channel: "next",
          range: ">=0.1.7-rc.2 <0.2.0",
          testedReleases: ["0.1.7-rc.2"],
        },
        node: "^22.19.0 || >=24.0.0",
      },
      null,
      2,
    ),
  );

  const license = tree.read("LICENSE", "utf8");
  if (license === null) {
    throw new Error("Root LICENSE file is required to scaffold a plugin.");
  }
  tree.write(`${projectRoot}/LICENSE`, license);

  const features = ["Server-side DSH entrypoint"];
  if (options.client) features.push("Browser-compatible client entrypoint");

  tree.write(
    `${projectRoot}/README.md`,
    `# ${packageName}

${options.description ?? `DSH plugin: ${pluginName}.`}

## Features

${features.map((feature) => `- ${feature}`).join("\n")}

## Requirements

- DeepSeek Harness >=0.1.7-rc.2 <0.2.0
- Node.js ^22.19.0 or >=24.0.0

## Installation

\`\`\`bash
dsh plugin --profile <profile> add ${packageName}
\`\`\`

\`--profile\` is required: \`dsh plugin add <package>\` rejects a call without one.
To install from a checkout of this monorepo instead:

\`\`\`bash
pnpm --filter ${packageName} build
dsh plugin --profile <profile> add ./plugins/dsh-${pluginName}
\`\`\`

To remove the plugin:

\`\`\`bash
dsh plugin --profile <profile> remove ${packageName}
\`\`\`

## Configuration

Configure the plugin under the \`${pluginName}\` key in the DSH profile.

## Specification

See [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/${projectRoot}/SPEC.md).

## Compatibility

- DeepSeek Harness >=0.1.7-rc.2 <0.2.0 (see \`compatibility.json\`)

## Development

\`\`\`bash
pnpm build
pnpm lint
pnpm typecheck
${withTests ? "pnpm test\n" : ""}\`\`\`

## License

MIT
`,
  );

  const specExtraRequirements = options.client
    ? "\n- A browser realm reached through `window.__ModuleLoader__`"
    : "";
  const specClientEntrypoint = options.client
    ? `

\`src/client/index.tsx\` is the browser entrypoint. \`tsdown\` bundles it into
\`lib/client.js\`, a classic script that registers itself under the full package
name \`${packageName}\`. It is published as the \`./client\` subpath and declared
through \`dsh.client\`; it never imports Node-only modules. Host-side file
logging is unavailable in this realm.`
    : "";
  const specBuildContract = options.client
    ? "`tsc` emits `lib/index.js` and `lib/index.d.ts`; `tsdown` emits `lib/client.js`"
    : "`tsc` emits `lib/index.js` and `lib/index.d.ts`";
  const specVerifyContract =
    "every `exports` target exists in the built tree and the bundle patch " +
    `names this package${options.client ? "; the client bundle registers itself under the full package name" : ""}`;

  tree.write(
    `${projectRoot}/SPEC.md`,
    `# dsh-${pluginName} — specification

## 1. Purpose

${options.description ?? `DSH plugin: ${pluginName}.`}

## 2. Requirements

- DeepSeek Harness \`>=0.1.7-rc.2 <0.2.0\`
- Node.js \`^22.19.0 || >=24.0.0\`
- Cordis \`^4.0.4\`${specExtraRequirements}

## 3. Entrypoints

\`src/index.ts\` is the host Cordis entrypoint. It exports \`name\`, \`inject\` and
\`apply(ctx, config)\`; the returned function disposes that plugin instance, so
restarting the entrypoint never leaks a logger or a listener.${specClientEntrypoint}

## 4. Configuration

The plugin reads the \`${pluginName}\` key of the DSH profile
(\`${names(pluginName).className}Config\`).

## 5. Build and verification

| Script | Contract it holds |
| --- | --- |
| \`pnpm build\` | ${specBuildContract} |
| \`pnpm verify\` | ${specVerifyContract} |
| \`pnpm check\` | lint, typecheck${withTests ? ", test" : ""}, build and verify in one run |

## 6. Compatibility

\`compatibility.json\` records the tested DeepSeek Harness releases and the Node
range this package is verified against.

## Open work

- [ ] Replace the scaffolded entrypoint behaviour with the real plugin logic.
- [ ] Expand the configuration schema beyond \`Record<string, unknown>\`.
- [ ] Cover each requirement above with a test in \`tests/\`.
`,
  );

  if (withTests) {
    tree.write(
      `${projectRoot}/vitest.config.ts`,
      'export { default } from "@yadsh/dsh-config/vitest";\n',
    );
    tree.write(
      `${projectRoot}/tests/index.test.ts`,
      `/** Entrypoint contract: the exports DSH installs, and a clean dispose. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apply, inject, name } from "../src/index.js";

let dshHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), "dsh-${pluginName}-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = dshHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(dshHome, { recursive: true, force: true });
});

function makeContext(): Context {
  const logger = () => {};
  return { logger: { debug: logger, info: logger, warn: logger, error: logger } } as unknown as Context;
}

describe("${pluginName}", () => {
  it("exposes the Cordis entrypoint surface", () => {
    expect(name).toBe("dsh-${pluginName}");
    expect(inject).toEqual([]);
    expect(typeof apply).toBe("function");
  });

  it("applies and disposes without errors", async () => {
    const dispose = apply(makeContext(), {});
    expect(dispose).toBeTypeOf("function");
    await expect(dispose()).resolves.toBeUndefined();
  });
});
`,
    );
  }

  await formatFiles(tree);
}
