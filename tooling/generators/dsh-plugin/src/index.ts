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
const LOGGER_TEMPLATE_ROOT = "plugins/dsh-kv-persist/src/logging";
const LOGGER_TEMPLATE_FILES = ["dsh-home.ts", "index.ts", "plugin-logger.ts"];

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
    throw new Error("Scope must be a valid lowercase npm scope such as @yadsh.");
  }

  if (tree.exists(projectRoot)) {
    throw new Error(`Plugin directory already exists: ${projectRoot}`);
  }

  if (options.withUi && !tree.exists("packages/ui-kit/package.json")) {
    throw new Error(
      "--with-ui requires packages/ui-kit. Add the shared UI kit only when a real reusable UI contract exists.",
    );
  }

  const loggingTemplates = LOGGER_TEMPLATE_FILES.map((file) => {
    const source = tree.read(`${LOGGER_TEMPLATE_ROOT}/${file}`, "utf8");
    if (source === null) {
      throw new Error(
        `Canonical logging template is missing: ${LOGGER_TEMPLATE_ROOT}/${file}`,
      );
    }
    return { file, source };
  });

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
    pino: "^10.3.1",
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

  const scripts: Record<string, string> = {
    build: "tsc",
    lint: withTests ? "eslint src tests" : "eslint src",
    typecheck: "tsc --noEmit",
  };

  if (withTests) {
    devDependencies["@yadsh/dsh-test-kit"] = "workspace:^";
    devDependencies.vitest = "catalog:tooling";
    scripts.test = "vitest run";
  }

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
        files: ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
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
        extends: "@yadsh/dsh-config/tsconfig/base",
        compilerOptions: { rootDir: "src", outDir: "lib" },
        include: ["src"],
      },
      null,
      2,
    ),
  );

  for (const { file, source } of loggingTemplates) {
    tree.write(`${projectRoot}/src/logging/${file}`, source);
  }

  tree.write(
    `${projectRoot}/src/index.ts`,
    `import { getPluginLogger } from "./logging/index.js";

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
      `export function initializeClient(): void {
  // Add browser-only initialization here. Host file logging is intentionally unavailable.
}
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

- DeepSeek Harness >= 4.0.0 < 5.0.0

## Installation

\`\`\`bash
dsh plugin add ${packageName}
\`\`\`

## Configuration

Configure the plugin under the \`${pluginName}\` key in the DSH profile.

## Compatibility

- DeepSeek Harness >= 4.0.0 < 5.0.0

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
