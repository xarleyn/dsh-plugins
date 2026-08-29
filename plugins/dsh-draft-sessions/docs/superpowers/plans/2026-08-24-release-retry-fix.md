# Release Retry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make npm tarball publication unambiguous and allow the manual release workflow to retry an existing GitHub Release safely.

**Architecture:** Resolve the downloaded tarball to an absolute filesystem path before passing it to `npm publish`, preventing npm from interpreting `release/<file>` as a GitHub shorthand. Make the GitHub Release step create a missing release or replace assets on an existing release without rewriting its metadata.

**Tech Stack:** GitHub Actions, Bash, GitHub CLI, npm Trusted Publishing.

---

### Task 1: Define failing release workflow contracts

**Files:**

- Test: `.github/workflows/release.yml`

- [ ] **Step 1: Assert safe npm path handling**

Run a PowerShell assertion requiring an empty-result guard and `npm publish "$(realpath "$package")"`.

Expected: FAIL because the workflow passes `release/<tarball>.tgz` directly to npm.

- [ ] **Step 2: Assert idempotent GitHub Release handling**

Run a PowerShell assertion requiring both `gh release view "$RELEASE_TAG"` and `gh release upload "$RELEASE_TAG" release/* --clobber`.

Expected: FAIL because the workflow always executes `gh release create`.

### Task 2: Make GitHub Release retries idempotent

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Preserve creation arguments**

Keep the existing release title, generated notes, verified tag, and prerelease arguments for a new release.

- [ ] **Step 2: Branch on release existence**

Use `gh release view "$RELEASE_TAG"` to detect an existing release. Replace its package and checksum assets with `gh release upload "$RELEASE_TAG" release/* --clobber`; otherwise execute the existing `gh release create` command.

### Task 3: Publish the local tarball unambiguously

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Resolve and validate the artifact**

Capture the first `release/*.tgz` path, fail with a clear message if it is absent, and resolve it with `realpath`.

- [ ] **Step 2: Publish the absolute path**

Pass the resolved tarball path to `npm publish` with the existing access and dist-tag arguments.

### Task 4: Verify and commit

**Files:**

- Verify: `.github/workflows/release.yml`

- [ ] **Step 1: Re-run structural assertions**

Expected: PASS for absolute tarball publication and create-or-upload GitHub Release behavior.

- [ ] **Step 2: Validate shell fragments and formatting**

Run the changed Bash fragments through `bash -n` and parse the workflow with Prettier.

- [ ] **Step 3: Run the repository quality gate**

Run `pnpm check` and expect all checks to pass.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/release.yml
git commit -m "fix: make release publication retryable"
```
