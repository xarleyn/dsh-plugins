# Stand refusals: symptom → likely cause → first action

The class of bug where one symptom has five causes. Work the list in order and
say which one you ruled out: most stand "defects" are a pin, an entitlement or a
policy refusing, not a code fault, and editing code to chase them costs a round.

**Two rules before any repair:** one failed probe does not mean the stand is
down — re-check later instead of scanning the network for it; and never restart
or wipe a rig another person brought up (see `SKILL.md` §1).

**The actions below are written in the imperative, and the ownership test still
gates them.** Anything that starts, recreates, restarts or deletes, or writes a
line into `config/dsh/`, is a §1 action: run it on the slice this session brought
up, and on anyone else's rig name the paths and the command in your ask instead.
The repair is the same either way; the authority is not.

**The `up -d` and `restart` here are `docker compose` commands, so they belong to
`$KIT`** (`SKILL.md` §1). Run from the repository directory, compose reads no
configuration file, and its own refusal arrives as a symptom of the stand.

**A quoted symptom is a string to search for, so the table says whose string it
is.** What this repository's plugins print is checkable here and is quoted from
the code: the attestation reason codes (`unknown-tools`,
`composition-mismatch`), `SKILL_NOT_AVAILABLE`, `TeamCity URL is not allowed by
this deployment`. What the host prints is not this repository's source but is
still shipped text — `401 dsh web authentication required` is the host's own
reply — and a disagreement there is settled by the rig, per `SKILL.md` §0, the
same way as a configuration name the rig owns (`DSH_REMOTE_API_SERVICES`), which
is looked up in the deployment, never grepped out of this tree. Two quotes are
weaker still: `corrupted session record` and `… is listed as a dependency but is
not installed` have no shipped text behind them — they are carried from a stand
someone read, so if a live log shows either refusal differently the log wins and
the row is corrected. The split matters because the table keys on the refusal's
own text (`SKILL.md` §5): a name no code emits reads as an empty cell, and the
finding then gets filed under the wrong cause.

**The same split runs through the *Likely cause* column, and a cause this tree
cannot read is not written as a fact.** Why one of this repository's plugins
refuses is checkable here, and those cells cite the file that decides it. Why the
host, or the kit's proxy, refuses is not: the cell describes that component's
behaviour as the candidate the row's first action settles, not as settled
mechanism. "the token had expired" is a fact a round can produce — a fresh one
from the boot log answering `200` says so — while "there is no other way to get
one" is the kit's rule, worth asking its operator about rather than repeating
here. A cause printed as fact when nothing here can check it costs what an
invented symptom in the cell beside it costs: the next reader takes it as the
verdict and stops looking.

§1 answers *whose* rig, not *what state* it is in. A stand under test carries a
reproduction — resolved versions, a deliberate pin, a config someone is looking
at — and the repairs below can spend it before you have proved the fault was in
the code.

## The stack does not come up

| Symptom | Likely cause | First action |
| --- | --- | --- |
| `502` on the favicon, container restarts about every minute | the application container is in a crash loop — and that a `502` at the proxy means a dead upstream rather than a TLS fault is the kit's rule, not this tree's, so the start log this row asks for is what settles it | read the container's last start log before touching anything |
| `… is listed as a dependency but is not installed`, boot aborts | the profile's `node_modules` came through a stand move and holds 0-byte symlink files (Windows does not restore the link) | confirm the hypothesis before spending anything: this quote is carried from someone's stand and no code here prints it (the preamble above), so read the real boot error in the container's log and then look at the files — a handful of entries under the profile's `node_modules` sitting at 0 bytes is the claim, an unrelated failure is not this row. Only once both hold, copy each plugin's resolved version out of the profile's lock file, then delete that `node_modules` and the lock file with it. Do not count on the next boot putting the same versions back: reconciliation keys on the spec *line* (`SKILL.md` §2), so a line you did not change may install nothing, and an `@latest` line installs whatever is newest — have the pins restated before the boot and confirm the versions after it. The most destructive action on this page: it deletes the stand's own installed state, so the strictest reading of §1 applies to it |
| stack was fine, then a cleanup removed an empty directory and `up` fails outright | the compose override's mount point no longer exists, and Docker cannot create it inside a read-only bind | recreate the empty directory on the host, then `up -d` |
| pnpm prints an install failure on a rename inside a Windows bind-mount, yet the plugin behaves as installed | the rename is the noise, the install is complete | test whether the module resolves; do not treat that exit code as fatal — every other failure still is |

A migrated `data/` profile directory is the first suspect after any move or
cleanup of a slice; that is where a stand that "will not boot" usually lives.

## The conversation refuses

