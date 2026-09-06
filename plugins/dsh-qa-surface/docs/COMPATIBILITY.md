# Compatibility

| Plugin version | Tested DSH release | Required public contracts                                                                             |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| 0.1.x          | 0.1.1-rc.2         | `shell.overlay`, `settingsScope`, `connection.api.sessions`, `sessions.binding`, `webServer.register` |

DSH is developer-preview software. Compatibility-sensitive calls are isolated
in `QaSessionController`, `QaTranscriptAdapter`, `QaConfigController` and
`QaRouteController`. The Host navigation adapter also works around this tested
release's exact-index static serving: `/qa` is redirected through `/`, then the
client restores the original pathname. Missing settings fall back to default
browser config; missing required client services prevent the browser plugin
from being injected rather than patching DSH internals.
