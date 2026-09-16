---
"@yadsh/dsh-git-readonly": patch
---

Internal cleanup: the plugin consumes the shared `PluginLoggerLike` contract from `@yadsh/dsh-plugin-log` instead of a private copy, and its package verification gates run through the shared runner. No runtime behavior changed.
