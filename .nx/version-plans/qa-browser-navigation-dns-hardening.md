---
"@yadsh/dsh-qa-browser": patch
---

Re-check DNS immediately before the browser dials a host.

The Browser network policy resolved every destination host server-side and
refused private, link-local and metadata answers, but the connection itself is
made by Chromium, which resolves through its own recursive resolver. An
authoritative DNS answerer under an attacker's control is free to hand the two
resolvers different answers, so a hostname that checked out cleanly could still
land the browser on an internal address.

Every request now passes a double resolve just before Playwright lets it
continue: the host is resolved a second time and compared with the address set
the policy check just verified, and a divergence — including a host that stops
resolving — is refused with the same `BROWSER_HOST_BLOCKED` taxonomy as the
original check, so redirects and subresource requests surface the stable
security error as before. A residual TOCTOU remains, because a DNS that pins
its answers per resolver can still serve Chromium a different answer after the
gate; the check narrows the rebinding window to hostile answerers that are
additionally inconsistent under rapid repetition, and this limit is documented
in the plugin's implementation note.
