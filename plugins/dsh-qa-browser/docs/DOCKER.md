# Running QA Browser with Harness in Docker

QA Browser launches Chromium in the same environment as the Harness Host. If
Harness runs in a container, Chromium and its Linux system libraries must be in
that container too. Installing a browser on the Docker host is not sufficient.

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

```yaml
runtime:
  mode: attach
  cdpEndpoint: http://chromium:9222
  # The endpoint is off this machine, which the default refuses.
  allowRemoteCdpEndpoint: true
```

Keep that endpoint on an internal network. Whoever can dial it controls that
browser outright — this plugin's own network policy is enforced by the Host on
the pages it drives, not by Chromium against whoever else connects. The policy
still gates every request of this plugin's sessions, but it decides by resolving
and classifying the name inside the Host container, while the sidecar dials with
its own resolver and its own `/etc/hosts`: give the two containers the same view
of a host that matters, or name addresses. The sidecar is still the deployment's
to install and harden: its seccomp profile, `/dev/shm` size and `--no-sandbox`
choice are the same decisions as above, just moved one container over.
