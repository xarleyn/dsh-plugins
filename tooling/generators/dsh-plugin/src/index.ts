import { formatFiles, names, type Tree } from "@nx/devkit";

export interface Schema {
  name: string;
  client?: boolean;
  description?: string;
  scope?: string;
  withUi?: boolean;
  withTests?: boolean;
}

type ExportTarget = { types: string; default: string };

const DEFAULT_SCOPE = "@yadsh";

export default async function generatePlugin(
  tree: Tree,
  options: Schema,
): Promise<void> {
  const pluginName = names(options.name).fileName;
  const projectRoot = `plugins/${pluginName}`;
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

  const dependencies: Record<string, string> = {};

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
        version: "0.1.0",
        description: options.description ?? `DSH plugin: ${pluginName}`,
        license: "MIT",
        type: "module",
        main: "./lib/index.js",
        types: "./lib/index.d.ts",
        exports: exportsMap,
        files: ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
        dependencies,
        peerDependencies: {
          "@deepseek-ai/cordis": "catalog:dsh",
        },
        devDependencies,
        publishConfig: { access: "public" },
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

  tree.write(
    `${projectRoot}/src/logger.ts`,
    `interface ConsoleLike {
  log(...args: unknown[]): void;
}

declare const console: ConsoleLike;

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(name: string): Logger {
  const prefix = \`[dsh:\${name}]\`;

  return {
    info(message: string, meta?: Record<string, unknown>): void {
      console.log(\`\${prefix} INFO \${message}\`, meta ?? {});
    },
  };
}
`,
  );

  tree.write(
    `${projectRoot}/src/index.ts`,
    `import { createLogger } from "./logger.js";

export type ${names(pluginName).className}Config = Record<string, unknown>;

const logger = createLogger("${pluginName}");

export async function initialize(
  config: ${names(pluginName).className}Config = {},
): Promise<void> {
  logger.info("${pluginName} plugin initialized", {
    configKeys: Object.keys(config),
  });
}

export { logger };
`,
  );

  if (options.client) {
    tree.write(
      `${projectRoot}/src/client.ts`,
      `import { createLogger } from "./logger.js";

const logger = createLogger("${pluginName}:client");

export async function initializeClient(): Promise<void> {
  logger.info("${pluginName} client initialized");
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
