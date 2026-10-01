# @yadsh/dsh-config

Shared TypeScript and Vitest configuration for the dsh-plugins monorepo.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Presets

| Export | Purpose |
| --- | --- |
| `@yadsh/dsh-config/tsconfig/base` | Common compiler options every plugin/package inherits |
| `@yadsh/dsh-config/tsconfig/node` | Plain Node packages (ESM, NodeNext) |
| `@yadsh/dsh-config/tsconfig/browser` | Packages with a browser/client entrypoint |
| `@yadsh/dsh-config/vitest` | Default Vitest config for plugin test suites |

`tsconfig/base` is the one preset that reaches outside this package: it extends the
repository's `tsconfig.base.json`. Vite's transform resolves `extends` through the
`node_modules/@yadsh/dsh-config` workspace link and folds a relative hop against
that link rather than against its target, so a package inheriting `base` by its
subpath sends the search to `node_modules/tsconfig.base.json` and every one of its
test files fails to compile (#687). `tsc` canonicalises and never sees it, which is
why `build` and `typecheck` stay green over a red suite, and a POSIX resolver folds
`..` along the resolved path, so the difference only shows on Windows. Inherit that
preset by its path inside the workspace — `"extends": "../config/tsconfig/base.json"`
— as `packages/plugin-kit`, `packages/test-kit` and the plugin generator do.
`tests/tsconfig-extends.test.ts` reads every workspace config through the same
un-canonicalised walk, so the rule holds for a preset that gains an escape later.

## Usage

`tsconfig.json` of a plain Node plugin:

```json
{
  "extends": "@yadsh/dsh-config/tsconfig/node",
  "include": ["src", "tests"]
}
```

`vitest.config.ts` of a plugin without custom options:

```ts
export { default } from "@yadsh/dsh-config/vitest";
```

Plugins that need extra options should import
`definePluginVitestConfig` from `@yadsh/dsh-config/vitest` instead of
hand-rolling `defineConfig`.

The Vitest preset also carries the coverage defaults, so every package measures
the same denominator: the V8 provider, the `text` and `json-summary` reporters,
and `src/**/*.ts` plus `src/**/*.tsx` as the instrumented tree. `mergeConfig`
concatenates arrays instead of replacing them, so a package that repeats
`coverage.include` only widens that tree — measuring less is
`coverage.exclude`'s job, and it costs comparability with every other package.
`pnpm run test:coverage` in any package prints its own percentages, and
`pnpm test:coverage` at the root prints them for all of them, one project at a
time. A run with a failing test still reports, because the number is what the
command is for. Thresholds are deliberately not configured — the percentage is a
signal to read, not a gate to satisfy.

## Development

```bash
pnpm install
pnpm lint
pnpm test
```

`pnpm test` covers the Vitest preset itself (see `tests/`): it is the only place
the decorator lowering is checked, so a regression there surfaces as this
package's red suite rather than as a nameless `SyntaxError` in every package
that imports a decorated host entry.

## License

MIT
