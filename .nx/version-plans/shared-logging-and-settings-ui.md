---
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-kv-persist": patch
"@yadsh/dsh-plugin-log": minor
"@yadsh/dsh-plugin-log-ui": minor
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-session-scope": minor
"@yadsh/dsh-sleev": patch
---

Add shared structured plugin logging and its settings UI, expose session-scope
reads through the remote API, and align plugin configuration cards with the
native DSH settings UI. Preserve asynchronous KV streams while migrating
logging consumers to the shared package.
