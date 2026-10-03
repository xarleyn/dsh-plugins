# @yadsh/dsh-config

Shared TypeScript and Vitest configuration for the dsh-plugins monorepo.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Presets

| Export | Purpose |
| --- | --- |
| `@yadsh/dsh-config/tsconfig/node` | Plain Node packages (ESM, NodeNext) |
| `@yadsh/dsh-config/tsconfig/client` | Packages with a browser/client entrypoint |
| `@yadsh/dsh-config/vitest` | Default Vitest config for plugin test suites |

`tsconfig/base.json` and `tsconfig/browser.json` are files of this package that are
deliberately not exports. `base.json` is the preset that reaches outside this
package — it extends the repository's `tsconfig.base.json` — and `browser.json`
inherits `base`, so the two escape together while `node` and `client` declare no
`extends` at all. Vite's transform resolves `extends` through the
`node_modules/@yadsh/dsh-config` workspace link and folds a relative hop against
that link rather than against its target, so a package inheriting `base` or
`browser` by its subpath sends the search for the root config to
`node_modules/tsconfig.base.json` and every one of its test files fails to compile
(#687). `tsc` canonicalises and never sees it, which is why `build` and `typecheck`
stay green over a red suite, and a POSIX resolver folds `..` along the
already-resolved path, so the difference only shows on Windows.

Withdrawing those two subpaths is the half a machine can hold: an `extends` that
names a subpath the package does not export fails to resolve on the author's first
run, while one that resolves and then mis-lands is a green build over a red suite.
`packages/plugin-kit`, `packages/test-kit` and the plugin generator need the base
options and take them by path inside the workspace —
`"extends": "../config/tsconfig/base.json"` — where the walk starts at this folder
and the hop lands on the root config it means.

`tests/tsconfig-extends.test.ts` reads every workspace config through the same
un-canonicalised walk, fails any exported preset whose chain leaves the package, and
keeps the measured difference between the two halves in front of the reader:
`base.json` read through a workspace link is unreadable, `node.json` read through
the same link is not.

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
