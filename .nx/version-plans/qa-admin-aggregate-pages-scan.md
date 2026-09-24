---
"@yadsh/dsh-qa-surface": patch
---

The administrative console's aggregate pages answer without re-reading the
deployment's conversation logs.

«Обзор», «Разговоры», «Аналитика» and «Очередь разбора» took minutes to open on
a stand with real history (over four and a half minutes observed), and while one
of them was loading the other administrative calls waited behind it, because the
browser gives a single origin only a handful of connections.

The cost was in conversation-log reads, and two things made it unbounded. The
conversation list read the log of every reserved conversation to filter a list
that no filter had asked anything of — a title matters only while somebody is
searching, and a page shows twenty-five rows. The aggregate pages read the newest
two hundred logs again on every load, each of those reads being a full listing of
every stored session plus a replay of the log asked for, and reading one page
evicted the projections another page had just built because the cache was smaller
than the scan window it serves.

The list now reads logs only where a filter needs one: without search text a page
costs its own rows. A conversation the Harness no longer holds cannot gain
messages, so its projection is kept instead of expiring after the TTL — which
still applies to a conversation being written. The counts and the tool-failure
signals are collected in one pass over the window, and a caller that asks for a
window already being scanned joins that pass rather than starting a second scan.
All four of those calls now carry the browser's cancellation: leaving a page that
has not answered stops the scan between two logs instead of finishing it for an
answer nobody will read.
