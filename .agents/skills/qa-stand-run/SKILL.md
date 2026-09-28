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

## 0. Get the stand's coordinates before you touch anything

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

The coordinates of a slice — where it lives on the machine, its ports, its test
accounts, the config overrides already applied to it — are not in this
repository and are not in this skill: the repository is public and a stand is a
real deployment. Ask the operator of the rig, or read them off the kit's own
README. A machine may keep them in notes the repository does not track, and its
operator can hand you those notes, but no step here depends on one existing:
this page deliberately does not say where such notes live, so a fresh clone is
never missing a file the recipe needs. Never invent a path, a port, an account
or a password, and never put one of them into a tracked file, a commit, a pull
request or your report.

If the operator does not answer and the kit's README does not either, ask the
maintainer rather than probing the network for it.

## 1. Before changing anything on a live stand

- **Do not start, stop, restart, recreate or wipe a stand you did not bring up,
  and do not write into its `config/dsh/`.** "Yours" means this session
  brought it up and nothing else has touched it since. Anywhere else, prepare the
  change and ask; the restart is then one step for them (`shared-checkout` §5).
  The same test gates every repair in `references/troubleshooting.md`, including
  the ones that delete files. It gates a config edit for the reason the `pull`
  bullet below gives: the edit waits for the next start, and the next start may be
  one nobody asked for.
- **Check the kit against its upstream before editing its config.** The slice is
  a synchronizable copy of the deployment, people are testing on it, and its
  configs may have moved under you. `$KIT` hereafter is that checkout — §0's
  directory, not this repository. It is also where every `docker compose` command
  in this skill runs, because that is where compose finds its configuration file:
  from the repository directory it reads no file at all, and its own refusal is
  the misdiagnosis §3 works to avoid.

  ```bash
  # §0 owns this path; without it an unset $KIT acts where you happen to stand
  if [ ! -d "$KIT/config/dsh" ]; then
    echo "not the kit's directory — these three commands did not run; §0 owns" \
         "this path"
  else
    # did someone else edit a tracked config? untracked kit files are noise
    git -C "$KIT" status --porcelain --untracked-files=no -- config/dsh
    git -C "$KIT" fetch --quiet                 # writes .git only, never the tree
    git -C "$KIT" rev-list --count HEAD..@{u}   # behind; no upstream = fatal
  fi
  ```

  The guard comes first because an unset `$KIT` does not fail. Measured: `git -C ""`
  returns 0 and acts on **this repository** — the config check then reads a clean
  tree that is not the kit's, and the `pull` form moves this checkout instead of
  the kit's — while `cd ""` returns 0 and leaves the shell where it was, which for
  §3 is the repository directory, where compose reads no file at all. A shell
  taking the POSIX empty-argument branch would land in `$HOME` instead, and a
  compose file living there answers with someone else's stack; not reproducible on
  this shell, and the guard makes the two readings equally irrelevant. A path that
  is set but absent does fail, loudly: `git -C` prints `fatal: cannot change to`
  with a non-zero code. `config/dsh` is the marker because §1 says the entrypoint
  reconciles from that directory; a kit whose config sits elsewhere is a
  disagreement §0 settles in the kit's favour, and the guard's own refusal is the
  loud kind.

  `fetch` is the whole step, and that is the point: it moves no file under
  `config/dsh/`, so it cannot change what a running stand re-applies on its next
  start. Moving the working tree onto what upstream holds is a `pull`, and a
  `pull` answers to the same test as a restart, because §1 says what a restart
  does — the entrypoint re-applies `config/dsh/` over the installed profile on
  *every* start, including one nobody asked for, since a crash loop restarts
  itself. On a rig this session did not bring up, a fast-forward therefore
  exchanges the deployment under the person reproducing something on it.

  Read the answers and act on each:
  - a non-empty `status` is someone's uncommitted edit: stop and ask whose, and
    do not `checkout`/`restore` the kit's config to clear it — that is the very
    revert this step exists to prevent (`shared-checkout` §5);
  - a non-zero behind-count on a rig that is not yours is reported, not fixed:
    prepare the edit against what is on disk and say the kit is N commits behind,
    because ordering the sync is the operator's call, not yours;
  - a sync on a stand §1 calls yours takes the `pull --ff-only` form: it refuses a
    diverged kit instead of merging into it, and that refusal is itself the
    answer. A fatal `rev-list` means the branch has no upstream to compare with;
    a kit that is no git checkout at all falls back to §0 — its README owns the
    update route, so ask for it instead of improvising a sync.

  `--untracked-files=no` is deliberate and asks a narrower question — the kit's
  local files (`.env`, `secrets/`, the compose override; see *Do not touch*) are
  usually not in its `.gitignore`, so counting untracked paths here would stop the
  step on files nobody edited. `shared-checkout` §7 makes the same choice for the
  same test, and the case it gives up is not lost: a sync that would land a file
  over an untracked local one is refused by `pull` itself.
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

