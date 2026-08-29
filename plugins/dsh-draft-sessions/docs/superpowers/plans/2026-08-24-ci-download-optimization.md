# CI Download Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeated Node.js, pnpm, dependency, and Chromium downloads while preserving all current CI checks.

**Architecture:** The Ubuntu check becomes the package-producing prerequisite, while a separate Windows check retains platform coverage. All test jobs use the current pnpm 11 action, reuse Node.js from the runner tool cache, and restore the pnpm store; the browser job adds a versioned Playwright binary cache and installs only the headless Chromium shell.

**Tech Stack:** GitHub Actions, pnpm 11, Node.js 24, Playwright 1.62.

---

### Task 1: Define the workflow contract

**Files:**

- Test: `.github/workflows/ci.yml`

- [ ] **Step 1: Run a failing structural assertion**

Run a PowerShell assertion that requires `pnpm/setup@v2`, `actions/setup-node@v7`, a `check-windows` job, an `actions/cache` Playwright step, and `--only-shell`; rejects `pnpm/action-setup`; and rejects downloading Node through the pnpm action's `runtime` input.

Expected: FAIL because the current workflow still uses `pnpm/action-setup` and downloads full Chromium.

### Task 2: Consolidate setup and packaging

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the check matrix**

Keep `package` as the Ubuntu job, run `pnpm check` there before packing, and add a parallel `check-windows` job that runs the same quality gate.

- [ ] **Step 2: Replace repeated setup steps**

Use this setup in every CI job. `pnpm/setup` installs the package manager, while `setup-node` reuses the runner tool cache for Node.js and restores the pnpm store:

```yaml
- name: Install pnpm
  uses: pnpm/setup@v2
  with:
    install: false

- name: Install Node.js
  uses: actions/setup-node@v7
  with:
    node-version: 24
    cache: pnpm

- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

- [ ] **Step 3: Preserve downstream gates**

Make both `packed-smoke` and `browser-e2e` depend on `[package, check-windows]`, while continuing to read their DSH matrix from `needs.package.outputs.dsh_matrix`.

### Task 3: Cache the minimal browser distribution

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read the installed Playwright version**

Expose `require('playwright/package.json').version` through a Bash step output.

- [ ] **Step 2: Restore the browser cache**

Cache `~/.cache/ms-playwright` with the exact key `playwright-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright.outputs.version }}`.

- [ ] **Step 3: Install safely**

Always run `pnpm exec playwright install --with-deps --only-shell chromium`; a cache hit avoids the browser download while the command still validates the installation and ensures Linux dependencies exist.

### Task 4: Verify and commit

**Files:**

- Verify: `.github/workflows/ci.yml`

- [ ] **Step 1: Re-run the structural assertion**

Expected: PASS for the new setup, job dependencies, versioned browser cache, and headless-only install.

- [ ] **Step 2: Validate formatting and repository checks**

Run:

```powershell
pnpm exec prettier --check .github/workflows/ci.yml --end-of-line auto
pnpm check
```

Expected: both commands exit successfully.

- [ ] **Step 3: Commit the implementation**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: reduce repeated CI downloads"
```
