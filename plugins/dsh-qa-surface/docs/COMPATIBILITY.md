# Compatibility

| Plugin version | Tested DSH release | Required public contracts                                                                                                                                                              |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.x          | 0.1.1-rc.2         | `shell.overlay`, Typert remote, `agentPresets.composedPreset`, `permissionPresets`, agent-scoped `tools.restrict/guard`, `workspaceRegistry`, session/model APIs, `webServer.register` |

DSH is developer-preview software. Compatibility-sensitive calls are isolated
in `QaSessionController`, `QaTranscriptAdapter`, `QaConfigController` and
`QaRouteController`; Host lockdown coupling is isolated in
`QaSurface.secureSession`. The Host navigation adapter also works around this tested
release's exact-index static serving: `/qa` is redirected through `/`, then the
client restores the original pathname. Missing settings fall back to default
browser config; missing required client services prevent the browser plugin
from being injected rather than patching DSH internals.
