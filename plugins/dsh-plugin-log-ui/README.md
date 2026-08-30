# @yadsh/dsh-plugin-log-ui

Settings UI for [`@yadsh/dsh-plugin-log`](https://github.com/xarleyn/dsh-plugins/tree/main/packages/plugin-log). The
plugin adds a **Plugin logging** card under **Settings → Plugins → Plugin
Configuration**.

The card discovers active logger consumers automatically and provides:

- a default logging level;
- per-plugin level overrides;
- `text` or `json` file output;
- live application to already-running and newly registered loggers.

The default format is `text`, producing lines such as:

```text
2026-08-30T12:34:56.789Z WARN  [dsh-example/worker] example.retry attempt=2
```

Settings are stored under the `plugin-log` namespace in the configured DSH
settings provider.

## Development

```bash
pnpm --filter @yadsh/dsh-plugin-log-ui check
```

## License

MIT
