---
"@yadsh/dsh-qa-surface": patch
---

Make integration attachment counts configurable through integration.maxAttachments.
The default inherits the chat attachment limit instead of imposing a separate
five-file ceiling. Expose the override in attachment settings and reject excess
files with the effective limit while retaining byte and media-type checks.
Apply changed limits to subsequent HTTP requests and recognize quoted or
unquoted multipart parameters without losing attachment parts.
