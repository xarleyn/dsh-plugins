# @yadsh/dsh-test-kit

Testing utilities for DeepSeek Harness plugins.

This is a private workspace package used only inside this monorepo. It is not
published to npm.

## Features

- Deterministic clock for time-dependent tests (`fixedClock`)
- In-memory KV table stand-in (`memoryTable`)
- Collector for the listeners a fake host context registers
  (`listenerCollector`)
- Log-directory fixtures (`makeLogDir`, `readLogLines`) and a module-loader
  stub (`createModuleLoaderStub`)

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
