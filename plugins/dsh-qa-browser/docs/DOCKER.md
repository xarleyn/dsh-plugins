# Running QA Browser with Harness in Docker

By default (`runtime.mode: launch`) QA Browser launches Chromium in the same
environment as the Harness Host. If Harness runs in a container, Chromium and its
Linux system libraries must be in that container too. Installing a browser on the
Docker host is not sufficient. The other shape — Chromium in its own container,
which this plugin only joins — is at the end of this file.

The preferred production shape is a multi-stage image that installs the exact
Playwright version from the lockfile, runs `pnpm exec playwright install
--with-deps chromium` while building the image, and then starts Harness as an
unprivileged user. Keep `runtime.chromiumSandbox: true` (the default) and give
the container a Chromium-compatible seccomp profile. `--ipc=host` or a suitably
sized `/dev/shm` avoids Chromium crashes on image-heavy pages.

```dockerfile
FROM node:22-bookworm AS build
WORKDIR /app
COPY . .
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable \
 && pnpm install --frozen-lockfile \
 && pnpm exec playwright install --with-deps chromium \
 && pnpm --filter @yadsh/dsh-qa-browser build

FROM node:22-bookworm
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /ms-playwright /ms-playwright
COPY --from=build /app /app
WORKDIR /app
USER node
CMD ["pnpm", "dsh", "--profile", "qa-surface"]
```

For a browser installed at another absolute container path, set
`runtime.executablePath` to that *container* path. QA Browser never downloads a
browser at plugin startup or during `postinstall`.

Only when the surrounding container is independently hardened and Chromium
cannot start with its sandbox may `runtime.chromiumSandbox` be set to `false`.
That is an explicit security downgrade; do not make it a shared default.

## Chromium in its own container

`runtime.mode: attach` is the other shape: the Harness image carries no browser,
and Chromium runs in a sidecar container that opens its DevTools endpoint on a
network the Host can reach.

Write that endpoint as an address, not as a service name:

```yaml
runtime:
  mode: attach
  # The sidecar's address. A service name is refused by Chromium itself, below.
  cdpEndpoint: http://192.0.2.10:9222
  # The endpoint is off this machine, which the default refuses.
  allowRemoteCdpEndpoint: true
```

Chromium checks the `Host` header of every request to its DevTools server and
answers an IP address or `localhost` only. Any other name is refused by the
browser before this plugin has any say in it —
`HTTP 500 Host header is specified and is not an IP address or localhost` — and
the check guards both hops, the `/json/version` question an `http` endpoint asks
and the `ws` upgrade that answer names. So `http://chromium:9222` and
`http://host.docker.internal:9222` cannot be made to work by resolution, and
`--remote-allow-origins` is not the lever: it guards the `Origin` header, and the
name was still refused with it set. Nor does the `ws` form rescue it — the upgrade
carries the same header, so the "try connecting via ws://" advice Playwright
prints with this failure walks into the same refusal. Pin the sidecar's address on
the compose network, or share its network namespace and dial the loopback, which
needs no switch either:

```yaml
services:
  harness:
    network_mode: "service:chromium"
```

`allowRemoteCdpEndpoint` opens the gate in the Host; whether the browser on the
other side answers is the deployment's problem, and the session fails to start if
it does not.

Keep that endpoint on an internal network. Whoever can dial it controls that
browser outright — this plugin's own network policy is enforced by the Host on
the pages it drives, not by Chromium against whoever else connects. The policy
still gates every request of this plugin's sessions, but it decides by resolving
and classifying the name inside the Host container, while the sidecar dials with
its own resolver and its own `/etc/hosts`: give the two containers the same view
of a host that matters, or allow the addresses themselves. The sidecar is still
the deployment's to install and harden: its seccomp profile, `/dev/shm` size and
`--no-sandbox` choice are the same decisions as above, just moved one container
over.
