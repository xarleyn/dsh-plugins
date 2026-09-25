---
"@yadsh/dsh-qa-browser": patch
---

A page's WebSockets now pass the network policy, a stopped runtime stops for
good, and a disposal finishes the session it was still building.

The policy gate was installed on the request route, and a WebSocket handshake is
never a request that route sees: a page could open a socket to any host the
operator had blocked, and the refusal the panel shows for every other kind of
destination simply never happened. A context now carries a socket route as well,
installed while it still has no page — Playwright only routes sockets created
after the registration — and a handshake the policy refuses is ended before the
destination is offered one. Since the default `allowedSchemes` lists `http` and
`https`, sockets are refused by that same default rather than quietly allowed;
`ws` and `wss` open them deliberately. A service worker dials from outside every
page, which puts its traffic past any route that covers pages, so a Browser
context blocks workers instead of leaving that way out unattributed.

A browser that finished starting after its runtime had been stopped was a
process nobody owned: `stop()` looked at what existed at the moment it was
called, so a launch still in flight published itself into a provider that had
already closed, and a context built that late was listed after the list was
emptied. Stopping is now a state the provider waits in — it drains the launch
and the context builds it already admitted, closes what they produced, and turns
away anything new until it is done — and a disposal joins the sessions still
being created before it sweeps the map, so a session that finishes building
during a shutdown is closed by that shutdown.
