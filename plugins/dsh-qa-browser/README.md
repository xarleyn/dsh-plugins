# @yadsh/dsh-qa-browser

Session-scoped Chromium runtime for DeepSeek Harness. It is the Browser-side
implementation described by `SPEC-DSH-QA-BROWSER.md`; QA Surface remains an
independent layout host.

## Current implementation status

The first implementation slice provides:

- a public Host service at `ctx.qaBrowser`;
- one lazily created Playwright Chromium process per plugin runtime;
- one isolated `BrowserContext` per DSH session;
- opaque, persistent tab identities and per-tab mutation queues;
- navigation, viewport, screenshot and tab lifecycle Host primitives;
- compact semantic snapshots with revision-bound refs;
- focused navigate, snapshot, click, type, fill, select, keyboard, hover,
  scroll, wait, tabs, viewport and history agent tools;
- server-side scheme, host, DNS, private-network and metadata-endpoint policy;
- agent-disposal, idle-eviction and plugin-shutdown cleanup.

Native DSH screenshot artifacts and the QA Surface panel are subsequent slices.
No Browser code or Playwright dependency is added to `dsh-qa-surface`.

## Requirements

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- a compatible Chromium executable

The plugin never downloads a browser in `postinstall`. Install a managed
Playwright Chromium explicitly in the deployment image, or set an absolute
`runtime.executablePath`.

## Configuration

```yaml
- id: dsh-qa-browser
  config:
    enabled: true
    runtime:
      provider: playwright
      executablePath: null
      browserChannel: chromium
      headless: true
      actionTimeoutMs: 15000
      navigationTimeoutMs: 30000
      idleTimeoutMinutes: 30
    session:
      contextScope: session
      maxTabs: 12
    viewport:
      width: 1440
      height: 900
      deviceScaleFactor: 1
    security:
      network:
        allowedSchemes: [http, https]
        allowLoopback: true
        allowPrivateNetworks: false
        allowHosts: []
        denyHosts: []
        denyMetadataEndpoints: true
        denyDshOrigin: true
```

`allowHosts` and `denyHosts` accept exact hostnames or a leading wildcard such
as `*.internal.example`. Explicitly allowed hosts may resolve to private
addresses, but cannot bypass the metadata-endpoint deny. `denyHosts` always
wins.

`denyDshOrigin` is enforced for every active DSH origin supplied by the Host
integration. Automatic discovery of those origins is tracked for the security
integration slice; deployments must not treat the empty discovery set in this
foundation slice as a finished self-origin boundary.

## Development

```bash
pnpm --filter @yadsh/dsh-qa-browser check
```

The real Chromium integration test is opt-in so ordinary CI does not download
browser binaries:

```powershell
$env:DSH_QA_BROWSER_E2E = "1"
$env:DSH_QA_BROWSER_EXECUTABLE = "C:\path\to\chrome.exe"
pnpm --filter @yadsh/dsh-qa-browser test:browser
```

## License

MIT
