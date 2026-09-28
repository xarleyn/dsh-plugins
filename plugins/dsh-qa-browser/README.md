# @yadsh/dsh-qa-browser

Session-scoped Chromium runtime for DeepSeek Harness. It is the Browser-side
implementation described by `SPEC-DSH-QA-BROWSER.md`; QA Surface remains an
independent layout host.

## Current implementation status

The implemented foundation provides:

- a public Host service at `ctx.qaBrowser`;
- one lazily created Playwright Chromium per plugin runtime — either a process
  this plugin starts and stops, or an existing one joined over its DevTools
  endpoint;
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

- DeepSeek Harness `>=0.1.7-rc.2 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- a compatible Chromium executable

The plugin never downloads a browser in `postinstall`. Install a managed
Playwright Chromium explicitly in the deployment image, set an absolute
`runtime.executablePath`, or run `runtime.mode: attach` against a Chromium that
is already up with its DevTools endpoint open.

## Configuration

```yaml
- id: dsh-qa-browser
  config:
    enabled: true
    runtime:
      provider: playwright
      mode: launch
      executablePath: null
      browserChannel: chromium
      cdpEndpoint: null
      allowRemoteCdpEndpoint: false
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

Every destination the context dials passes this gate: the document, its
redirects and subresources, and the WebSockets a page opens. A socket is not a
request the HTTP route ever sees, so it is asked about at its handshake — and
because the default `allowedSchemes` lists only `http` and `https`, a socket is
refused until `ws` or `wss` is added there. Service workers are blocked in a
Browser context for the same reason: a worker dials from outside every page, so
its traffic would leave past the gate with no tab to attribute it to.

A refusal is the operator's message, not only the model's. When the policy
blocks a destination, the Browser panel lists it — whether the page itself or a
request the page made, the host, how many requests were refused, and the
refusal text, which names the class of address and the setting that lifts the
block — and the Host logs `browser.policy-refused` with the same facts. The two
kinds read differently on purpose: a refused navigation means nothing opened,
while a refused request means the page opened without an asset or an API
answer, which is a page that looks broken rather than one that was blocked. The
panel names both ways out — an `allowHosts` entry for one host, or
`allowPrivateNetworks` for the whole deployment — because they are not
equivalent: the first opens one intranet service, the second opens every
private range to whatever the model asks for.

The notice belongs to a tab, because that is the page the operator is looking
at: the banner explains the selected tab, the strip marks the other tabs the
policy refused something for, and a refusal with no page behind it — a WebSocket
handshake, whose route carries no frame — is shown beside the selected tab's own
entries. One
entry per destination, at most eight of them, counted rather than repeated, and
the next navigation of that tab starts it empty.

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

## Joining a browser that is already running

`runtime.mode` decides where the Chromium comes from. `launch` — the default —
owns one process: the plugin starts it for the first session and closes it when
the runtime shuts down. `attach` joins a browser that is already running, through
its DevTools endpoint:

```yaml
runtime:
  mode: attach
  cdpEndpoint: http://127.0.0.1:9222
```

The endpoint is an `http`/`https` URL for the browser's DevTools server —
Playwright reads its `webSocketDebuggerUrl` itself — or that `ws`/`wss` URL
directly. By default it has to name this machine, and the list is read exactly:
`localhost`, `127.0.0.1`, `::1`, plus the forms the URL parser itself resolves to
those (`http://127.1`, `http://2130706433`). A `*.localhost` name is not on it
although it is meant to be local, and neither is `localhost.` with a trailing dot
— that dot turns the literal into a DNS query. This plugin never resolves the
endpoint, Playwright dials it through the system resolver, and a resolver with a
search domain can answer `chrome.localhost` with a machine somewhere else. For an
`http` endpoint the gate bounds the address written down, which is the first hop:
the server there replies with the `ws` URL to dial, so a deployment that needs the
dialled address pinned writes a `ws` URL. Holding a CDP endpoint means holding the
browser, its every tab included and past this plugin's own policy, so an endpoint
beyond loopback — including one that merely looks like it — needs
`allowRemoteCdpEndpoint: true` written next to it: a decision someone made on
purpose, not a default.

