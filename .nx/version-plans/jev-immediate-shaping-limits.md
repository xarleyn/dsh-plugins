---
"@yadsh/dsh-jev-compaction": patch
---

Respect the master switch and concurrent request limit when shaping tool results. Keep the full result when the classifier is busy or times out, and enforce archive retention in the background after each write.
