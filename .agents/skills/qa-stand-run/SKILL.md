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
`.env`, `secrets/`), not in this repo. What it carries is the pass itself: the
`docs/manual-testing/` playbooks and the evidence collector. `release-plugins`
§1b is the page that names those files and orders them for a wave, and this page
does not repeat it — a roster copied into the stand's skill is a roster that
later drifts from the wave's.

So: every kit name below — the playbooks and the collector §4 sends you to, the
`QA_HTTP_PORT` variable and the boot line §3 parses — belongs to the kit, and not
one of them is checkable from this repository. A disagreement is settled by the
kit, not by this page: follow the kit, report the disagreement, and correct the
skill.

On a machine that keeps a local slice briefing (`.private/guides/` in this
repo's main checkout: the slice path, its ports, its test accounts, the config
overrides already applied to it) read it first and take the coordinates from it.
Never invent a path, a port, an account or a password, and never put one of them
into a tracked file, a commit, a pull request or your report — the repository is
public.

If there is no briefing and the kit's README does not answer the question, ask
the maintainer rather than probing the network for it.

## 1. Before changing anything on a live stand

- **Do not start, stop, restart, recreate or wipe a stand you did not bring up.**
  "Yours" means this session brought it up and nothing else has touched it since.
  Anywhere else, prepare the change and ask; the restart is then one step for
  them (`shared-checkout` §5). The same test gates every repair in
  `references/troubleshooting.md`, including the ones that delete files.
- **Sync the kit before editing its config.** The slice is a synchronizable copy
  of the deployment, people are testing on it, and its configs may have moved
  under you; an unpulled edit silently reverts theirs. In the kit directory
  (`$KIT` hereafter — §0's checkout, not this repository):

  ```bash
  git -C "$KIT" status --porcelain -- config/dsh   # someone else's uncommitted edit
  git -C "$KIT" pull --ff-only                     # a refused pull is itself the answer
  ```

  A `status` that comes back non-empty, or a `pull` that refuses, means the state
  you were about to edit is not the state on disk: stop and ask whose edit it is.
  Do not `checkout`/`restore` the kit's config to make the pull pass — that is
  the very revert this step exists to prevent (`shared-checkout` §5). If the kit
  is not a git checkout, §0's rule applies: its README owns the update route, so
  ask for it instead of improvising a sync.
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
4. Apply the line — `docker compose restart qa`, or `up -d qa` when the override
   file itself changed (the new volume only mounts on recreate) — **only on a
   stand §1 calls yours.** On anyone else's rig, stop at the edited
   `plugins.txt` and say so in the report: reconciliation runs on the next start
   whoever triggers it, so what you hand over is one prepared step, not a restart
   you perform.
5. To go back, restore the released `@yadsh/...@x.y.z` line and put its restart
   through the same test.

**Tarball loop (`file:`).** `pnpm pack` in the plugin directory, drop the
`.tgz` into the kit's packages directory **with the version in its filename**,
and name it in `plugins.txt`. Reconciliation keys on the spec *line*: an
unchanged line means no reinstall, so swapping a rebuilt tarball under the same
filename deploys nothing.

Two more facts that cost hours when unknown:

- **`@latest` lines float.** Every reinstall pulls whatever is newest, so a
  reproduction needs an explicit pin. Together with the line-keyed reconciliation
  above, that is why deleting the profile's installed state is a re-pin decision
  and not a cleanup — see `references/troubleshooting.md` §The stack does not
  come up.
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
  it survives port changes and moves — so take the token from the boot log. The
  recipe assigns it and prints only its length, never the value, and it keeps
  the log command's own failure apart from a capture that matched nothing:

  ```bash
  if LAUNCH_LOG=$(docker compose logs qa); then
    LAUNCH_TOKEN=$(printf '%s\n' "$LAUNCH_LOG" \
      | sed -n 's/.*[^A-Za-z0-9_]token=\([^&"[:space:]]*\).*/\1/p' | tail -1)
    if [ -n "$LAUNCH_TOKEN" ]; then
      echo "launch token: ${#LAUNCH_TOKEN} characters, taken from the boot log"
    else
      echo "launch token: NOT FOUND — compose answered, so this is the boot line" \
           "not matching the pattern, not a dead stand"
    fi
  else
    echo "compose produced no log at all (its own error is above) — there is" \
         "nothing to capture: check the service name, compose, and the daemon"
  fi
  ```

  `grep -o` is the mistake this replaces: its output is a command result, so the
  value lands in the session transcript. Interpolate `"$LAUNCH_TOKEN"` into the
  one request that needs it; the token and the operator URL carrying it stay out
  of every log, screenshot, report and pull request (`Do not touch`).
  `compose logs` writes the container's log to stdout and its own complaints to
  stderr, and there is no `2>&1` here on purpose — merging them would feed a
  daemon error into the pattern and let it be reported as a moved boot line. Both
  variables hold a credential: print the length, never the value.

  The boot line's own format lives in the kit and cannot be checked from this
  repository, so know what this pattern buys and what it does not. The
  `[^A-Za-z0-9_]` before `token=` rejects a `refresh_token=` sharing the line, and
  the value class stops at `&`, a quote or whitespace — so a token carrying `.`,
  `+`, `=` or `:` is taken whole instead of cut at its first dot. That boundary
  costs a match, though: a `token=` that opens a line has no character in front of
  it to satisfy the class, so it is missed — one more reason a NOT FOUND is read
  as "the line is not what this assumes", never as "the stand is down". `.*` is
  greedy, so a line with two *standalone* `token=` parameters yields the last one,
  and the length is the only thing about the value you may print: it is how you
  notice a six-character capture.

  The two empty outcomes are different findings and must not share a diagnosis.
  "compose answered, nothing matched" is about the boot line's format, and the
  kit's README is where that is settled — do not swap in another regex.
  "compose produced no log" is about a broken command, and its next look is
  `docker compose ps`, not the README. Either way, never point an unverified
  value at the operator API.

  A launch token expires while a live harness keeps running, so a `401 dsh web
  authentication required` is usually a stale token — but only once you know the
  value came from the operator URL's own parameter: a capture of the wrong
  `token=` answers `401` the same way, and re-issuing it is not a fix.
- The built client bundle is served at `/plugins/<full-package-name>/client.js`,
  the scoped path (AGENTS.md) — fetch that URL to prove which build the browser
  actually got.
- Accounts: use the ones the local briefing names, or register one through the
  plugin's own CLI inside the container. The installed `.bin` shims can answer
  empty with exit code 0 while changing nothing — invoke the CLI by its full
  path under the profile's `node_modules` and re-read the list to confirm.

## 4. Run the pass, and prove it

1. Pick the playbook for the occasion you are in — `release-plugins` §1b orders
   the kit's set and is its only roster here. Follow the steps as written and
   deviate only where a step fails — then record the deviation, because a step
   that fails is a finding, not an inconvenience.
2. Do not conclude "the stand is unreachable" from one failed probe: re-check
   later. Do not scan the network for it.
3. Collect evidence rather than asserting health: run the kit's collector over
   the logs and let its exit code say the result. What a recorded round must
   leave behind is `release-plugins` §1b step 3; a pass that leaves nothing is
   not evidence, whatever the gates said.
4. UI findings are measured, not eyeballed — see
   `create-plugin/references/client-side.md` §Proving a UI change beyond the
   gates.
5. Client-side changes are visible after a rebuild and a page reload; host-side
   changes are not visible without a restart. On a stand §1 calls yours, restart
   and re-check. On anyone else's, verify the change with tests and end the
   report with "needs a restart" rather than performing one.

## 5. Report template

```text
stand:    <which slice, which build/line each plugin came from>
restart:  <performed — this session brought the stand up | not performed — whose
          rig, and the one step you asked for>
checked:  <playbook + the rows you walked>
result:   PASS/FAIL per row, with the log line or measurement that proves it
fell:     <what broke, its symptom text, the issue it belongs to>
untouched: <what you deliberately did not change, and whose config/edit it was>
```

A finding needs the refusal's own text, not a paraphrase — the stand's
symptom-to-cause table keys on that text.

## Do not touch

- Another account's chats and profile, and the operator's own working data.
- A stand you did not bring up: its container lifecycle (`restart`, `up -d`,
  `down`) and its installed state — the profile's `node_modules`, its lock file
  and `data/`, which the repairs in `references/troubleshooting.md` delete.
  Prepare the step, then ask.
- The "reset overrides" control on an integrations card: overrides are the only
  place some instances exist, so it removes them for the whole stand. A
  provider's enable checkbox is per-provider; "plugin enabled" is global — those
  are different levers.
- The kit's local files: `.env`, `secrets/`, root-level `qa-*.json` and the
  compose override are usually not in the kit's `.gitignore`, so `git add -A`
  commits them. Stage explicit paths.
- Any credential: never echo a token into a log, a screenshot, a PR or this
  repository. The operator URL is a credential — it carries the token — so the
  same refusal covers pasting it, and the report names the port, not the URL.

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
