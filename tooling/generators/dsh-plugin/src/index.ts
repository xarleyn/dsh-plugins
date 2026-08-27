import {
  addProjectConfiguration,
  generateFiles,
  names,
  offsetFromRoot,
  Tree,
} from "@nx/devkit";
import * as path from "node:path";

export interface Schema {
  name: string;
  client?: boolean;
  description?: string;
  scope?: string;
}

export default async function (tree: Tree, options: Schema) {
  const pluginName = names(options.name).fileName;
  const projectName = `dsh-${pluginName}`;
  const projectRoot = `plugins/${pluginName}`;
  const pkgScope = options.scope || "@scope";
  const pkgName = `${pkgScope}/dsh-${pluginName}`;

  // Generate package.json
  const packageJson: Record<string, unknown> = {
    name: pkgName,
    version: "0.1.0",
    description: options.description || `DSH plugin: ${pluginName}`,
    type: "module",
    main: "./lib/index.js",
    types: "./lib/types/index.d.ts",
    exports: {
      ".": {
        types: "./lib/types/index.d.ts",
        default: "./lib/index.js",
      },
    },
    files: ["lib", "cordis.patch.yml", "README.md"],
    dsh: {
      bundle: {
        patch: "./cordis.patch.yml",
      },
    },
    dependencies: {
      "@scope/dsh-plugin-kit": "workspace:^",
    },
    peerDependencies: {
      "@deepseek-ai/cordis": "catalog:dsh",
    },
    devDependencies: {
      "@deepseek-ai/cordis": "catalog:dsh",
      "@scope/dsh-test-kit": "workspace:^",
      typescript: "catalog:tooling",
      vitest: "catalog:tooling",
    },
    publishConfig: {
      access: "public",
    },
    scripts: {
      build: "tsdown",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
  };

  if (options.client) {
    packageJson.exports["./client"] = {
      types: "./lib/types/client.d.ts",
      default: "./lib/client.js",
    };
  }

  // Write package.json
  tree.write(
    `${projectRoot}/package.json`,
    JSON.stringify(packageJson, null, 2),
  );

  // Write tsconfig.json
  const tsconfig = {
    extends: `${offsetFromRoot(projectRoot)}tsconfig.base.json`,
    compilerOptions: {
      rootDir: "src",
      outDir: "lib",
      declarationDir: "lib/types",
    },
    include: ["src"],
    references: [],
  };

  tree.write(
    `${projectRoot}/tsconfig.json`,
    JSON.stringify(tsconfig, null, 2),
  );

  // Write tsdown.config.ts
  const entries = options.client
    ? '["src/index.ts", "src/client.ts"]'
    : '["src/index.ts"]';

  tree.write(
    `${projectRoot}/tsdown.config.ts`,
    `import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ${entries},
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "lib",
  declaration: true,
});
`,
  );

  // Write vitest.config.ts
  tree.write(
    `${projectRoot}/vitest.config.ts`,
    `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
`,
  );

  // Write src/index.ts
  tree.write(
    `${projectRoot}/src/index.ts`,
    `/**
 * ${options.name} Plugin — ${options.description || pluginName}.
 */

import { createLogger } from "@scope/dsh-plugin-kit";

const logger = createLogger("${pluginName}");

/**
 * Initialize the plugin.
 */
export async function initialize(): Promise<void> {
  logger.info("${options.name} plugin initialized");
}

export { logger };
`,
  );

  // Write src/client.ts if client flag is set
  if (options.client) {
    tree.write(
      `${projectRoot}/src/client.ts`,
      `/**
 * Client-side entrypoint for ${pkgName}.
 */

import { createLogger } from "@scope/dsh-plugin-kit";

const logger = createLogger("${pluginName}:client");

export async function initClient(): Promise<void> {
  logger.info("${options.name} client initialized");
}
`,
    );
  }

  // Write cordis.patch.yml
  tree.write(
    `${projectRoot}/cordis.patch.yml`,
    `# Cordis patch configuration for ${pkgName}

patch:
  - target: "session-manager"
    action: "extend"
    handler: "./lib/index.js"
    configKey: "${pluginName}"
`,
  );

  // Write README.md
  tree.write(
    `${projectRoot}/README.md`,
    `# ${pkgName}

${options.description || pluginName}.

## Features

- Feature 1
- Feature 2

## Requirements

- DeepSeek Harness >= 1.0.0

## Installation

npm:
\`\`\`bash
dsh plugin add ${pkgName}
\`\`\`

Tarball:
\`\`\`bash
dsh plugin add ./package.tgz
\`\`\`

## Configuration

## Compatibility

## Development

\`\`\`bash
pnpm build
pnpm test
pnpm typecheck
\`\`\`

## License

MIT
`,
  );

  // Write tests directory placeholder
  tree.write(
    `${projectRoot}/tests/index.test.ts`,
    `import { describe, it, expect } from "vitest";
import { initialize } from "../src/index";

describe("${pluginName}", () => {
  it("should initialize without errors", async () => {
    await expect(initialize()).resolves.not.toThrow();
  });
});
`,
  );

  // Add to project configuration
  addProjectConfiguration(tree, projectName, {
    root: projectRoot,
    sourceRoot: `${projectRoot}/src`,
    targets: {
      build: {
        executor: "nx:run-commands",
        options: {
          command: "tsdown",
          cwd: projectRoot,
        },
      },
      test: {
        executor: "nx:run-commands",
        options: {
          command: "vitest run",
          cwd: projectRoot,
        },
      },
      typecheck: {
        executor: "nx:run-commands",
        options: {
          command: "tsc --noEmit",
          cwd: projectRoot,
        },
      },
    },
  });

  console.log(`Created plugin: ${pkgName} at ${projectRoot}`);
}
