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
 *
 * Coverage is configured here so every package measures the same denominator:
 * the TypeScript of its `src` tree, reported as text plus a machine-readable
 * summary. Because `mergeConfig` concatenates arrays instead of replacing them,
 * re-declaring `coverage.include` in a package can only widen that tree;
 * measuring less is `coverage.exclude`'s job, and it costs comparability with
 * every other package. Leave the default alone unless there is a stated reason.
 *
 * No `thresholds` on purpose: a floor would turn the percentage into a gate that
 * competes with the per-file size budget, and the first response to a red gate is
 * a test that asserts nothing. Read the number, do not enforce it. Vitest drops
 * the report of a red run otherwise, so `reportOnFailure` is on — the number is
 * what the command is for, including on a platform where one suite is red.
 */

/** A decorator always opens its own line; a JSDoc tag opens it with `*`. */
const DECORATOR_LINE_RE = /^\s*@[A-Za-z_$]/m;

/**
 * Clean TypeScript only — `tsx` is deliberately absent. The transform labels its
 * output `moduleType: "js"`, and a lowered `.tsx` still carries JSX (`jsx`
 * defaults to `preserve`), which Vite would then be told to read as plain
 * JavaScript. Every file that declares a decorator in this repository is a
 * `.ts` host entry, so nothing needs the JSX route today; a decorated `.tsx`
 * would need its own JSX-aware emit, not a widened copy of this expression.
 * This bounds the transform's scope only. `coverage.include` measures `.tsx` on
 * purpose — reporting a loaded module needs no lowering, and the client code is
 * part of the `src` tree every package is expected to measure.
 */
const TYPESCRIPT_FILE_RE = /\.[cm]?ts$/;

const SOURCE_MAP_COMMENT_RE = /\n?\/\/[#@] sourceMappingURL=[^\n]*\n?$/;

/**
 * Emit options for the lowering, and where each one comes from.
 *
 * `ts.transpileModule` reads no tsconfig, so what a plugin build gets from
 * `packages/config/tsconfig/node.json` has to be restated here — and it cannot
 * all be restated exactly. Do not "correct" the divergences below against
 * `node.json`: each is load-bearing, and removing one returns every decorated
 * host entry to the red that made this transform necessary.
 *
 * From `node.json`:
 * - `target: ES2022` — the build's target, hence the emit the lowering repeats.
 * - `sourceMap` — on there too; here it is what keeps a failure pointing at the
 *   TypeScript line rather than at the lowered output.
 *
 * Pinned to what `node.json` already implies, restated so a tsconfig edit cannot
 * move this emit on its own:
 * - `experimentalDecorators: false` — the reason the transform exists. Legacy
 *   lowering hands the decorator a descriptor, while `Remote` takes a
 *   `ClassMethodDecoratorContext`; nothing in the repository enables it.
 * - `useDefineForClassFields: true` — what `target: ES2022` gives by default,
 *   and it decides how a decorated field is written.
 *
 * Deliberately not `node.json`:
 * - `module: ESNext` rather than `NodeNext`: `transpileModule` cannot see the
 *   nearest `package.json`, so it reads a `.ts` input as CommonJS and `NodeNext`
 *   emits `exports.Store = Store` into a module Vite loads as ESM.
 * - `importHelpers: false`: enabled, the emit becomes
 *   `import { __esDecorate } from "tslib"`, and no plugin depends on tslib.
 * - `inlineSources: true`: not a build option at all — the map handed to Vite
 *   carries the source text, so a stack frame prints a line worth reading.
 */
const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  experimentalDecorators: false,
  useDefineForClassFields: true,
  importHelpers: false,
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
    ts.ScriptKind.TS,
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
 * gap — so the lowering is done by the TypeScript compiler rather than by
 * widening oxc's config, which offers no lever for this (`OxcOptions` passes no
 * tsconfig through to the transform).
 *
 * Not the same *binary*, though: this preset resolves `typescript` from
 * `catalog:tooling` (5.9.3), while a plugin build compiles with `tsc` from
 * `catalog:plugin-tooling` (7.0.2). The two agree where it matters — diffed on a
 * decorated method, the `__esDecorate` / `__runInitializers` prelude and the
 * class wrapper are byte-identical — and they differ only in module emit, which
 * {@link TRANSPILE_OPTIONS} overrides on purpose. `packages/config`'s own suite
 * pins the semantics that a version split could break: the decorator receiving a
 * standard context rather than a descriptor.
 *
 * Legacy lowering is not an option: `Remote` receives a
 * `ClassMethodDecoratorContext`, so `@oxc-project/runtime/helpers/decorate`
 * would record the wrong semantics.
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
        // Vite's `map` is optional, and `exactOptionalPropertyTypes` forbids passing it explicitly as undefined.
        ...(map ? { map } : {}),
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
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      reportOnFailure: true,
    },
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
