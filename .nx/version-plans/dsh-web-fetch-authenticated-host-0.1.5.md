---
"@yadsh/dsh-web-fetch-authenticated": minor
---

Migrate to the DSH 0.1.5-rc.2 client surface: credentials move from the
removed IApiClient carrier to the `remote.credentials` Typert remote
(describe/set/unset RemoteResults), the settings section installs via
SettingsProvider.installSection, and the supported host range moves to
`>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.
