# @yadsh/dsh-plugin-log

Structured JSON or readable-text file logging for server-side DeepSeek Harness
plugins, with daily rotation, retention, console mirroring, live record
streaming, and runtime discovery.

```ts
import {
  createHostLoggerSink,
  getPluginLogger,
  getRegisteredPluginLoggers,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLogRecords,
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

// Every record that passes its logger's level, as it is recorded.
const stopStreaming = subscribePluginLogRecords((record) => {
  console.info(record.pluginId, record.level, record.event, record.fields);
});

setPluginLogLevel("dsh-example", "debug");
setPluginLogFormat("text");
stopStreaming();
unsubscribe();
await log.close();
```

The registry is process-wide and tracks active logger instances automatically;
the record bus carries what those loggers actually record, so a live consumer
needs neither the file nor a level of its own.
`@yadsh/dsh-plugin-log-ui` uses both: live defaults, per-plugin level overrides,
and a `json`/`text` selector in DSH settings, plus a **Plugin logs** panel in the
host's right Sidebar that streams the bus behind level and text filters.
See the repository's
[`docs/PLUGIN_LOGGING.md`](https://github.com/xarleyn/dsh-plugins/blob/main/docs/PLUGIN_LOGGING.md)
for the complete behavior and API contract.

## Structural logging surface

Plugins that keep their services decoupled from the concrete logger accept the
narrow `PluginLoggerLike` contract (`debug`/`info`/`warn`/`error` with event
codes and metadata fields). The real `PluginLogger` satisfies it structurally,
and `silentPluginLogger()` provides the no-op stand-in for tests and optional
diagnostics:

```ts
import { getPluginLogger, silentPluginLogger, type PluginLoggerLike } from "@yadsh/dsh-plugin-log";

function createService(log: PluginLoggerLike = silentPluginLogger()) {
  log.info("service.ready", { modules: 3 });
}

createService(getPluginLogger({ pluginId: "dsh-example" }));
```

## Development

```bash
pnpm --filter @yadsh/dsh-plugin-log check
```

## License

MIT
