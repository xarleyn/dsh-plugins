# @yadsh/dsh-plugin-log

Structured JSON or readable-text file logging for server-side DeepSeek Harness
plugins, with daily rotation, retention, console mirroring, and runtime
discovery.

```ts
import {
  createHostLoggerSink,
  getPluginLogger,
  getRegisteredPluginLoggers,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLoggerRegistry,
} from "@yadsh/dsh-plugin-log";

const log = getPluginLogger({
  pluginId: "dsh-example",
  consoleSink: createHostLoggerSink(ctx.logger),
});
log.info("example.ready");

const unsubscribe = subscribePluginLoggerRegistry((loggers) => {
  console.info("active logger consumers", loggers);
});

setPluginLogLevel("dsh-example", "debug");
setPluginLogFormat("text");
unsubscribe();
await log.close();
```

The registry is process-wide and tracks active logger instances automatically.
`@yadsh/dsh-plugin-log-ui` uses it to provide live defaults, per-plugin level
overrides, and a `json`/`text` selector in DSH settings.
See the repository's
[`docs/PLUGIN_LOGGING.md`](https://github.com/xarleyn/dsh-plugins/blob/main/docs/PLUGIN_LOGGING.md)
for the complete behavior and API contract.

## Development

```bash
pnpm --filter @yadsh/dsh-plugin-log check
```

## License

MIT
