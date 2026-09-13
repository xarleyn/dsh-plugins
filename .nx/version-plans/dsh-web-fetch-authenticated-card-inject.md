---
"@yadsh/dsh-web-fetch-authenticated": patch
---

Fix the settings card never mounting in the web UI. The 0.1.5 client runtime
exposes `remote.credentials` as its own Cordis service key (owned by
`dsh-api-settings-controller`), separate from `remote`, and reading a service
that is not declared in `inject` throws `cannot get property
"remote.credentials" without inject`. The client half read the namespace
without declaring it, so the whole browser-side plugin failed to apply — the
Plugins page rendered no Authenticated Web Fetch card, and the loader error
took the entire plugin list down with it. The client now declares
`remote.credentials` beside `remote` and `settingsScope`, matching the
first-party settings plugins, and the package contract asserts the
declaration in the built bundle so the omission cannot come back.
