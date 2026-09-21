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