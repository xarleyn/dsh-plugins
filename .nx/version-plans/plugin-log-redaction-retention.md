---
"@yadsh/dsh-plugin-log": patch
"@yadsh/dsh-plugin-log-ui": patch
---

A `redact` path hides the field from the console mirror and the live log panel,
not only from the log file; the logger stops freezing the caller's object, and
retention sweeps on every rollover instead of once per logger.

Redaction used to be a property of the pino instance alone, so it guarded the one
sink that serializes through pino. The console mirror printed the fields as they
arrived, and the record bus published them to the log panel the same way — a
plugin that configured `redact: ["apiKey"]` kept its key out of `<day>.log` while
the operator's terminal and the **Plugin logs** sidebar both showed it. The
bus was documented as raw, and the panel was documented as the place where
sanitizing happens, but the panel only bounds what it renders: depth, cycles,
length. Nothing between the logger and the screen was ever asked to cut a secret.
The paths now run once in `write`, through the same `@pinojs/redact` pino uses,
before the sinks branch; the file keeps pino's own pass as well, so a path the
option documents behaves identically everywhere, and a record the level keeps out
of the file is redacted on its way to the mirror too.

A published record also used to freeze the object it was handed, so a plugin that
logged a field object it still owned got a `TypeError` on its next assignment.
The record is now a frozen copy of the caller's fields, which additionally makes
it a snapshot: mutating the object after the call no longer rewrites what a
subscriber already saw.

Retention ran only once for the life of a logger: the sweep promise was kept
forever as the guard against overlapping passes, and every later rollover saw it
still set and skipped its own. On a long-running host the window therefore
stopped being enforced the day after startup, and daily logs kept accumulating
however short `retentionDays` was. Sweeps are now chained behind one another —
still never overlapping, still awaited by `close()` — so each rollover prunes the
files the window covers.