**Both loops end by writing `config/dsh/`, and §1's test gates that write, not
only the start that follows it.** A `plugins.txt` line is not a note to yourself:
the next start reconciles from whatever the file holds, and the next start may be
another person's or a crash loop's. So on a rig this session did not bring up,
name the override file, the mount path and the exact spec line in the ask, and
write none of them — what you hand over is a prepared *edit*, which becomes the
deployment the moment they run it, not an inert draft.

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
   file itself changed (the new volume only mounts on recreate), either one run
   in `$KIT`. A `link:` spec is a live directory rather than a frozen version, so
   every later start builds the rig from whatever that worktree holds at the
   moment it runs. Name the linked worktree and its branch in the report: it is
   one lane's checkout, and whoever restarts after you inherits its code (§1).
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
  recipe assigns it and prints only its length, never the value; it refuses an unset
  `$KIT` before the stand is asked anything (§1's guard — the stand cannot be blamed
  for a variable that was never set), and it keeps the three ways an empty answer
  happens apart: compose refusing, compose answering with nothing logged, and a log
  whose boot line the pattern misses.

  ```bash
  if [ ! -d "$KIT/config/dsh" ]; then
    echo "launch token: NO KIT — \$KIT is unset or is not the kit's directory, so" \
         "nothing below ran and the stand has not been asked anything: §0 owns it"
  elif LAUNCH_LOG=$(cd "$KIT" && docker compose logs qa); then
    if [ -z "$LAUNCH_LOG" ]; then
      echo "launch token: NO LOG YET — compose answered with an empty log, so the" \
           "pattern never had a line to miss: the container has printed nothing" \
           "(freshly recreated, gone before it boots, or logs not captured)." \
           "What the rig is doing:"
      (cd "$KIT" && docker compose ps)
    else
      LAUNCH_TOKEN=$(printf '%s\n' "$LAUNCH_LOG" \
        | sed -nE "s/.*(^|[^A-Za-z0-9_-])token=([^&#\"'[:space:]]*).*/\2/p" | tail -1)
      if [ -n "$LAUNCH_TOKEN" ]; then
        echo "launch token: ${#LAUNCH_TOKEN} characters, taken from the boot log"
      else
        echo "launch token: NOT FOUND — compose answered with a log that carries" \
             "no standalone token=: the boot line's format moved, the stand's" \
             "state did not"
      fi
    fi
  else
    echo "compose would not answer at all (its own error is above) — there is" \
         "nothing to capture: what is left is the service name, compose, the" \
         "daemon, and a compose file that is not at \$KIT's root (§0)"
  fi
  ```

  `grep -o` is the mistake this replaces: its output is a command result, so the
  value lands in the session transcript. `compose logs` writes the container's
  log to stdout and its own complaints to stderr, and there is no `2>&1` here on
  purpose — merging them would feed a daemon error into the pattern and let it be
  reported as a moved boot line. The `cd` sits inside the substitution for the
  same reason: it points compose at the
  kit's configuration and leaves your shell where it was, and running this from
  the repository directory would ask compose to read no file at all — your own
  mistake reaching you as the branch that blames the stand. Both variables hold
  a credential: print the length, never the value.

  Passing the variable on is the next mistake. An expanded value in a command's
  argument list is argv, and argv is readable in the process list, while the line
  you typed stays in shell history — the two carriers
  `docs/MANUAL_VERIFICATION.md` §1 refuses for a probe token, and this token is
  the same kind of secret. Hand it to the one request over a channel the tool
  reads instead of an argument it publishes:

  ```bash
  OPERATOR_URL="<the kit's loopback operator URL>?token=$LAUNCH_TOKEN"
  printf 'url = "%s"\n' "$OPERATOR_URL" |
    curl -q -sS --config - -o /dev/null -w 'operator: %{http_code}\n'
  ```

  `-q` is the option that keeps this off the transcript, and it only works in
  first position. `curl` reads the user's own `~/.curlrc` *before* the command
  line, and `--config -` does not cancel that read — so a `verbose`, `trace` or
  `trace-ascii` sitting in that file prints the very request carrying the token,
  into the same stdout and stderr that this round's transcript is. Measured on
  curl 8.18.0 (Windows build) against a stub answering 200, with `verbose` in the
  rc: without `-q` the output names the rc file it read — a machine-local path —
  then the request line `> GET /admin?token=AbCd.123+xy:99 HTTP/1.1`, then the
  response headers, `< Set-Cookie: dsh_session=…` among them. So verbosity puts
  back both halves this recipe decided not to keep: the token, and the headers a
  `-o /dev/null -w` call discards on purpose. With `-q` *after* `-sS` the rc is
  still read and still prints it; `-q` first is the only form that yields a bare
  `operator: 200`. `--config -` itself — config text from standard input — is
  behaviour that varies with the build, which is why the version above is named.
  If a curl refuses this form, report the refusal and curl's own message; the
  repair is not to move the token back into the arguments, which
  `docs/MANUAL_VERIFICATION.md` §1 refuses for exactly this kind of secret.

  The assignment is the shell's own and `printf` is a bash builtin, so the value
  goes into the pipe without becoming an argument and the transcript shows the
  variable name; `curl` takes the URL from stdin, and on a refused connection its
  own error named the host and port, not the query. Typing the URL does not
  satisfy the rule: pasting the expanded value into a command line leaves it in
  history. Read `000` as that case, not as the surface refusing you: `%{http_code}`
  prints it when no response arrived at all, and a connection that refused is a
  finding about the pipe — §4 step 2 is what to do with one failed probe, and a
  `401` is the different finding `references/troubleshooting.md` works.

  `-o /dev/null -w '%{http_code}'` is what keeps the proof out of the transcript.
  What this request proves is *that the operator surface answered*, and the status
  code says that on its own. Neither half of the reply is kept: the body is
  whatever the operator page renders — accounts, chats, the stand's own data — so
  writing it as the round's evidence would put a live rig's data into a file that
  then travels into the report, the pull request and the public history; and the
  response headers are a carrier the same way, since a redirect answers with
  `Location:` and an authenticated reply with `Set-Cookie` — the surface is
  described as authorising a role from its cookie in
  `references/troubleshooting.md`, whose cause column is the host's to confirm.
  The risk is enough: nothing here knows what the deployment answers with, so the
  round records the number and no header line. Headers are looked at only to
  diagnose a code the round cannot explain, and what that look prints is
  diagnosis, not evidence.

  Verifying afterwards is not comparing the artifact with the token. Grepping a
  saved file for `"$LAUNCH_TOKEN"` moves the value back into argv and shell
  history, and a printed match lands it in the transcript the round records — a
  check that has to name the secret to run is a second capture of it, not a proof.
  The token and the operator URL carrying it stay out of every log, screenshot,
  report and pull request, out of argv and history, and out of the evidence files
  (`Do not touch`).

  The boot line's own format lives in the kit and cannot be checked from this
  repository, so know what this pattern buys and what it does not, on the fake
  lines it was run against: the boundary group `(^|[^A-Za-z0-9_-])` rejects a key
  joined to `token` by `-` or `_` — `access-token=`, `refresh_token=`, `notoken=`
  give no capture — and the `^` alternative lets a `token=` that opens a line
  match, so a miss means the format moved, never that the stand is down. The
  value class stops at `&`, `#`, either quote or whitespace: a token carrying
  `.`, `+`, `=` or `:` is taken whole, a `#fragment` after it is not, and a quoted
  `token='abc'` yields an empty capture rather than a value wrapped in quotes —
  the recipe reads that as NOT FOUND and sends you to the kit's README. `.*` is
  greedy, so a line with two *standalone* `token=` parameters yields the last
  one, and `tail -1` takes the last matching line; that is the residue this
  pattern does not buy off, and the length is the only thing about the value you
  may print — it is how you notice a six-character capture.

  The three empty answers are different findings and must not share a diagnosis,
  and the guard's refusal is not one of them: it says the kit was never located,
  so no command reached a rig and the stand holds no finding yet. "compose would
  not answer" is about the command, and once §1's guard has passed what is left
  for it is the service name, compose itself, the daemon, and a compose file that
  is not at the kit's root. "compose answered with no log" is about the state of
  the stand, which is why the branch prints `docker compose ps` there — a
  container that has not reached the boot line is a rig
  finding, and `references/troubleshooting.md` §The stack does not come up is where
  a stand that will not boot is worked. "compose answered with a log and nothing
  matched" is about the boot line's format, and the kit's README is where that is
  settled — do not swap in another regex. Either way, never point an unverified
  value at the operator API.

  A launch token expires while a live harness keeps running, so a `401 dsh web
  authentication required` is usually a stale token — but only once you know the
  value came from the operator URL's own parameter: a capture of the wrong
  `token=` answers `401` the same way, and re-issuing it is not a fix.
