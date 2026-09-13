---
"@yadsh/dsh-plugin-log": minor
---

Publish every recorded line on a process-wide bus. `subscribePluginLogRecords`
hands a consumer each record as it is written — sequence, time, level, plugin,
module, event, and the caller's own fields — so live views no longer have to
read the log file back or keep a logger of their own. Only the level threshold
decides what reaches the bus, so a consumer never sees output the logger
considered suppressed, and a throwing listener cannot affect the logger. The
file destination, the registry, and the console mirror are unchanged.
