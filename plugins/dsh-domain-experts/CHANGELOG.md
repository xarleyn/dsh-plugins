## 0.2.2 (2026-09-23)

### 🩹 Fixes

- Domain expert execution now fails closed when the runtime cannot enforce an ([7843693](https://github.com/xarleyn/dsh-plugins/commit/7843693))
  explicitly denied tool. A refusal no longer retries with a list that accidentally
  puts the denied name back into the worker's allowed set.

  The integrations operator card keeps new instance and service-credential rows
  as local drafts until they are complete. Controlled profile fields no longer
  snap back to the stored value, and deleting a stored instance cannot shift an
  unfinished draft into the payload sent to the Host.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-22)

### 🩹 Fixes

- Five client bundles stop letting a literal decide a surface, a status or an ([54c2bcc](https://github.com/xarleyn/dsh-plugins/commit/54c2bcc))
  elevation (#254).

  The audited rule is the one the guidelines state: UI is built from
  `--dsw-alias-*` tokens, and a literal may only carry a narrow semantic accent.
  Outside `dsh-qa-surface` (excluded by the card), the sweep found two statuses
  and two elevations that broke it:

  - `dsh-domain-experts` defined its own `--dx-ok/--dx-warn/--dx-danger` with hex
    literals, so enforced, advisory and error text kept a fixed green, amber and
    red in every theme. They now resolve to the host's
    `--dsw-alias-state-{success,warn,error}-primary`, which the rest of the
    repository already uses; the local names stay, so no rule changed shape.
  - `dsh-qa-browser`'s canvas and its tab menu carried literal `box-shadow`
    values. They now ask for `--dsw-shadow-lv2`/`--dsw-shadow-lv3` - the tokens
    `dsh-qa-surface` and `dsh-draft-sessions` already use - and keep the previous
    value as the fallback, so an older host renders exactly as before.
  - `dsh-draft-sessions` wrote the same idea as `--dsw-shadow-l2`, a name no host
    defines; the literal fallback hid it, which is why it survived. Corrected to
    `--dsw-shadow-lv2`.
  - `dsh-documents` asked for `--dsw-label-tertiary` first and only fell back to
    the token that exists; the dead first name is gone.
  - `dsh-doc-impact`'s transparent button border was spelled `#0000`; the keyword
    `transparent` says the same thing without a color literal.

  What stayed is what the rule allows: the remaining literals in these bundles are
  all fallbacks inside `var(<token>, <literal>)`, never the value a themed host
  would resolve. Typography literals were deliberately not touched - the canonical
  card shell in AGENTS.md hardcodes its own 15/13/11px sizes, so font sizes are
  the repository's convention rather than a token-governed surface.

- An expert starts even when its tool policy names a tool the filter may not name. ([0d69f88](https://github.com/xarleyn/dsh-plugins/commit/0d69f88))

  A domain's `tools.allow` became the child's tool filter verbatim, and the
  runtime refuses a whole composition over one name it cannot resolve: a child
  composes its parent's preset into its own scope, so every tool that preset
  mounts — the filesystem readers, the skill catalog, the web tools — is a name
  `restrict()` rejects, and a single one of them took the run down. Two failures
  came from that: the product experts, whose policies list `glob`, `grep`, `read`
  and `skill`, died as `WORKER_UNAVAILABLE` on a deployment that mounts those on
  the agent plane, and the answer reviewer did the same whenever the
  `mcp__openviking__*` tools its policy lists were not yet registered.

  The start is now a two-step: the runtime's own refusal names exactly the
  entries it could not resolve, and the run is retried once without the ones the
  filter actually carried. Dropping such a name costs nothing when the expert's
  preset provides the tool — an own-layer tool stays visible whatever the filter
  says — and costs that single tool when nothing mounts it; either way the audit
  records a `TOOL_UNFILTERABLE` degradation naming it, so the inspector shows what
  went missing instead of the expert being lost with the complaint that its policy
  names a tool. A refusal that names nothing the filter carried is unchanged: it
  is not this plugin's to explain and it stays loud.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-22)

### 🚀 Features

- A domain expert's run history is visible again, on the domain's own page. ([8af757b](https://github.com/xarleyn/dsh-plugins/commit/8af757b))

  Every run was recorded — the host keeps an audit ring and mirrors each entry to
  the plugin log — but no surface ever showed it, so an expert opened from a
  conversation through the agents panel left its domain page looking untouched.
  The domain editor now has a `Runs` tab. It lists the runs the process still
  holds, newest first, one row each: when the run started, its mode and outcome,
  the duration, the caller session and the delegation path behind it, and the
  child session that ran it. A run started from a chat and one started from the
  test screen therefore appear in the same list, which is the equality a domain
  page could not show before. `Refresh` re-reads the ring, and a run the page
  itself starts lands in the list the moment it finishes.

  The memory half was checked and left alone: an expert's notes are read and
  written through the same provider and the same `domain/<id>` namespace whichever
  entry point started the run, so nothing was hiding memory from the page. The
  list is the ring, not a durable log — it is what the running process still
  holds, and the tab says so instead of implying a longer memory.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.4 (2026-09-21)

### 🩹 Fixes

- The child's system section carries the policy, not the task. ([edaa55b](https://github.com/xarleyn/dsh-plugins/commit/edaa55b))

  Splitting the prompt from the persona was only half of it: the persona the
  runtime installs still ended with its own `## Task` section, so the caller's
  request travelled twice — as the child's first message and inside the system
  text. For the review gate that is the worst of both: the candidate answer
  being reviewed, wrapped in its `<candidate_answer>` fences, sat in the system
  prompt as though it were deployment instruction, while the same material also
  arrived as the user turn.

  `composePolicy` now builds the policy without the task section (base policy,
  domain, scope, memory, delegation, domain instructions, answer contract), and
  that is what the runtime receives as `persona`; `composePersona` keeps the
  full document, task included, for the composed preview an operator reads in
  the domain view. Background and continuable runs inherit the same policy. A
  test pins both directions: the delivered text has no task section and no task
  text, and the preview still shows them.

- An expert's first message is the request, not the policy document. ([3f756fc](https://github.com/xarleyn/dsh-plugins/commit/3f756fc))

  The composed persona — base policy, domain, scope, memory, instructions and
  the task — was handed to the subagent twice: once as `persona`, which the
  runtime installs as a system-prompt section, and once verbatim as the child's
  first `prompt`. The child therefore opened with several thousand characters of
  deployment instruction reading as something the user had said, and an expert
  whose whole job is separating what the caller asked from what a source claims
  — the answer reviewer — had exactly the wrong material seeded as the user turn.

  The profile now carries the caller's request on its own (`task`, composed by
  the new `composeTask`), and the runtime receives the policy as `persona` and
  the request as `prompt`. The composed preview keeps its `## Task` section, so
  what an operator reads in the domain view is unchanged; only the delivery to
  the child is. Background and continuable runs inherit the same split.

- The built-in expert policy tells experts how to work tools without looping. ([d12f363](https://github.com/xarleyn/dsh-plugins/commit/d12f363))

  Every domain inherits one base policy, and it said what to do with evidence
  but nothing about the way a run goes wrong: an expert that hits a refused,
  timing-out or unavailable tool kept retrying it — and near-variants of it —
  burning the steps it was given instead of moving to another source. A live
  review run showed exactly that: two calls to an MCP endpoint that answers with
  a timeout, then more attempts of the same tool, and a `grep` without a path
  that searched an empty working directory and reported "no matches" as though
  the corpus were empty.

  The policy now carries three rules: a call that errors, times out or is
  refused has already answered (record it, change the source or the query, never
  repeat the call); read tools take an explicit path, so a bare pattern proves
  nothing about the sources the expert was pointed at; and a source that is
  unavailable for the run is reported as unavailable rather than replaced with a
  guess. Domain instructions still append to this text — it is a floor, not a
  replacement.

- Editing a domain is discoverable, and leaving the editor no longer drops unsaved edits. ([186f977](https://github.com/xarleyn/dsh-plugins/commit/186f977))

  The tab rendered its list and its editor as two wrapping flex columns. The
  settings dialog is narrower than their combined minimum, so the editor wrapped
  *under* a list of eight cards: clicking a domain appeared to do nothing, and the
  only control a card offered was `Disable`, which reads as "this record cannot be
  changed".

  The list and the editor now share one pane, so opening a domain replaces the
  list, and an explicit `Edit` button sits next to `Enable`/`Disable` on every card
  instead of the card body being the only, unlabelled way in. `All domains` above
  the form returns to the list, and it asks before discarding when the draft
  differs from the definition it was loaded from — including when the header starts
  another domain while an edited one is open.

  A domain that disappeared while the list was open reports that on the list now,
  instead of a message that had nowhere left to render.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.3 (2026-09-18)

### 🩹 Fixes

- The first `domain_expert` call after a plugin start no longer refuses with "Domain storage is not open yet". ([cd4ee96](https://github.com/xarleyn/dsh-plugins/commit/cd4ee96))

  The storage open is lazy and memoized, and the tools resolved their definition through a synchronous handle check: the one call that raced the open was refused, and because models rarely retry, a restart silently cost the first delegation. The tool dependencies now await the one-time open, so the racing call waits and proceeds; a storage failure that already happened surfaces its underlying `STORAGE_UNAVAILABLE` cause ("Domain storage could not be opened: …") instead of the misleading "not open yet".

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: tests share the `fixedClock` fixture from `@yadsh/dsh-test-kit`, and package verification gates run through the shared runner. No runtime changes. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-13)

### 🚀 Features

- Initial release of the Domain Experts plugin. A domain is a persisted expert ([dc6ad70](https://github.com/xarleyn/dsh-plugins/commit/dc6ad70))
  profile — persona, filesystem and knowledge scope, memory namespace, tool
  policy, cross-domain policy and model policy — created in a new
  `Settings → Plugins → Domain Experts` tab. Experts run as ordinary DSH
  subagents through the native runtime, so the plugin composes the request
  instead of re-implementing agent execution. The plugin reports every
  restriction as either enforced or advisory, so a filesystem rule is never
  presented as isolation it does not have. Cross-domain questions go through the
  owning expert, with a machine-enforced mode, target list, depth cap and
  parallel budget; memory is partitioned by namespace at the storage-key level.
  Scope providers, memory backends and workers are public extension seams.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn