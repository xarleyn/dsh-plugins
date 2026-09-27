---
name: qa-stand-run
description: Bring up or reuse the local QA stand slice, link a plugin from this
  monorepo into it, and run the deployment kit's manual playbooks and collect
  the evidence — instead of inventing the steps again. Use when the user says
  "подними стенд", "линкуй недостающие плагины в dev стенд", "проверь на
  стенде", "запусти смоук", "пройди плейбук", "не отправляются запросы на dev
  стенде", or before any claim that a plugin change works for a user.
---

# Run the QA stand

Green gates prove the code; a deployment is proven on a stand. This skill is the
route: reach the stand, get your plugin into it, run the playbook, and hand back
a report with evidence. The refusals that are not on this route are in
`references/troubleshooting.md`.

**The one invariant:** the stand is a shared rig, not your scratch pad. The
config directory is the source of truth the container re-applies on every start,
so anything you change through the UI is provisional, and anything you restart
belongs to someone else.

## 0. Read the local briefing before you touch anything

The stand lives in a deployment kit checkout (a `qa-deploy-docker/`-style
directory beside this repository: its compose file, `config/dsh/`, `data/`,
`.env`, `secrets/`), not in this repo. Its playbook files are the version that
travels:

- `docs/manual-testing/smoke.md` — after every deploy;
- `docs/manual-testing/wave.md` — release-wave acceptance, one row per changed
  package: package → manual check → evidence;
- `docs/manual-testing/signatures.md` — refusal text → cause → action;
- `scripts/qa-smoke-evidence.mjs` — collects the evidence from the plugin logs
  and exits non-zero on a FAIL.

On a machine that keeps a local slice briefing (`.private/guides/` in this
repo's main checkout: the slice path, its ports, its test accounts, the config
overrides already applied to it) read it first and take the coordinates from it.
Never invent a path, a port, an account or a password, and never put one of them
into a tracked file, a commit, a pull request or your report — the repository is
public.

If there is no briefing and the kit's README does not answer the question, ask
the maintainer rather than probing the network for it.

## 1. Before changing anything on a live stand

- **Do not start, stop or restart a stand you did not bring up.** Prepare the
  change and ask; the restart is then one step for them
  (`shared-checkout` §5).
- **Pull the kit's settings state before editing it.** The slice is a
  synchronizable copy of the deployment, people are testing on it, and its
  configs may have moved under you; an unpulled edit silently reverts theirs.
- `config/dsh/plugins.txt` is the only source of truth for which plugins run:
  the entrypoint reconciles the profile from it on every container start — new
  or changed specs install, removed ones disappear.
- **A restart re-applies `config/dsh/` over the installed profile and
  settings.** So a knob turned in the operator UI does not survive a restart:
  encode it in the config file instead. `.env` is re-read only when the
  container is *recreated* (`up -d`), not by `restart` — the boot log line that
  prints the effective default model says which one actually applied.
- **Never run the kit's `install.sh` against a stand that is in use** — it
  overwrites the live profile and presets unconditionally.

## 2. Link a plugin from this repository into the slice

Two loops. Prefer the tarball loop when the answer must be "as released", and
the source loop while iterating.

**Source loop (`link:`).**

1. Build first, in dependency order: `packages/*` are not built by git and nx
   reports success over a tree with no `lib/` (see
   `create-plugin/references/release-and-gates.md` §Build order). The linked
   directory must already contain `lib/` and `client.js`.
2. Add the kit's local compose override that mounts this repository into the
   container, and create the mount point on the host **before** `up`: Docker
   cannot create a mount point inside a read-only bind, and a missing directory
   fails the whole `up`. A cleanup that deletes that empty directory breaks the
   stack the same way.
3. Point the plugin's line in `plugins.txt` at the mounted source using the
   **absolute container path** under the mount the kit documents for
   `config/dsh/`. A *relative* `link:` resolves against the profile directory,
   installs nothing, and leaves the old store version in place — no error,
   no log line, just stale behavior.
4. `docker compose restart qa` (or `up -d qa` when the override file itself
   changed — the new volume only mounts on recreate).
5. To go back, restore the released `@yadsh/...@x.y.z` line and restart.

