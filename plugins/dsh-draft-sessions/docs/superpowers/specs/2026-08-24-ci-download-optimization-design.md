# CI Download Optimization Design

## Goal

Reduce repeated tool and browser downloads in the main CI workflow without weakening its cross-platform checks or packed-package integration coverage.

## Design

- Replace `pnpm/action-setup` with the current `pnpm/setup@v2` action for pnpm 11, but retain `actions/setup-node`. The pnpm action's optional runtime setup downloads Node.js, while `setup-node` first reuses the runner's preinstalled Node.js tool cache and restores the pnpm store.
- Keep an explicit frozen dependency install so the quality gate remains visible and reproducible.
- Combine the Ubuntu quality check and package creation into the existing `package` job. Keep Windows as an independent quality-check job, and require both jobs before integration tests start. This removes one complete Ubuntu checkout/setup/install cycle.
- Cache Playwright browser binaries by operating system, architecture, and exact installed Playwright version. Always run the Playwright installer after cache restoration so it validates the cached revision and installs missing files safely.
- Install only Chromium's headless shell because the browser smoke test always launches Chromium with `headless: true` and no branded channel.
- Leave the release workflow unchanged: release builds intentionally avoid dependency caches and npm publication has separate supply-chain requirements.

## Failure Handling

- A cache miss falls back to Playwright's normal download and saves the successful browser installation for later runs.
- A Playwright upgrade changes the cache key and cannot reuse an incompatible browser revision.
- Packed smoke and browser jobs remain blocked unless both Linux packaging and Windows checks succeed.

## Verification

- Assert the old setup action and full Chromium installation are absent from `.github/workflows/ci.yml`.
- Assert the consolidated jobs, pnpm 11 setup, Playwright cache key, and `--only-shell` installer are present.
- Run Prettier over the workflow and the repository's full `pnpm check` quality gate.
