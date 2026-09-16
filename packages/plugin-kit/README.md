# @yadsh/dsh-plugin-kit

Shared runtime helpers for DeepSeek Harness plugins.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Features

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
