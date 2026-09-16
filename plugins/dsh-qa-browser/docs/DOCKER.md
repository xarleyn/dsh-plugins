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
