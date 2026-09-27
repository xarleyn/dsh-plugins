# Stand refusals: symptom → likely cause → first action

The class of bug where one symptom has five causes. Work the list in order and
say which one you ruled out: most stand "defects" are a pin, an entitlement or a
policy refusing, not a code fault, and editing code to chase them costs a round.

**Two rules before any repair:** one failed probe does not mean the stand is
down — re-check later instead of scanning the network for it; and never restart
or wipe a rig another person brought up (see `SKILL.md` §1).

## The stack does not come up

| Symptom | Likely cause | First action |
| --- | --- | --- |
| `502` on the favicon, container restarts about every minute | the application container is in a crash loop — that 502 is the proxy's own health check against a dead upstream, not a TLS problem | read the container's last start log before touching anything |
| `… is listed as a dependency but is not installed`, boot aborts | the profile's `node_modules` came through a stand move and holds 0-byte symlink files (Windows does not restore the link) | delete the profile's `node_modules` and its lock file: both regenerate from `plugins.txt` on the next start |
| stack was fine, then a cleanup removed an empty directory and `up` fails outright | the compose override's mount point no longer exists, and Docker cannot create it inside a read-only bind | recreate the empty directory on the host, then `up -d` |
| pnpm prints an install failure on a rename inside a Windows bind-mount, yet the plugin behaves as installed | the rename is the noise, the install is complete | test whether the module resolves; do not treat that exit code as fatal — every other failure still is |

A migrated `data/` profile directory is the first suspect after any move or
cleanup of a slice; that is where a stand that "will not boot" usually lives.

## The conversation refuses

| Symptom | Likely cause | First action |
| --- | --- | --- |
| `session.create-rejected reason="composition-mismatch" … model=false` | the model pin does not match the model the session actually gets | compare all three pin sources (`.env` default-model variables, the installed settings' `agent-default-model`, the profile patch's session provider/model) before editing any of them — the entrypoint rewrites the second from the first on every boot, so a hand-edit there is provisional |
| chats refuse to start after a config edit, and the refusal names a model | `.env` changed but the container kept its old environment | recreate the container (`up -d`); `restart` does not re-read `.env` |
| a tool is in the catalog but the chat says it is outside the capability profile, or `SKILL_NOT_AVAILABLE` | the account was not granted the activation skill, or dynamic activation is on while the skill is missing from the loaded skills directory | check the skills directory is non-empty, then the audience grant in the admin surface — this is an entitlement, not a code fault |
| attestation failure naming a tool (`lockdown attestation failed`, `unknown-tools`, the policy-attestation error) | the policy allow-list names a tool the **built** bundle does not export; attestation is fail-closed, so one wrong name removes the whole tool surface | take the names from the built bundle, not from a README or a source comment |
| a client-session call to a service answers connection refused while the operator reaches it | the client session dials only the services named in `DSH_REMOTE_API_SERVICES`, and that variable **replaces** the built-in list rather than extending it | print the effective list before assuming the service is down |
| an address-policy refusal from a networked provider (`allowedHosts`, port not allowed) | the default deployment allows nothing, and the policy is re-checked on every call | the first refusal is the policy, not the server — declare the host/port, then retry once |

## The surface is missing or wrong

- **Card is not visible.** Run the checklist in
  `create-plugin/references/client-side.md` §Proving the card you just
  registered: stale bundle, wrong extension point (`settings.plugin.item` is
  loopback-only by design), missing namespace, dead loader entry. A plugin that
  vanished from the UI with a clean host log is a client-side failure, not a
  settings one.
- **The page still shows the old behavior after a rebuild.** `link:` reads the
  host directory live, so the build — not the browser — is the suspect: rebuild,
  reload, then fetch `/plugins/<full-package-name>/client.js` and confirm the
  bundle you got is the bundle you built.
- **Operator URL answers `401 dsh web authentication required`** (even from the
  stand's own machine): the launch token expired while the harness kept running
  and there is no re-issue path — take a fresh token from the boot log
  (`SKILL.md` §3).
- **Everything says "connecting…" forever through a proxy.** The operator
  surface authorises the request's role from its cookie and its origin: a proxy
  that does not rewrite `Host`/`Origin`/`Referer` gets `403` on every RPC, and
  a websocket needs the raw pipe preserved. That looks exactly like a dead stand
  and is not one.

## Session journals after a stand move

- Index migrated, journals did not: the chat list shows a chat that opens as an
  empty new conversation and logs nothing. Compare the number of indexed
  sessions with the number of journal directories before calling it a UI bug.
- Subagent journals truncated to their first compressed frame read as
  `corrupted session record`.
- A journal whose header records a working directory that disagrees with its
  directory fails the harness boot **closed** — one bad record stops everything,
  which is why a stand that will not boot and a chat that will not open can be
  the same finding.

Do not rewrite or delete journals ad hoc: recovery is a documented repair on the
machine's local briefing, and its backup originals live outside the repository.
