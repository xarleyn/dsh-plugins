---
"@yadsh/dsh-qa-integrations": patch
---

Fix service connection checks reporting healthy providers as unavailable by
preserving the provider instance when probing managed credentials.
