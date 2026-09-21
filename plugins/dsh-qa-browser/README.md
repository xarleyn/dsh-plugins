# @yadsh/dsh-qa-browser

Session-scoped Chromium runtime for DeepSeek Harness. It is the Browser-side
implementation described by `SPEC-DSH-QA-BROWSER.md`; QA Surface remains an
independent layout host.

## Current implementation status

The implemented foundation provides:

- a public Host service at `ctx.qaBrowser`;
- one lazily created Playwright Chromium process per plugin runtime;
- one isolated `BrowserContext` per DSH session;
- opaque, persistent tab identities and per-tab mutation queues;
- navigation, viewport, screenshot and tab lifecycle Host primitives;
- compact semantic snapshots with revision-bound refs;
- focused navigate, snapshot, click, type, fill, select, keyboard, hover,
  scroll, wait, tabs, viewport and history agent tools;
- a native `browser_screenshot` result backed by durable DSH attachments;
- a separate QA Surface panel client with browser chrome — a tab strip with
  open/close/select, back/forward/reload, an address field, a device row with
  presets and a fit/scale control, a `⋯` menu, bounded on-demand PNG frames,
  error states and non-focus-stealing activity reveal;
- explicit same-tab human takeover with a Host-enforced lease, source-viewport
  pointer mapping, keyboard/paste, scrolling and agent/human arbitration;
- authenticated panel remotes that ask QA Surface to authorize every session;
- server-side scheme, host, DNS, private-network and metadata-endpoint policy;
- agent-disposal, idle-eviction and plugin-shutdown cleanup.

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
      chromiumSandbox: true
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
    ui:
      autoRevealOnAgentActivity: true
      focusOnAutoReveal: false
    humanControl:
      enabled: true
      leaseSeconds: 30
    security:
      network:
        allowedSchemes: [http, https]
        allowLoopback: true
        allowPrivateNetworks: false
        allowHosts: []
        denyHosts: []
        denyMetadataEndpoints: true
        denyDshOrigin: true
        # Add the public reverse-proxy origin when it differs from Host listen.
        dshOrigins: [https://qa.example.com]
```

`allowHosts` and `denyHosts` accept exact hostnames or a leading wildcard such
as `*.internal.example`. Explicitly allowed hosts may resolve to private
addresses, but cannot bypass the metadata-endpoint deny. `denyHosts` always
wins.

A refusal is the operator's message, not only the model's. When the policy
blocks a navigation, the Browser panel shows the refused host, the class of
address it resolved to and the setting that lifts the block, and the Host logs
`browser.policy-refused` with the same facts. The panel names both ways out —
an `allowHosts` entry for one host, or `allowPrivateNetworks` for the whole
deployment — because they are not equivalent: the first opens one intranet
service, the second opens every private range to whatever the model asks for.
The notice clears once a navigation the policy allows completes.

`denyDshOrigin` automatically covers the active Harness listener on localhost,
the machine hostname and its network interfaces. Add reverse-proxy/public
origins explicitly through `dshOrigins`; Browser rechecks every redirect and
subrequest on the Host.

The QA panel uses the existing DSH Remote transport and QA bearer credential.
It never embeds the target page in an iframe, persists the credential, or opens
a second server. Frames are rejected above 5 MiB.

Human control is explicit and temporary. While the panel owns the lease,
mutating agent Browser tools fail with `BROWSER_HUMAN_CONTROL_ACTIVE`, while
snapshots and screenshots remain readable. Hiding or closing the panel releases
the lease; a lost client expires automatically.

The panel is a browser the operator can use, not just watch. A panel that does
not hold the lease renders its chrome disabled — tabs as a roster, the address
read-only — and can still copy the address or refresh the image. Taking the
lease on a chat whose browser has not started yet starts it, because every
control needs the lease and the lease needs a session. The device row resizes
the emulated viewport under the same deployment bounds the agent's
`browser_viewport` tool uses; clicks and context menus additionally require
`capabilities.coordinateInput`, and the panel says so when a deployment has
turned it off.

Back and forward are drawn from the history the Host has watched this tab
visit — every navigation it performed and every one it saw committed — because
Chromium exposes no "is there an entry behind this page" question. The arrows
are therefore honest about what the runtime knows, and a page that arrived
through a redirect is recorded as a fresh entry rather than guessed at.

The panel's own design — what each control calls, how the lease and the
coordinate-input switch divide the chrome, how history depth is kept — is in
[the panel chrome note](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-browser/docs/specs/browser-panel-chrome.md).

For a containerized Harness, see the
[Docker deployment guide](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-browser/docs/DOCKER.md).
Chromium and its OS libraries must be installed inside the Harness image.

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
