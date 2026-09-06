# @yadsh/dsh-plugin-kit

Shared runtime helpers for DeepSeek Harness plugins.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Features

- Lightweight console logging for tests and local scaffolds. Production
  plugins use `@yadsh/dsh-plugin-log`.
- Major-version compatibility checking (`hasCompatibleMajor`)
- Configuration validation (`validateConfig`)
- `./client` subpath: the shared settings-card scaffolding for browser
  bundles — canonical `dsh-plugin-card` shell CSS (`PLUGIN_CARD_SHELL_CSS`),
  `ChevronDown`, `CardShell`, `registerSettingsCard` /
  `registerSettingsSlot` / `injectCardStyles`,
  `bindSettingsExternalStore`, and `startVisibilityAwarePolling`. The kit is
  inlined into each plugin's tsdown client bundle, so published bundles stay
  self-contained.

## Workspace usage

```json
"@yadsh/dsh-plugin-kit": "workspace:^"
```

## Development

```bash
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