| Symptom | Likely cause | First action |
| --- | --- | --- |
| the host log carries `session.create-rejected` with the reason `composition-mismatch` and the error `composition mismatch: agent=<bool> workspace=<bool> model=<bool>`, and the browser console prints the whole refusal — `dsh-qa-surface: policy attestation failed (reason: composition-mismatch). The session's agent preset, workspace or model no longer matches the deployment QA config.` | the deployment pins the composition a QA session must carry and one of the three pins no longer holds: the agent preset, the workspace, or the model (`provider`, `model`, `reasoningEffort`). `secure-session.ts` evaluates all three and throws the reason with one error line naming which — the host's own emitter writes `sessionId`, `reason` and `error`, so the three booleans are the only place the failing pin appears | read the error line first: the `false` in it is the finding, and the other two names are noise. Then compare that one pin with what the session actually gets, over every source `SKILL.md` §1 says owns it — the config directory re-applies over the installed settings on each start, and `.env` only lands when the container is recreated, so an edit made through the UI is provisional whichever pin lost |
| chats refuse to start after a config edit, and the refusal names a model | `.env` changed but the container kept its old environment | recreate the container (`up -d`); `restart` does not re-read `.env` |
| the chat answers `SKILL_NOT_AVAILABLE: <name>`, or offers no `skill` tool at all | three doors, and the code opens them in this order. `installQaSkillPolicy` (`enforcement/skill-policy.ts`) returns without registering anything when the effective tool allow-list has no `skill` in it, and `secure-session.ts` calls it only for a session that carries a capability snapshot — in both cases the tool is simply absent, and absence is not a refusal. Next, a name outside the policy's `skills` list is refused at that allow-list check. Last, a name that *is* granted is refused when it resolves to nothing in the loaded skills directory, or resolves to a skill the host's `isModelInvocable` test rejects | read which door you are at before touching either: no refusal line and no `skill` tool is the deployment's tool policy, not the account, and no grant will change it. With a `SKILL_NOT_AVAILABLE` line, the directory and the grant answer different questions — the grant is checked first, so a refused name that is granted points at the skills directory or at that skill's own invocability (the host package decides), and "directory non-empty, grant issued" is two cleared doors, not a verdict |
| attestation refusing a tool name: the host log carries `session.create-rejected` with the reason `unknown-tools` and the error `unknown QA tool(s): <the names>`, and the browser console prints the whole refusal — `dsh-qa-surface: policy attestation failed (reason: unknown-tools). A lockdown.toolPolicy name is not mounted in this session's tool catalog — check the deployment agent preset and the tool's server availability.` | a name in the effective allow-list (`lockdown.toolPolicy.allow`, or the role's `policy.tools` when a capability profile supplies one) that the running session does not mount — `dsh-qa-surface` puts every name through one mount test (`qaToolPolicyPlan` over the tools this agent can see) and prints the names that failed it in the error line of the first column. Attestation is fail-closed: the session is refused before it exists, so no chat opens and the tool surface goes with it | work the two checks the refusal itself names, in its order: the deployment agent preset, then that tool's server availability — the preset decides what the agent inherits, the catalog holds what is mounted now. Compare against what this session mounts, not against a README, a source comment, or a bundle's export list |
| a client-session call to a service answers connection refused while the operator reaches it | the client session dials only the services named in `DSH_REMOTE_API_SERVICES`. Whether that variable **replaces** the built-in list or extends it is the host's rule and nothing here reads it, so treat replacing as the candidate and let the effective list this row asks for decide | print the effective list before assuming the service is down |
| an address-policy refusal from a networked provider: `TeamCity URL is not allowed by this deployment`, or `TeamCity URL must use one of the configured ports: …` | the default deployment allows nothing (`network.allowedHosts` starts empty, and `trusted-private` is the only mode that makes a name dialable), and the provider re-checks the policy where it builds each request URL | the first refusal is the policy, not the server — an empty address policy announces itself on the host log at start (`teamcity.address-policy-empty`), so read that before retrying; then declare the host or port and retry once |

## The surface is missing or wrong

- **Card is not visible.** Run the checklist in
  `create-plugin/references/client-side.md` §Proving the card you just
  registered — that page owns the list and its order, and a second copy here
  would only drift from it. A plugin that vanished from the UI with a clean host
  log is a client-side failure, not a settings one.
- **The page still shows the old behavior after a rebuild.** `link:` reads the
  host directory live, so the build — not the browser — is the suspect: rebuild,
  reload, then fetch `/plugins/<full-package-name>/client.js` and confirm the
  bundle you got is the bundle you built.
- **Operator URL answers `401 dsh web authentication required`** (even from the
  stand's own machine): take a fresh token from the boot log (`SKILL.md` §3, whose
  recipe tells "no such line" from "no log yet" from "compose would not answer",
  and runs in the kit so that a wrong directory is not read as a dead rig) and
  retry once. A `200` there is this row settling itself — the first token had
  expired while the harness kept running. Whether the kit offers any other way to
  get one is its rule, not this tree's, so ask its operator instead of assuming
  the boot log is the only door.
- **Everything says "connecting…" forever through a proxy.** A proxy that does not
  rewrite `Host`/`Origin`/`Referer` is the first suspect, and the mechanism behind
  it is the host's, not readable from here: the operator surface is understood to
  authorise a request's role from its cookie and its origin, so such a proxy is
  expected to answer `403` on every RPC, and a websocket needs the raw pipe
  preserved. The page spinning forever looks exactly like a dead stand and is not
  one, and the browser's network log tells them apart: a refused authorisation
  answers `403`, a dead stand answers nothing.

## Session journals after a stand move

- Index migrated, journals did not: the chat list shows a chat that opens as an
  empty new conversation and logs nothing. Compare the number of indexed
  sessions with the number of journal directories before calling it a UI bug.
- Subagent journals truncated to their first compressed frame read as
  `corrupted session record`.
- A journal whose header records a working directory that disagrees with its
  directory fails the harness boot **closed** — one bad record stops everything,
  which is why a stand that will not boot and a chat that will not open can be
  the same finding. That the harness reads a header at all, and refuses on the
  mismatch, is the harness's rule: the boot log naming the record is what makes it
  more than a guess here.

Do not rewrite or delete journals ad hoc: recovery is a documented repair the
stand's operator holds — ask for it instead of improvising one — and its backup
originals live outside the repository.