The keys that choose and shape a process are refused under `attach` rather than
ignored: `executablePath`, a `browserChannel` other than `chromium`, and
`chromiumSandbox: false` all describe a Chromium this plugin starts, and a
deployment that wrote them would not be getting what it wrote. The refusals run
both ways: under `launch`, `cdpEndpoint` and
`allowRemoteCdpEndpoint: true` describe a browser this mode does not join, so
they are refused as well.

What attach mode changes, and what it deliberately does not:

- The browser is not ours to stop. Closing a session or evicting an idle one
  releases that session's own context and keeps the link; only shutting the
  plugin down drops the link along with every context this runtime created. The
  process — and any page a person has open in it — stay up through all of it.
- The isolation is the same: every DSH session gets its own browser context
  rather than the default one the person is looking at, so the agent's cookies,
  storage and tabs are the session's own. A `Browser` handle reaches the context
  it came with through one method, `contexts()`, and this runtime never calls it —
  so it drives no page inside that context and closes nothing it did not build.
  SPEC §5 keeps existing user tabs a non-goal, and this is the mode that could
  have broken it. What the CDP connection itself attaches to is Playwright's
  business, which is why the promise is checked against a real browser: the
  person's own tab is still listed by that browser after this plugin's teardown.
- The policy is the same code, on a moved premise: every document, redirect,
  subrequest and socket of a session still passes the server-side scheme, host,
  DNS, private-network and metadata gates, and a refusal is still listed per tab
  in the panel. What `attach` changes is where those two halves run: the gate
  resolves and classifies the name in this process, while the browser dials from
  wherever the deployment started it. On one machine that is the same answer; a
  browser in another container has its own resolver and its own `/etc/hosts`, so
  an allow-list written for the Host is a judgment about a name the browser may
  read differently.
- It is headless-only. In launch mode `headless: false` promises a window a
  person can watch and click in; attach mode owns no window, so that
  combination is refused when the config resolves. Whether the browser behind
  the endpoint has a visible window is that browser's business — and if a person
  can reach it, they can act in the pages the agent is driving. That is a
  property of the endpoint you chose, not something this plugin can promise
  either way.
- A lost link is not a crash. Dropping the CDP connection reports
  `BROWSER_CONNECTION_LOST` and the panel says the connection to the browser was
  lost; a browser this plugin started keeps reporting `BROWSER_CRASHED`. Either
  way the next agent action rebuilds the session instead of pretending the old
  tabs are still there.

## Development

```bash
pnpm --filter @yadsh/dsh-qa-browser check
```

The real Chromium integration tests are opt-in so a project that has nothing to
do with a browser never downloads or spawns one. This project's own CI job is
not such a project: `ci.yml` sets the variable below for
`@yadsh/dsh-qa-browser`, so what only a real browser can answer is checked on a
pull request and on `main` rather than left to whoever remembers to run it. Both
runtime modes are covered there: the launch case starts its own Chromium, and the
attach case starts one outside the plugin, points `runtime.cdpEndpoint` at it,
drives a session through the network gates on that borrowed browser, and checks
that the plugin's teardown left it running. The endpoint is dialled in both forms
the mode accepts — an `http` one, which asks that server where to connect next, and
the `ws` one a deployment writes when it must pin the address itself. The suite looks
for a browser the way the launch path looks for one — Playwright's own build, then
an installed Chrome,
Chromium or Edge — so one variable is enough wherever any of them exists:

```bash
DSH_QA_BROWSER_E2E=1 pnpm --filter @yadsh/dsh-qa-browser test:browser
```

On Windows PowerShell:

```powershell
$env:DSH_QA_BROWSER_E2E = "1"
pnpm --filter @yadsh/dsh-qa-browser test:browser
```

`DSH_QA_BROWSER_EXECUTABLE` names the binary instead of leaving it to that
search — the switch to use when the machine has several, or none findable. A run
that was asked for and could not find a browser fails rather than skipping: a
named binary that is not there says so, and a search that came up empty says so
too.

## License

MIT
