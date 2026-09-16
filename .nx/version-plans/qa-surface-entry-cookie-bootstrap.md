---
"@yadsh/dsh-qa-surface": patch
---

Expose the entry cookie bootstrap and the login attempt budget in the
configuration.

`entry.cookieBootstrap` existed in the defaults and in the config resolvers
but not in the settings schema, so an operator could not turn the flag off:
the `/qa` route always bootstrapped the host cookie through the one-time
`?token=` exchange. The key is now a schema boolean defaulting to `true`
(the previous effective value), next to `entry.redirectNonLoopback`, and is
documented in the README's configuration reference.

`accounts.maxAuthAttemptsPerMinute` was hard-coded at 30 inside the accounts
store: the browser-facing remotes never passed the option, so a deployment
could not tune the store-wide login/registration budget. It is now part of
the `accounts` configuration domain (integer from 1 to 600, default 30),
included in the accounts-store memoization key so a change rebuilds the
store, and documented in the README next to the other accounts keys.