- The built client bundle is served at `/plugins/<full-package-name>/client.js`,
  the scoped path (AGENTS.md) — fetch that URL to prove which build the browser
  actually got.
- Accounts: use the ones the operator named with the coordinates (§0), or register
  one through the plugin's own CLI inside the container. The installed `.bin` shims
  can answer empty with exit code 0 while changing nothing — invoke the CLI by its
  full path under the profile's `node_modules` and re-read the list to confirm.

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
   not evidence, whatever the gates said. Evidence is public text before it is
   anything else — a log tail from a live rig names hosts, accounts and paths —
   so the marker sweep `release-plugins` §0 runs before a release runs over it
   too, before the round's report goes out and again before the pull request.
4. UI findings are measured, not eyeballed — see
   `create-plugin/references/client-side.md` §Proving a UI change beyond the
   gates.
5. Client-side changes are visible after a rebuild and a page reload; host-side
   changes are not visible without a restart. On a stand §1 calls yours, restart
   and re-check. On anyone else's, verify the change with tests and end the
   report with "needs a restart" rather than writing their `config/dsh/` or
   performing one.

## 5. Report template

```text
stand:    <which slice, which build/line each plugin came from>
restart:  <performed — this session brought the stand up | not performed — whose
          rig, and the config write and the start you asked for instead>
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
  `down`), its `config/dsh/` — reached either through the kit's working tree (a
  `pull` rewrites it) or by editing a spec line yourself — since the next start,
  asked for or not, re-applies what that directory holds, and its installed state
  — the profile's `node_modules`, its lock file and `data/`, which the repairs in
  `references/troubleshooting.md` delete. Prepare the step, then ask.
- The "reset overrides" control on an integrations card: overrides are the only
  place some instances exist, so it removes them for the whole stand. A
  provider's enable checkbox is per-provider; "plugin enabled" is global — those
  are different levers.
- The kit's local files: `.env`, `secrets/`, root-level `qa-*.json` and the
  compose override are usually not in the kit's `.gitignore`, so `git add -A`
  commits them. Stage explicit paths.
- Any credential: never echo a token into a log, a screenshot, a PR or this
  repository, and never let one become a command argument or typed text — argv is
  in the process list and the typed line is in shell history (§3). A curl that was
  not given `-q` first adds a third carrier: its own `~/.curlrc` is read before the
  command line, and a verbosity setting there prints that request's own line and
  the response headers with it (§3). The operator URL is a credential — it carries
  the token — so the same refusal covers pasting
  it, and the report names the port, not the URL. Nor is a credential evidence:
  the operator request proves itself with its status code alone — the body it
  would render is the stand's data, and the headers it answers with can carry the
  token back or open a session, so neither is kept (§3).
- The machine-local notes that carry a stand's coordinates. The repository's
  tracked `.gitignore` ignores that directory in every clone, which is the
  protection a per-checkout exclusion never was; `git add -f` on a path there is
  still the leak, and it is the one thing this directory makes easy.

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
