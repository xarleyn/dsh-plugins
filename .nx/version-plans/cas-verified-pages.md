---
"@yadsh/dsh-cas-results": patch
---

Read large tool results in verified pages and preserve complete UTF-8 characters when continuing text from the next byte offset.
Concurrent writers with different compression settings now share a readable object, and submitting its original bytes repairs a mismatched representation.
