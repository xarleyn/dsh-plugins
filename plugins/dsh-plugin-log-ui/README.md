# @yadsh/dsh-plugin-log-ui

UI for [`@yadsh/dsh-plugin-log`](https://github.com/xarleyn/dsh-plugins/tree/main/packages/plugin-log),
in two places:

- a **Plugin logging** card under **Settings → Plugins → Plugin Configuration**
  that discovers active logger consumers automatically and provides a default
  logging level, per-plugin level overrides, and `text` or `json` file output,
  applied live to already-running and newly registered loggers;
- a **Plugin logs** panel in the host's right Sidebar, streaming the records the
  host is writing right now.

## The log panel

The panel is a page tab of the right Sidebar: open the column, pick the
**Plugin logs** capsule on its guide page (the strip's `+` control), and the tab
stays available beside the other panes for the session.

What it offers:

- live output from **every** plugin logger, this plugin's own diagnostics
  included, newest last;
- level filters (`trace` … `fatal`) and a text filter over the whole line —
  clock, level, scope, event, and fields — applied in the browser, so switching
  them is instant;
- severity colouring: `trace`/`debug`/`info` ride the label ramp so a quiet
  stream stays quiet, `warn`/`error` take the warn and error inks, and `fatal`
  inverts;
- pause, resume, clear, and a follow toggle that keeps the newest line in view
  until you scroll up;
- an explicit line when the host buffer dropped records the panel never read,
  instead of a silent gap between two lines that never happened together.

It reads `pluginLogUi.tail(cursor, limit)` from the host: a ring buffer of the
last 2000 records, answered from a cursor, which is what makes the live view a
poll rather than a stream the browser would hold open. Records below their
logger's level never reach it — the bus only carries what the logger recorded.

## Settings card

The default format is `text`, producing lines such as:

```text
2026-08-30T12:34:56.789Z WARN  [dsh-example/worker] example.retry attempt=2
```

Settings are stored under the `plugin-log` namespace in the configured DSH
settings provider.

## Compatibility

The log panel needs the right Sidebar of DSH `0.1.5-rc.2` or newer: the
`sidebarRightTabs` service and the `sidebar.right.pane.tab` seat. Both are
declared in `compatibility.json` as required client features.

## Development

```bash
pnpm --filter @yadsh/dsh-plugin-log-ui check
```

## License

MIT
