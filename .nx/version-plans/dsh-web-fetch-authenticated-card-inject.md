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

The release also removes an internal project key from every example in the
package: the Diagnostics and rule-tester placeholders in the shipped client
bundle, the Jira adapter's key-format comment, the SPEC and the test fixtures
now use the neutral `PROJ-123` shape.
