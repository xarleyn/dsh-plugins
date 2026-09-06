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

## Development

```bash
pnpm install
pnpm lint
```

## License

MIT
