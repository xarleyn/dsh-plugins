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
