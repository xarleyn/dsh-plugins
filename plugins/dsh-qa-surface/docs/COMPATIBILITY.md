# Compatibility

| Plugin version | Tested DSH release | Required public contracts                                                                                                                                                              |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.x–0.4.x    | 0.1.5-rc.2         | `shell.overlay`, Typert remote, `agentPresets.composedPreset`, `permissionPresets`, agent-scoped `tools.restrict/guard`, `workspaceRegistry`, session/model APIs, `webServer.register` |
| 0.5.x          | 0.1.5-rc.2         | All previous contracts plus keyed child-slot declaration/dispatch with owner props for the public `qa.surface.panel` extension seat |

DSH is developer-preview software. Compatibility-sensitive calls are isolated
in `QaSessionController`, `QaTranscriptAdapter`, `QaConfigController` and
`QaRouteController`; Host lockdown coupling is isolated in
`QaSurface.secureSession`. The Host navigation adapter also works around this tested
release's exact-index static serving: `/qa` is redirected through `/`, then the
client restores the original pathname. Missing settings fall back to default
browser config; missing required client services prevent the browser plugin
from being injected rather than patching DSH internals.

The QA panel API is owned by this package, not Harness: version 1 exposes the
`qaSurfacePanels` client service and `qa.surface.panel` keyed body slot from
`@yadsh/dsh-qa-surface/client/panels`.
