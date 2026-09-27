import path from "node:path";
import ts from "typescript";
import {
  mergeConfig,
  type Plugin,
  type ViteUserConfig,
  type ViteUserConfigExport,
} from "vitest/config";

/**
 * Shared Vitest preset for DSH plugin packages (SPEC §23).
 *
 * Defaults mirror the standard plugin setup: Node environment, global test
 * APIs, and Vitest's default test-file discovery (`.test.ts` / `.spec.ts`).
 *
 * Reuse as-is:
 *
 * ```ts
 * // vitest.config.ts
 * export { default } from "@yadsh/dsh-config/vitest";
 * ```
 *
 * Or extend with package-specific options (overrides win):
 *
 * ```ts
 * // vitest.config.ts
 * import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";
 *
 * export default definePluginVitestConfig({
 *   test: {
 *     environment: "jsdom", // client-side plugin code
 *   },
 * });
 * ```
 */

/** A decorator always opens its own line; a JSDoc tag opens it with `*`. */
const DECORATOR_LINE_RE = /^\s*@[A-Za-z_$]/m;

const TYPESCRIPT_FILE_RE = /\.[cm]?tsx?$/;

const SOURCE_MAP_COMMENT_RE = /\n?\/\/[#@] sourceMappingURL=[^\n]*\n?$/;

/** Matches what `packages/config/tsconfig/node.json` compiles with. */
const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  experimentalDecorators: false,
  useDefineForClassFields: true,
  importHelpers: false,
  // Kept for Vite's own JSX transform, so React refresh stays untouched.
  jsx: ts.JsxEmit.Preserve,
  sourceMap: true,
  inlineSources: true,
};

interface DecodedSourceMap {
  version: number;
  sources: string[];
  mappings: string;
  names?: string[];
  sourcesContent?: string[];
  file?: string;
  sourceRoot?: string;
}

function declaresDecorator(fileName: string, code: string): boolean {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.canHaveDecorators(node) && ts.getDecorators(node)?.length)
      found = true;
    else node.forEachChild(visit);
  };
  visit(source);
  return found;
}

/**
 * Lower TypeScript 5 standard decorators before Vite sees the module.
 *
 * Vite 8 transforms TypeScript with oxc, and oxc lowers only *legacy*
 * (`experimentalDecorators`) decorators — a standard decorator reaches Node
 * verbatim and the module dies at collection with a bare
 * `SyntaxError: Invalid or unexpected token` that names no file and no line.
 * The typert `@Remote` / `@Command` pattern is exactly that shape, so every
 * suite importing a decorated host entry was uncollectable.
 *
 * `tsc` lowers standard decorators correctly — it is what `pnpm build` runs,
 * which is why `build`, `typecheck` and the shipped bundle never showed the
 * gap — so the same compiler performs the lowering here. Legacy lowering is
 * not an option: `Remote` receives a `ClassMethodDecoratorContext`, so
 * `@oxc-project/runtime/helpers/decorate` would record the wrong semantics.
 */
export function lowerStandardDecorators(): Plugin {
  return {
    name: "dsh:lower-standard-decorators",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!TYPESCRIPT_FILE_RE.test(file) || !DECORATOR_LINE_RE.test(code)) {
        return null;
      }
      if (!declaresDecorator(file, code)) return null;
      const emitted = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: TRANSPILE_OPTIONS,
      });
      let map: DecodedSourceMap | undefined;
      if (emitted.sourceMapText) {
        map = JSON.parse(emitted.sourceMapText) as DecodedSourceMap;
        delete map.file;
        delete map.sourceRoot;
        map.sources = [path.resolve(file).replace(/\\/g, "/")];
      }
      return {
        code: emitted.outputText.replace(SOURCE_MAP_COMMENT_RE, "\n"),
        map,
        moduleType: "js",
      };
    },
  };
}

export const baseConfig: ViteUserConfig = {
  plugins: [lowerStandardDecorators()],
  test: {
    globals: true,
    environment: "node",
  },
};

export default baseConfig;

/**
 * Extend the shared preset with package-specific Vitest options.
 * Deep-merges on top of {@link baseConfig}; `overrides` wins on conflicts.
 */
export function definePluginVitestConfig(
  overrides: ViteUserConfig = {},
): ViteUserConfigExport {
  return mergeConfig(baseConfig, overrides) as ViteUserConfigExport;
}
