## 0.2.5 (2026-10-08)

### 🩹 Fixes

- A corrected answer arrives alone — the gate no longer makes the primary argue with its reviewer in front of the user. ([#729](https://github.com/xarleyn/dsh-plugins/issues/729))

  On a live deployment the final answer of a reviewed turn opened with the internal exchange:
  «Опровержение вывода ревизора: …» followed, further down, by the short line the user had asked for. Another run put the same
  leak in a visible thinking block, where the model wrote down that its instructions asked it to keep the review quiet.

  The revision steer was the cause. It demanded, in one sentence, that a disproved objection "state that disproof" and that the
  answer never mention the review. A primary resolves that contradiction literally and prints the disproof as the answer — and
  the reviewer's own vocabulary arrives with it, because it came from the same text. The instruction to conceal is what the
  visible reasoning then reports.

  The steer now admits exactly one visible artifact: the corrected answer, in the shape the user's request asked for. Findings
  come back inside a delimited `<review_notes>` block, framed as this turn's working material rather than as prose to continue,
  and a rejected objection is dropped without a word — the reviewer re-reads the next version of the answer, and where the
  exchange repeats the round budget ends it under the configured failure policy. No rule is phrased as a secret any more. The
  text the reviewer sends is treated as input rather than as instructions: each field is bounded and cannot close that block
  early, so a finding that quotes a hostile page stays a quotation.

  As a guard, in a turn that has already been reviewed, a candidate that opens by disputing the review is not handed to a
  reviewer and so cannot be certified as verified: the primary is steered once per user turn to deliver the answer's shape
  instead, and the demand is recorded in the audit ring. A message the host has already committed cannot be edited at this seam,
  so the guard stops the leak from passing for a reviewed answer rather than removing text the user has already read.

### ❤️ Thank You

- qoder-bot

## 0.2.4 (2026-10-08)

### 🩹 Fixes

- A reviewer can no longer ask to delete a file, and a delegated call is refused ([#732](https://github.com/xarleyn/dsh-plugins/issues/732))
  where it asks instead of stopping the turn.

  The gate's own child is now composed from an explicit read-only set
  (`src/reviewer-tools.ts`): unset `reviewer.allowedTools` means reads and
  searches rather than nothing, and the destructive names — `file_delete`, the
  file-writing and shell tools, the catalog's own delete, and any `terminal_*` or
  `job_*` tool — are removed both when the config is resolved and again at the
  call that starts the child. The reviewer's two task texts say the same thing
  the filter enforces: an obstacle is a finding about the candidate, not something
  to clear. On the `domain-expert` branch the mask is the domain's and a tool the
  surface attaches to the agent's own layer survives any inherited filter, so that
  branch is held on the surface's side.

  There the approval seam refuses a delegated child's request outright, in either
  `interaction.approvals` mode: a card parked over the parent's composer waits for
  an answer a child can never be given, which is how a stand came to look like it
  was thinking for an hour over a yes/no about one tool call. `file_delete` from a
  delegated call is refused by its own inner gate too, with a reason that tells the
  caller to report the file rather than remove it, and a parked request an operator
  never answers now expires into a refusal instead of holding the turn open.

### ❤️ Thank You

- qoder-bot

## 0.2.3 (2026-10-08)

### 🩹 Fixes

- Every plugin row on the Host's Plugins page is named in words. ([fff88762](https://github.com/xarleyn/dsh-plugins/commit/fff88762))

  The page titles a bundle's row and fills its description line from the package's
  exported `locale/en.json`, which the Host resolves through the package's `exports`
  map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
  Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
  their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
  first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
  `locale/*.json`, and carries English `meta.title` and `meta.description`; where the
  package already had a configuration card, its `summary` one-liner and the row's
  description are one string, pinned by a test against the shipped file rather than
  against a copy in the test. `pnpm verify:packages` asks all three halves of every
  plugin package, so a row cannot fall back to a specifier unnoticed.

  Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
  panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
  row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
  namespace the Host serves the form under, so no saved value is orphaned — and with the
  seat it gives up its shell, its header badge and its show/hide labels, taking the
  Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
  unavailable namespace with a sentence instead of an empty section.
  `dsh-domain-experts` owns no form — it edits domains through its Remote services — so
  it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
  drops the `<h2>` heading and the intro line the panel already draws from the row's own
  display metadata.

### ❤️ Thank You

- xarleyn

## 0.2.2 (2026-10-05)

### 🩹 Fixes

- A reviewer no longer treats an attachment it cannot open as proof that the ([4fa58cfe](https://github.com/xarleyn/dsh-plugins/commit/4fa58cfe))
  answer invented its content.

  The gate handed the reviewer two strings — the request and the draft — because
  the text collector kept only text blocks, so a question asked about an uploaded
  report or a photo reached the reviewer with the attachment erased. The reviewer
  was instructed that a lack of evidence is a valid finding, so it raised exactly
  the finding it could not avoid, and since an expert finding carries no concrete
  fix to apply, the loop had no way to converge: the round budget ran out and the
  answer was delivered as-is with a disclaimer. That is the shape of the
  `max-rounds` failures the stand counts.

  The reviewer now receives the same handle lines the host shows a model that
  cannot receive the file — a named attachment, its kind, and no read path — and
  the protocol in both shipped reviewer prompts says what follows from that: an
  attachment you cannot inspect is reported as unverifiable, never as a
  fabrication. The bytes are still not passed; giving the reviewer the file
  itself needs a read tool in its allow-list and an image-capable reviewer model,
  which is a separate decision.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-10-04)

### 🩹 Fixes

- Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover. ([#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))

  `compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
  release, and the Requirements/Compatibility lines of the README and SPEC that
  restate that pair moved with it, so a package page and its manifest agree. The
  checks that hard-code the pair moved in the same change: two `deepEqual`
  assertions in the package verifiers, one bundle test, the plugin generator's
  scaffold defaults with its test, and the fixtures of the repository gates that
  read them.

  Dated records keep the version they were written against. Phase 0 and spike
  findings documents, `SPEC` baseline tags and permalinks into the harness tree,
  and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
  what was observed on that host rather than what the package supports now.

- An empty `reviewer.allowedTools` now really leaves the reviewer without tools, ([#340](https://github.com/xarleyn/dsh-plugins/issues/340))
  and unloading the plugin closes what it opened.

  The subagent backend attached a tool filter only when the allow-list was
  non-empty. The host restricts a child's tools only when a filter arrives, so
  `allowedTools: []` — the value that promises a reviewer working from its own
  knowledge only — was precisely the one that handed the reviewer the parent
  agent's whole tool surface. The list is now always sent, empty included.

  The teardown paths close as well. `apply` returns an unload disposer that
  closes the shared plugin logger, the one resource the plugin fiber does not
  own; a review now waits for the subagent child's disposal instead of leaving it
  running past the verdict; and a domain-expert review whose turn was already
  cancelled at entry says so instead of launching a run it has no way to stop —
  the reviewer face that plugin exposes owns the run and takes no signal.

- The gate attributes its steers to its own producer kind and builds against a 0.1.7-rc.2 host. ([#527](https://github.com/xarleyn/dsh-plugins/issues/527), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  The revision and failure-policy messages the gate puts back into the reviewed
  agent were attributed to a catch-all `plugin` source kind. `0.1.7-rc.2` does not
  define one: the source map — the harness's answer to *who produced this*, kept
  separate from the `notice`/`snapshot`/`catalog` vocabulary that answers *what
  kind of thing it is* — ships only `user`, `model`, `tool` and `system-prompt`,
  and every other producer declares its own kind through a module augmentation
  (`tool-registry`, `subagent-settled`, `model-selection`). Naming a kind the host
  deleted is a compile error, so the package did not build against an rc.2 host at
  all; and a kind no declaration carries would leave a consumer with nothing to
  match the row against, falling through to opaque content.

  The package now declares `answer-review` as its own source kind and steers under
  it. The form it already used is rc.2's vocabulary unchanged — a `notice` with a
  bounded one-line account — so a steered row still reads "Answer review requested
  corrections (round 1 of 2)" instead of unlabelled text, and which candidate the
  gate reviews, when it suppresses an interim turn, and what it steers are all
  untouched. What changed is that an rc.2 host can say who wrote the message.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- Qoder
- qoder-bot

## 0.2.0 (2026-09-24)

### 🚀 Features

- QA conversations now render Mermaid diagrams with secure source fallback, ([aafad8b](https://github.com/xarleyn/dsh-plugins/commit/aafad8b))
  documentation search accepts safe grep-style alternatives and canonical paths,
  and the role-change dialog uses the surface's normal controls.

  Managed integration defaults are provisioned for new users without overriding
  an explicit disconnect, the structured `/no-review <request>` command bypasses
  the automatic review gate for exactly one durably linked request, and
  authenticated fetching can retain arbitrary successful responses as durable
  file attachments while keeping grants administrator-controlled.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-22)

### 🩹 Fixes

- The review budget's edges are pinned by tests. ([89470e0](https://github.com/xarleyn/dsh-plugins/commit/89470e0))

  The round budget belongs to the user's turn, and the boundaries of that rule —
  the last allowed round, the first refused one, a turn that ends between them —
  were only exercised through the gate's own happy paths. Dedicated tests now
  hold them, so a change to the budget arithmetic fails loudly instead of
  drifting one round at a time.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-22)

### 🩹 Fixes

- The review round budget and the PASS receipt now belong to the user turn, so a ([f3b1045](https://github.com/xarleyn/dsh-plugins/commit/f3b1045))
  reviewed answer stops being reviewed.

  Both were keyed by the agent turn the boundary reported. Agent turns are not
  user turns: one request spends several of them, because a REVISE steer continues
  the current turn while the primary's next version — or a settlement notice —
  reopens the boundary as a new one. Every such change therefore discarded the
  receipt of a candidate the reviewer had already passed and handed the gate a
  fresh round budget. The result was the reported exchange: the reviewer passed an
  answer, the model wrote one more version announcing the review, and that version
  was reviewed again instead of shipping, with the round limit never reached
  because each turn reset it.

  The gate now keys its session state by the user request the candidate answers —
  the surface sequence of the latest real user message — and keeps the round
  counter, the one-per-turn failure steer and the PASS hash there. The agent turn
  only refreshes the turn number used for delegation bookkeeping. An unchanged
  candidate is never reviewed twice, not even in a later agent turn of the same
  request; a candidate that changes after a PASS is reviewed once, as any changed
  candidate is; and the revision budget is spent by the request, so `open`/`warn`/
  `closed` failure handling takes over after `maxReviewRounds` revisions of that
  request instead of starting over. A new user message owns a new budget and no
  longer inherits the previous request's receipt, while a boundary that finds no
  candidate cannot reset a known budget.

  The reviewer tasks also state the contract that made the loop look reasonable
  from the model's side: a pass is final for the candidate it reviewed, it ships as
  written and asks for no further version.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.0 (2026-09-21)

### 🚀 Features

- New plugin: an independent answer review gate. Before a candidate final answer ([6097585](https://github.com/xarleyn/dsh-plugins/commit/6097585))
  completes its turn, a configurable reviewer (a dsh-domain-experts domain or a
  native subagent child) checks it and can send findings back for a corrected
  candidate within bounded rounds. Interim turns that close while the session's
  background delegations are pending are never reviewed; a review PASS applies
  to the exact candidate content; reviewer failures follow the configured
  failure policy (`open`/`warn`/`closed`) and are never reported as passes.


### 🩹 Fixes

- Independent verification reaches the domain-experts backend again. ([9dc59b0](https://github.com/xarleyn/dsh-plugins/commit/9dc59b0))

  The gate resolved its reviewer service as `ctx.get("domain-experts")` — which
  is the plugin id and the settings namespace, but not the service name: the
  provider registers `ctx.domainExperts`, and its own wiring test pins that key.
  The lookup therefore returned nothing on every deployment, so every answer
  came back with the failure-policy notice — "independent verification could not
  be completed (the dsh-domain-experts service is not loaded)" — while the
  plugin ran in the same process, and the reviewer never ran. The gate now asks
  for the key the provider publishes, and a regression test pins the contract in
  both directions: a service registered as `domainExperts` is used, and the
  plugin-id spelling is not silently accepted as a reviewer backend.

- Both reviewer tasks tell the reviewer not to loop on a failing tool. ([135433f](https://github.com/xarleyn/dsh-plugins/commit/135433f))

  The expert task and the subagent task described what to verify and how to
  report it, but not what a refused, timing-out or unavailable call means. On a
  deployment where one source answers with a timeout and the reviewer's working
  directory is empty, the reviewer spent its budget retrying the same endpoint
  and reading "no matches" from a path-less search as if the corpus were empty.

  Each task now carries the same three rules the expert base policy states: a
  failing call has already answered — record it and change the source or the
  query instead of repeating it; read tools take an explicit path, and a pattern
  without one searches the reviewer's own directory; an unavailable source is
  reported, never guessed. The reviewer still reports what it could not verify,
  so a failed source remains visible in the verdict rather than silently
  absorbed.

### ❤️ Thank You

- xarleyn @xarleyn