**Tarball loop (`file:`).** `pnpm pack` in the plugin directory, drop the
`.tgz` into the kit's packages directory **with the version in its filename**,
and name it in `plugins.txt`. Reconciliation keys on the spec *line*: an
unchanged line means no reinstall, so swapping a rebuilt tarball under the same
filename deploys nothing.

Two more facts that cost hours when unknown:

- **`@latest` lines float.** Every reinstall pulls whatever is newest, so a
  reproduction needs an explicit pin.
- **Outside the main checkout run with `NX_DAEMON=false NX_SKIP_NX_CACHE=true`.**
  The daemon and the cache are shared across worktrees and will replay another
  lane's build and report phantom success (`docs/VERIFICATION.md` §The Nx cache
  in a worktree).

## 3. Reach it

- Client surface: the kit's client port from its `.env` (`QA_HTTP_PORT`), path
  `/qa`. Do not hardcode a port into a check — carrying one stand's port to
  another was itself a defect.
- Operator surface: the loopback port on the machine running the container,
  opened with the **launch token**. `data/admin-url.txt` is not authoritative —
  it survives port changes and moves — so take the token from the boot log:

  ```bash
  docker compose logs qa | grep -o "token=[A-Za-z0-9_-]*" | tail -1
  ```

  A launch token expires while a live harness keeps running, so a `401 dsh web
  authentication required` is usually a stale token, not a broken host layer.
- The built client bundle is served at `/plugins/<full-package-name>/client.js`,
  the scoped path (AGENTS.md) — fetch that URL to prove which build the browser
  actually got.
- Accounts: use the ones the local briefing names, or register one through the
  plugin's own CLI inside the container. The installed `.bin` shims can answer
  empty with exit code 0 while changing nothing — invoke the CLI by its full
  path under the profile's `node_modules` and re-read the list to confirm.

## 4. Run the pass, and prove it

1. Pick the playbook: `smoke.md` after any deploy, `wave.md` for a wave,
   `signatures.md` when something refuses. Follow the steps as written and
   deviate only where a step fails — then record the deviation, because a step
   that fails is a finding, not an inconvenience.
2. Do not conclude "the stand is unreachable" from one failed probe: re-check
   later. Do not scan the network for it.
3. Collect evidence rather than asserting health: the kit's evidence collector
   reads the plugin logs and returns non-zero on a FAIL. Green gates plus a
   round without a written protocol and evidence means the round did not happen.
4. UI findings are measured, not eyeballed — see
   `create-plugin/references/client-side.md` §Proving a UI change beyond the
   gates.
5. Client-side changes are visible after a rebuild and a page reload;
   host-side changes are not visible without a restart, so verify those with
   tests and end the report with "needs a restart" rather than performing one.

## 5. Report template

```text
stand:    <which slice, which build/line each plugin came from>
checked:  <playbook + the rows you walked>
result:   PASS/FAIL per row, with the log line or measurement that proves it
fell:     <what broke, its symptom text, the issue it belongs to>
untouched: <what you deliberately did not change, and whose config/edit it was>
```

A finding needs the refusal's own text, not a paraphrase — the stand's
symptom-to-cause table keys on that text.

## Do not touch

- Another account's chats and profile, and the operator's own working data.
- The "reset overrides" control on an integrations card: overrides are the only
  place some instances exist, so it removes them for the whole stand. A
  provider's enable checkbox is per-provider; "plugin enabled" is global — those
  are different levers.
- The kit's local files: `.env`, `secrets/`, root-level `qa-*.json` and the
  compose override are usually not in the kit's `.gitignore`, so `git add -A`
  commits them. Stage explicit paths.
- Any credential: never echo a token into a log, a screenshot, a PR or this
  repository.

## References

- `references/troubleshooting.md` — symptom → likely cause → first action for a
  stand that refuses (restart loop, `composition-mismatch`, attestation and
  tool-catalog refusals, missing cards, dead token).
- Related skills: `shared-checkout` (whose rig and whose WIP this is),
  `create-plugin` (building and verifying the plugin you are about to link),
  `release-plugins` (the wave this stand pass is accepting).
- Canonical: `docs/VERIFICATION.md` §Stand acceptance,
  `docs/MANUAL_VERIFICATION.md` (per-provider probes against a real instance),
  the deployment kit's `docs/manual-testing/`.
