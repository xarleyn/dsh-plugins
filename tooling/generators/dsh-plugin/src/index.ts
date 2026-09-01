import { formatFiles, names, type Tree } from "@nx/devkit";

export interface Schema {
  name: string;
  client?: boolean;
  description?: string;
  scope?: string;
  withUi?: boolean;
  withTests?: boolean;
}

type ExportTarget = { types: string; default: string } | string;

const DEFAULT_SCOPE = "@yadsh";

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

  if (options.withUi && !tree.exists("packages/ui-kit/package.json")) {
    throw new Error(
      "--with-ui requires packages/ui-kit. Add the shared UI kit only when a real reusable UI contract exists.",
    );
  }

  const exportsMap: Record<string, ExportTarget> = {
    ".": {
      types: "./lib/index.d.ts",
      default: "./lib/index.js",
    },
  };

  if (options.client) {
    exportsMap["./client"] = {
      types: "./lib/client.d.ts",
      default: "./lib/client.js",
    };
  }
  exportsMap["./package.json"] = "./package.json";

  const dependencies: Record<string, string> = {
    "@yadsh/dsh-plugin-log": "workspace:^",
  };

  if (options.withUi) {
    dependencies["@yadsh/dsh-ui-kit"] = "workspace:^";
  }

  const devDependencies: Record<string, string> = {
    "@deepseek-ai/cordis": "catalog:dsh",
    "@yadsh/dsh-config": "workspace:^",
    eslint: "catalog:tooling",
    typescript: "catalog:tooling",
  };

  if (options.client) {
    devDependencies.tsdown = "catalog:tooling";
  }

  const lintTargets = [
    "src",
    ...(withTests ? ["tests"] : []),
    ...(options.client ? ["scripts", "tsdown.config.ts"] : []),
  ];

  const scripts: Record<string, string> = {
    build: options.client ? "tsc && tsdown" : "tsc",
    lint: `eslint ${lintTargets.join(" ")}`,
    typecheck: "tsc --noEmit",
  };

  if (withTests) {
    devDependencies["@yadsh/dsh-test-kit"] = "workspace:^";
    devDependencies.vitest = "catalog:tooling";
    scripts.test = "vitest run";
  }

  if (options.client) {
    scripts["verify:client"] = "node scripts/verify-client-bundle.mjs";
  }

  scripts.check = [
    "pnpm run lint",
    "pnpm run typecheck",
    ...(withTests ? ["pnpm run test"] : []),
    "pnpm run build",
    ...(options.client ? ["pnpm run verify:client"] : []),
  ].join(" && ");
  scripts.prepack = "pnpm run build";

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
          ? "@yadsh/dsh-config/tsconfig/browser"
          : "@yadsh/dsh-config/tsconfig/node",
        compilerOptions: { rootDir: "src", outDir: "lib" },
        include: ["src"],
      },
      null,
      2,
    ),
  );

  tree.write(
    `${projectRoot}/src/index.ts`,
    `import { getPluginLogger } from "@yadsh/dsh-plugin-log";

export type ${names(pluginName).className}Config = Record<string, unknown>;

const logger = getPluginLogger({ pluginId: "dsh-${pluginName}" });

export async function initialize(
  config: ${names(pluginName).className}Config = {},
): Promise<void> {
  logger.info("plugin.initialized", {
    configKeys: Object.keys(config),
  });
}

export async function dispose(): Promise<void> {
  await logger.close();
}

export { logger };
`,
  );

  if (options.client) {
    tree.write(
      `${projectRoot}/src/client.ts`,
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
  entry: { client: "src/client.ts" },
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
          range: ">=0.1.1-rc.2 <0.2.0",
          testedReleases: ["0.1.1-rc.2"],
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
  if (options.withUi) features.push("Shared DSH UI kit integration");

  tree.write(
    `${projectRoot}/README.md`,
    `# ${packageName}

${options.description ?? `DSH plugin: ${pluginName}.`}

## Features

${features.map((feature) => `- ${feature}`).join("\n")}

## Requirements

- DeepSeek Harness >=0.1.1-rc.2 <0.2.0
- Node.js ^22.19.0 or >=24.0.0

## Installation

\`\`\`bash
dsh plugin add ${packageName}
\`\`\`

## Configuration

Configure the plugin under the \`${pluginName}\` key in the DSH profile.

## Compatibility

- DeepSeek Harness >=0.1.1-rc.2 <0.2.0 (see \`compatibility.json\`)

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

  if (withTests) {
    tree.write(
      `${projectRoot}/vitest.config.ts`,
      'export { default } from "@yadsh/dsh-config/vitest";\n',
    );
    tree.write(
      `${projectRoot}/tests/index.test.ts`,
      `import { describe, expect, it } from "vitest";
import { initialize } from "../src/index";

describe("${pluginName}", () => {
  it("initializes without errors", async () => {
    await expect(initialize()).resolves.toBeUndefined();
  });
});
`,
    );
  }

  await formatFiles(tree);
}
