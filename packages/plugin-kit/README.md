# @yadsh/dsh-plugin-kit

Shared runtime helpers for DeepSeek Harness plugins.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Features

- Lightweight console logging for tests and local scaffolds. Production
  plugins use `@yadsh/dsh-plugin-log`.
- Major-version compatibility checking
- Configuration validation
- Safe feature detection utilities

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
