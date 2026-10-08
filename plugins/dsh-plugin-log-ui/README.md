# @yadsh/dsh-plugin-log-ui

UI for [`@yadsh/dsh-plugin-log`](https://github.com/xarleyn/dsh-plugins/tree/main/packages/plugin-log),
in two places:

- the settings of this plugin's own row on the host **Plugins** page, which
  discovers active logger consumers automatically and provides
  a default logging level, per-plugin level overrides, and `text` or `json` file
  output, applied live to already-running and newly registered loggers;
- a level held for a moment without saving it, for the operator who wants to look
  at one plugin's `debug` lines and go back afterwards;
- a **Plugin logs** panel in the host's right Sidebar, streaming the records the
  host is writing right now.

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-plugin-log-ui
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-plugin-log-ui
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## The log panel

The panel is a page tab of the right Sidebar: open the column, pick the
**Plugin logs** capsule on its guide page (the strip's `+` control), and the tab
stays available beside the other panes for the session.

What it offers:

- live output from **every** plugin logger, this plugin's own diagnostics
  included, newest last;
- a source filter listing every registered plugin logger — a plugin that has
  gone quiet stays selectable — plus level filters (`trace` … `fatal`) and a
  text filter over the whole line — clock, level, scope, event, and fields —
  all applied in the browser, so switching them is instant;
- severity colouring: `trace`/`debug`/`info` ride the label ramp so a quiet
  stream stays quiet, `warn`/`error` take the warn and error inks, and `fatal`
  inverts in the line while its chip stays a pill on the soft error surface;
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

Settings are stored under the plugin's own profile entry namespace,
`dsh-plugin-log-ui`, in the configured DSH settings provider — the same namespace
the Plugins page reads, so a value saved before the card moved is read back after it.

## Looking without saving

What the selects save is a setting, and a setting is durable: a plugin turned to
`debug` to answer one question stays on `debug` until someone comes back and turns it
off. To look instead of leaving, use **Hold level** in the _Registered plugins_
section — pick the plugin, the level, and how long the look should take: 5, 15 or 30
minutes, an hour, or until you revert it yourself.

A held level is not written to settings, so nothing has to be undone afterwards. The
Host keeps it for the window and then hands the plugin back to whatever its settings
say — on its own timer, with or without a browser still watching the card, and to a
logger that registers after the hold was set. A row running on a held level is marked
`not saved: held at debug · 14 min left`, while its select keeps showing the saved
value: looking now and leaving forever are two different actions.

The level lives in the Host process alone. It is gone when the Host stops, and it is
not part of the Config — neither the settings the Plugins page reads nor
`pluginLogUi.getConfig()` report it; the registry snapshot the card polls does, which
is where the marker comes from.

## Compatibility

The log panel needs the right Sidebar of DSH `0.1.7-rc.2` or newer: the
`sidebarRightTabs` service and the `sidebar.right.pane.tab` seat. The settings
card needs the Plugins page of the same release and its `plugins.row.config`
seat. All three are declared in `compatibility.json` as required client features.

The two sentences above name which surface needs which feature, not what survives
without it: card and panel ship as one client bundle, and a bundle lists the host
packages it registers into as activation dependencies (`dsh.client.inject`), so a
host missing either page loses the whole client half, panel included.

On the Plugins page the host owns the chrome: it draws the row's surface and its
heading, where the title falls back to the installed package name and the
one-liner to this package's `description`, and it mounts this plugin's settings
under the page's own configuration section. So the row is headed
`@yadsh/dsh-plugin-log-ui` and the bundle contributes the body — no card frame, no
header and no chevron of ours, which would be a second frame inside the page's one.

## Development

```bash
pnpm --filter @yadsh/dsh-plugin-log-ui check
```

## License

MIT
