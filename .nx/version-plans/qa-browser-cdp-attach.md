---
"@yadsh/dsh-qa-browser": minor
---

The Browser runtime can now drive a Chromium it did not start.

`runtime.mode` chooses where the browser comes from. `launch` — still the
default, and still the shape every documented deployment runs — owns one
process: it starts it for the first session and closes it on teardown. `attach`
joins a browser that is already up, through its DevTools endpoint, and the
runtime's own teardown drops the link and the contexts it created while leaving
the process and a person's own tabs alone. The provider seam existed for exactly
this, so the SPEC's "remote CDP" landed as a second mode of the Playwright
provider instead of a third provider or a new package.

The endpoint is a control handle — whoever holds it drives that browser, past
this plugin's own network policy — so `runtime.cdpEndpoint` names this machine
by default (`localhost`, `127.0.0.1`, `::1`) and any other host needs
`runtime.allowRemoteCdpEndpoint: true` written next to it. A `*.localhost` name
counts as another host: the runtime never resolves the endpoint itself, so a name
whose answer a search domain can change proves nothing. Attach mode owns no
process, and the config says so rather than quietly ignoring the keys that would
shape one — `headless: false`, an `executablePath`, a `browserChannel` other than
`chromium`, and `chromiumSandbox: false` are each refused when the config
resolves, as are `cdpEndpoint` and `allowRemoteCdpEndpoint: true` under `launch`,
where there is no endpoint for them to open. A mode outside `launch` and
`attach` is refused too, instead of falling into `launch` while the resolved
config still carries the word that was written.

Losing the browser now says which kind of loss it was. A dropped CDP connection
reports `BROWSER_CONNECTION_LOST`, the panel reads "the connection to the
browser was lost" instead of claiming a crash it cannot observe, and the host
logs `browser.connection-lost`; our own process dying keeps `BROWSER_CRASHED`.
Both rebuild the session on the next action, and both wait for the link or the
process with mode-accurate wording while a first page opens.

The launch path is not merely unbroken by this: both modes are pinned by the
suite that runs on every `pnpm test`. Each one names the Playwright entry point
it expects, the context options and network gates it builds on top of that
browser — attached ones included —, what it reports when the browser goes away,
that an attached browser arrives with a default context the runtime never reads,
drives or closes, and what the config accepts. The opt-in Chromium run then
covers what only a real browser can answer: it starts a Chromium outside the
plugin, drives it over CDP, screenshots it, and checks that the plugin's teardown
left it running — and, in a second case, kills that browser mid-session and reads
the panel the way an operator would, as a lost link rather than a crash. That
run needs one variable, `DSH_QA_BROWSER_E2E=1`, and finds a browser on the
machine the way the launch path finds one. This project's own CI job sets that
variable, so the run belongs to what checks a change rather than to what someone
runs when they remember. A run that was asked for and found nothing fails saying
so — an attach case that quietly skipped would be the one result nobody could
read.
