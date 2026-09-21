---
"@yadsh/dsh-qa-integrations": patch
---

The integration store is closed when the plugin goes away.

`IntegrationRepository.close()` existed and nothing called it: the plugin's
teardown removed the tools and closed the logger, leaving the SQLite handle and
its WAL open for whatever ran next. A reload therefore handed the new instance
a database that was still held — the stray `qa-integrations.db`, `-shm` and
`-wal` files a local run leaves in the plugin directory are what that looks
like from the outside.

Disposal now closes the store, so a reload re-opens the file instead of
inheriting the previous instance's lock.
