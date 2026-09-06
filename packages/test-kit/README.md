# @yadsh/dsh-test-kit

Testing utilities for DeepSeek Harness plugins.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Features

- Mock DSH plugin context (`createMockContext`)
- Temporary fixture helpers (`createTempFixture`)
- Re-exports `createLogger` from `@yadsh/dsh-plugin-kit` for test scaffolds

## Workspace usage

```json
"@yadsh/dsh-test-kit": "workspace:^"
```

## Development

```bash
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
