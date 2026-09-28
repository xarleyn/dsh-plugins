---
"@yadsh/dsh-qa-browser": minor
---

The Browser runtime can now drive a Chromium it did not start.

`runtime.mode` chooses where the browser comes from. `launch` — still the
default, and still the shape DOCKER.md puts first, the image that carries its
own Chromium — owns one process: it starts it for the first session and closes
it on teardown. `attach` joins a browser that is already up, through its DevTools
endpoint, and the runtime's own teardown drops the link and the contexts it
created while leaving the process and a person's own tabs alone. The provider
seam existed for exactly this, so the SPEC's "remote CDP" landed as a second mode
of the Playwright provider instead of a third provider or a new package.

The endpoint is a control handle — whoever holds it drives that browser, past
this plugin's own network policy — so `runtime.cdpEndpoint` names this machine
by default and any other host needs `runtime.allowRemoteCdpEndpoint: true`
written next to it. The default is read exactly: `localhost`, `127.0.0.1`, `::1`,
and the forms the URL parser itself resolves into those (`http://127.1`,
`http://2130706433`). A `*.localhost` name counts as another host, and so does
`localhost.` with its trailing dot, which is a DNS query rather than the literal:
the runtime never resolves the endpoint itself, so a name whose answer a search
domain or a resolver can change proves nothing. For an `http` endpoint what the
gate bounds is the first hop — that server replies with the `ws` URL Playwright
then dials — so a deployment that must pin the dialled address writes a `ws` URL.
Attach mode owns no process, and the config says so rather than quietly ignoring
the keys that would shape one — `headless: false`, an `executablePath`, a
`browserChannel` other than `chromium`, and `chromiumSandbox: false` are each
refused when the config resolves, as are `cdpEndpoint` and
`allowRemoteCdpEndpoint: true` under `launch`, where there is no endpoint for them
to open. A mode outside `launch` and `attach` is refused too, instead of falling
into `launch` while the resolved config still carries the word that was written.

Losing the browser now says which kind of loss it was. A dropped CDP connection
reports `BROWSER_CONNECTION_LOST`, the panel reads "the connection to the
browser was lost" instead of claiming a crash it cannot observe, and the host
logs `browser.connection-lost`; our own process dying keeps `BROWSER_CRASHED`.
Both rebuild the session on the next action, and both wait for the link or the
process with mode-accurate wording while a first page opens.

The launch path is not merely unbroken by this: both modes are pinned by the
suite that runs on every `pnpm test`. Each one names the Playwright entry point
it expects, the context options and network gates it builds on top of that
browser — attached ones included —, what it reports when the browser goes away
and under which log key each of the two losses reaches the operator, that an
attached browser is never asked for the context it came with (`contexts()`
is the one route a `Browser` handle offers to it, and the provider never calls
it), where a session close stops and the runtime's own stop begins — closing the
last of this runtime's contexts leaves the borrowed browser linked for the next
session —, and what the config accepts, endpoint forms included. The opt-in
Chromium run then covers what only a real browser can answer: it starts a
Chromium outside the plugin, drives it over CDP, screenshots it, and checks that
the plugin's teardown left that process running with its owner's page still in
it — and, in a second
case, kills the browser mid-session and reads the session back as a lost link
rather than a crash. The network gates are exercised on that attached browser
too — the refused navigation, the refused socket handshake, and the service worker
that reaches no address outside the gate — since a request path only a launched
browser walked through would prove nothing about the mode this card ships. The
`http` and the `ws` form the mode accepts are both dialled there: the deployment
writes the address itself instead of asking a server for one, Playwright connects to
it without asking anything where to go next, and an `http`-only run would have left
that form untried against a real browser. The two secure spellings ride the same
two branches, and the suite that runs on every `pnpm test` holds a case for each of
the four, so a scheme dropped from the gate reddens the case standing for it rather
than quietly turning a documented form into a refusal. Each attach case finds its
browser through the same search the launch path uses, so a
run that was asked for and found nothing fails saying so — an attach case that
quietly skipped would be the one result nobody could read. That run needs one
variable, `DSH_QA_BROWSER_E2E=1`. This
project's own CI job sets it, so the run belongs to what checks a change rather
than to what someone runs when they remember.

The network policy keeps running on an attached browser, with its premise moved:
the gate resolves and classifies a destination in the Host process, while the
browser dials from wherever the deployment started it. Where the two are one
machine there is one answer, and that is every deployment that starts its own
browser; a Chromium in its own container — the sidecar DOCKER.md draws for this
mode — has its own resolver and its own `/etc/hosts`, so an allow-list written
for the Host is a judgment about a name that browser may read differently.
