## 0.10.0 (2026-09-21)

### 🚀 Features

- Let an administrator delete a conversation for real, and keep the sidebar's ([b9b12bf](https://github.com/xarleyn/dsh-plugins/commit/b9b12bf))
  delete what it always was — a per-browser row.

  The console could read, review and rate a conversation but not remove one: the
  only delete anywhere in the surface was the sidebar's, which forgets a chat in
  one browser and nothing else, so a chat that should not exist (a broken
  navigation, a conversation that never belonged, a user's request) stayed on the
  stand forever.

  The deletion is the console's, admin-only (`conversations.delete`) and audited
  (`conversation.deleted`), and it removes what the deployment kept rather than a
  row in a list: the stored logs of the chat and of every session delegated from
  it, the ownership record that is its authorization boundary, its ratings,
  reviews and queue entries, and the sources it collected. The Harness offers no
  deletion seam to lean on — `sessionPersistence` has create/open/flush/stat/list,
  and a live session leaves memory only with the fiber that owns it — so the
  deployment's own storage artifacts are what gets removed, and the console says
  so when a deployment keeps sessions somewhere directories cannot express.

  Refusals come before anything is touched, so a chat is never half-deleted: a
  conversation the Harness still holds open would have its log written back by
  the next flush, and one it never had is not a conversation at all. Both say
  which of the two they are.

- The QA tool catalog gains its first destructive capability: `file_delete`, ([b6f0e71](https://github.com/xarleyn/dsh-plugins/commit/b6f0e71))
  deleting one workspace file with a mandatory operator confirmation.

  The catalog (version 2) ships `file_delete` next to `qa_tools_selfcheck`.
  It removes a single regular file strictly inside the calling chat's own
  workspace root — relative or absolute-inside paths both work — and refuses
  everything else with an explicit reason: paths outside the workspace,
  symlink escapes (the deepest existing ancestor is resolved with realpath and
  verified for containment), directories and missing files. A missing or
  blank session cwd is a typed refusal, never a fallback to the process
  working directory, and refusals never echo absolute host paths.

  Every call is gated: a `tools/pre-execute` listener answers `ask` for
  `file_delete` from an attested session, so the interactive approval card
  parks the request over the composer and nothing is deleted until the
  operator allows it once. Other tool names pass through untouched, and the
  existing allow-list, workspace fence and sandbox still apply to the
  resolved call. No allow-list entry is needed: the dynamic catalog
  admission already admits names the activation manager registered.

  The chat client also drops the machine-scent: the question form's status
  strip and pager are separate elements without the middle-dot separator,
  question headers no longer uppercase with letter-spacing, punctuation-only
  option descriptions and details («?», «...») produced by small models are
  no longer rendered, the approval card marks a delegated request with its
  own span instead of a dot-glued suffix, and the subagent drawer renders
  settlement meta as separate parts instead of a dot-joined string.

- The service mode badge is gone from the chat header. ([28c44c0](https://github.com/xarleyn/dsh-plugins/commit/28c44c0))

  The title row carried a caption reading «Режим …» — the name of the
  deployment's agent preset, prettified. It labelled nothing a reader could
  act on, revealed plumbing a QA audience has no use for, and took title-row
  width away from the conversation title itself. The badge, its icon and its
  stylesheet are removed; the row now shows the title, the role selector and
  the controls, and the subagent return control still appears in the same
  spot while a subagent transcript is open. The preset itself keeps driving
  the session exactly as before — only the label is gone.

- Assistant Markdown renders TeX math and footnotes the way the DSH transcript ([dc0d160](https://github.com/xarleyn/dsh-plugins/commit/dc0d160))
  does.

  The chat renderer stopped at the GFM grammar: answers that write formulas in
  TeX — inline `$x^2$`, display blocks between `$$` fences, ```math fences —
  showed up as raw source with backslashes and braces, and a footnote reference
  `[^1]` stayed visible bracket text while its definition rendered as an
  ordinary paragraph.

  Math now renders through the same library the transcript uses (KaTeX, display
  and inline mode), so fractions, subscripts, Greek letters and integrals read
  as formulas. The delimiter shapes follow the transcript's settled grammar
  exactly — maximal-munch dollar runs, equal-length opener and closer, padding
  stripped only when both ends carry it, unpaired dollars (prices) staying
  literal — and the `\(…\)` / `\[…\]` delimiters stay literal text there too,
  so both surfaces agree on what is a formula. Footnotes follow GitHub's
  dialect: a defined `[^label]` renders as a numbered superscript and the
  definitions collect into a trailing section with per-reference back-markers,
  while an undefined label stays literal text.

  KaTeX joins the self-contained client bundle deliberately: the stylesheet and
  all twenty woff2 faces travel inside the bundle as data URIs, so math looks
  right whatever the Host page loads, and the generated
  `src/client/markdown/katex-css.ts` is refreshed by
  `scripts/generate-katex-css.mjs` on dependency bumps.

- The ambient model notes are configurable: each can be muted and reworded from ([474a7f5](https://github.com/xarleyn/dsh-plugins/commit/474a7f5))
  the settings card.

  The plugin writes three hidden user messages into a QA chat: who the user is
  (name, email, handles, their own instructions), the source-provenance rules,
  and the request to give background subagents short vivid names. The texts were
  literal in the source, and the only switches were the feature switches around
  them (`accounts.profile.inject` gated the identity note; the sources note
  disappeared only together with provenance collection itself; the delegation
  note had no switch at all).

  The new `notes` config block — surfaced as the «Заметки модели» section of the
  settings card — gives each note an on/off switch and a wording override:
  `notes.identity.template` with `{identity}` and `{instructions}`,
  `notes.sources.template` plus a separate `fallbackTemplate` with
  `{reportTool}`, and `notes.delegation.template`. An empty template keeps the
  built-in text; a template that drops its required placeholder falls back to
  the built-in wording instead of silently anonymizing the note. Muting stops
  future notes only — one already delivered stays in the conversation it
  reached — and notes remain advisory text: the lockdown and tool policy hold
  whatever the conversation says.

- The chat-list sidebar is resizable, and both widths survive a reload. ([a0a75f0](https://github.com/xarleyn/dsh-plugins/commit/a0a75f0))

  The sidebar has been a fixed 264 pixels since it first shipped: on a wide
  monitor the conversation swallowed the difference, and a reader with long chat
  titles — or long owner names in the admin grouping — had no way to trade
  conversation width for list width.

  The sidebar now drags like the Host frame's own. An invisible 8px strip
  straddles the sidebar's right border, the cursor alone advertises it, and a
  pointer-captured, rAF-throttled drag moves the edge live. The clamp copies the
  frame's constants: the old fixed width is the floor (264), the frame's ceiling
  the max (420), with integer rounding and no snapping. The collapsed rail keeps
  its fixed width and renders no strip, and expanding restores the last dragged
  width.

  The chosen width is remembered per browser, in the deployment's localStorage
  namespace next to the collapsed flag and the transcript width, so a reload, a
  re-login or a reopened tab comes back at the dragged width. During the drag
  the width travels through a CSS custom property on the nav element rather than
  React state, so the memoized sidebar does not re-render per frame; the
  conversation column follows through the ResizeObserver that already
  republishes the content width, and that width's existing floor keeps the
  transcript readable. Below 600px the sidebar is hidden, as before, and the
  strip hides with it.

- The files rail browses the chat's own working directory and opens what it finds. ([dccd31f](https://github.com/xarleyn/dsh-plugins/commit/dccd31f))

  The panel could already list what a visitor attached and reopen the files an
  answer cited as sources, but everything the conversation *produced* — the
  document a `document_create` call wrote, the notes an agent left behind, the
  manifest beside an artifact — stayed invisible: the rail said "there are no
  attachments in this chat", and the only way to reach those files was a shell on
  the host. Two new Host methods close that gap (`listWorkspaceFiles`,
  `readWorkspaceFile`), and the «Файлы» tab renders them as a directory browser:
  crumbs from the chat's root, one directory at a time, folders first.

  Browsing is deliberately narrower than the source preview it sits beside. The
  listing is confined to the attested chat's own directory — the realpath- and
  containment-checked request refuses everything else with the shared
  `outside-roots` reason, symlinked children are omitted rather than followed,
  and the single listing cap (`sources.filePreview.maxListingEntries`, default
  500) reports the cut instead of hiding it. Reading reuses the source preview's
  root policy unchanged — the chat's cwd, the deployment's shared read-only
  roots, and the attachment store — so a file the model itself may read stays
  readable in the panel, and nothing else does. Unlike the source preview it does
  not require the file to be recorded evidence, because the visitor is browsing a
  tree rather than reopening a cited source; the switch that opens file reading
  at all (`sources.filePreview.enabled`) governs both and is now also rendered
  with the new cap in the settings card.

  A text file opens inline — Markdown with the same rendered/raw toggle the
  source detail uses, anything else as monospaced text — while a binary file
  reports that it does not read as text and offers the whole file as a download.
  The download happens in the page: the bytes arrive base64 in the read answer and
  become an object URL, so no unfenced byte-serving route is exposed to the
  audience.

  Word documents are previewed rather than described: the panel asks the Host for
  a renderable copy (`previewWorkspaceDocument`), which converts the file through
  the document pipeline's own runtime — the service `@yadsh/dsh-documents`
  publishes for its host siblings — and hands back the produced PDF, drawn by the
  browser's viewer inside a blob frame. A deployment without that pipeline, a
  format it cannot render, or a conversion that fails all end in the same honest
  sentence and a working download, never in a guess. PDFs already in the
  workspace preview the same way from their own bytes. Any open file — text,
  image, PDF — can be expanded out of the rail into a dialog-sized view
  (`Развернуть файл`), which shows the same body with more room and closes back to
  the directory.


### 🩹 Fixes

- Remove a chat's QA record when the Harness has actually lost it — and only then. ([e8ccefd](https://github.com/xarleyn/dsh-plugins/commit/e8ccefd))

  The sweep that reclaims ownership records of deleted chats asked the live
  session store what exists, and that store answers only for the sessions this
  process has open. A chat nobody had opened since the last restart was therefore
  absent from the answer without being gone: once its claim passed the grace
  period, the record — the chat's authorization boundary — was reclaimed, and the
  chat left its owner's list, the console and the counters while the conversation
  itself was still on disk. The sweep now asks both halves of what the Harness
  knows, the live sessions and the durable listing, and treats an incomplete
  listing (a deployment that serves no durable query engine, or one that failed
  this read) as a question it cannot answer: it reclaims nothing rather than
  guessing.

  Dropping a chat takes the rest of what the deployment kept about it. Ratings,
  reviews and queue entries are keyed by conversation and outlived it, so a chat
  deleted in the Harness left its verdicts behind, still counted by the metrics
  and still pointing at a conversation the console could not open. The sweep
  hands the ids it reclaimed to the deployment, which drops those rows; the audit
  trail stays, because it records what administrators did rather than what a
  conversation held.

  The review reads run the sweep before listing conversations, so the console
  reflects what exists when it is opened instead of waiting for the next chat
  creation to trigger housekeeping.

- Document where a per-user QA deployment puts its chats in the host UI, and give ([71ee354](https://github.com/xarleyn/dsh-plugins/commit/71ee354))
  the operator a way to repair the stragglers that are still adoptable.

  `accounts.perUserWorkspace` hands every QA chat a private
  `<workspace>/.qa-users/<account UUID>` root and deliberately does not register
  it as a DSH Workspace. DSH grants Workspace membership only to a session whose
  stored cwd IS the Workspace path (`Workspace.attachSession` compares the two
  after `realpath`, and the workspace browser derives its groups from
  `workspace.sessionIds` alone), so those chats appear under `Ungrouped` in the
  host's sidebar. The mode is not misconfigured and nothing can move them
  afterwards: the contract has no attach or membership request for an existing
  session, `insertSessionBefore` reorders only sessions a Workspace already
  accounts, and dragging a session never crosses groups. Registering one Workspace
  per account directory is the one mechanism that would group them, and it would
  put every visitor's scratch root into the operator's global workspace registry.
  README, `docs/CONFIGURATION.md` and SPEC.md now state that consequence instead
  of leaving an operator to rediscover it.

  The second straggler family is repairable and now has a command. A chat created
  while the deployment pinned `session.cwd` - or through `workspaceId` with the
  same directory spelled differently (`E:/base` against `E:\base`) - never calls
  `attachSession` at all, so it lands in `Ungrouped` even though its cwd IS the
  Workspace path. `qa-attach-sessions`
  (`scripts/attach-workspace-sessions.mjs`) adopts exactly those: it reads the
  session store and the workspace registry, matches the stored cwd to a workspace
  path after `realpath`, and writes the membership the host itself would have
  written. Dry run by default; `--write` requires DSH to be stopped, keeps an
  exclusive `*.pre-workspace-attach.bak` copy, replaces the registry atomically
  and re-reads it before reporting success. Sessions below a workspace path are
  reported and refused, because the host re-applies the same comparison on every
  read and would drop them again; subagent sessions and archived sessions stay
  untouched unless asked for. The command changes no plugin runtime behavior.

- The administrative user card opens fast again, and saving an edit confirms ([c7cbaf1](https://github.com/xarleyn/dsh-plugins/commit/c7cbaf1))
  itself on the spot.

  The card used to fill its «Сообщения» activity counter by reading every
  conversation the account owns, and reading one conversation on the Harness
  costs a full persistence listing of the deployment's sessions before it
  reaches the one log it asks for. On a real store that made the card wait
  minutes — and because a write returned the recomputed detail, every save (a
  role, a status, a profile assignment) paid for the same scan again, which
  looked like an edit that silently refused to apply.

  The card now answers from the account stores and the feedback store alone;
  the messages counter reports "unknown" and is counted where the transcripts
  are read anyway — the conversations page, whose rows already carry a
  per-conversation message count. A save applies the update response directly
  instead of re-requesting the user, so the checkbox reflects the change as
  soon as the server accepts it.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.9.0 (2026-09-18)

### 🚀 Features

- Let an administrator delete a conversation for real, and keep the sidebar's ([4884054](https://github.com/xarleyn/dsh-plugins/commit/4884054))
  delete what it always was — a per-browser row.

  The console could read, review and rate a conversation but not remove one: the
  only delete anywhere in the surface was the sidebar's, which forgets a chat in
  one browser and nothing else, so a chat that should not exist (a broken
  navigation, a conversation that never belonged, a user's request) stayed on the
  stand forever.

  The deletion is the console's, admin-only (`conversations.delete`) and audited
  (`conversation.deleted`), and it removes what the deployment kept rather than a
  row in a list: the stored logs of the chat and of every session delegated from
  it, the ownership record that is its authorization boundary, its ratings,
  reviews and queue entries, and the sources it collected. The Harness offers no
  deletion seam to lean on — `sessionPersistence` has create/open/flush/stat/list,
  and a live session leaves memory only with the fiber that owns it — so the
  deployment's own storage artifacts are what gets removed, and the console says
  so when a deployment keeps sessions somewhere directories cannot express.

  Refusals come before anything is touched, so a chat is never half-deleted: a
  conversation the Harness still holds open would have its log written back by
  the next flush, and one it never had is not a conversation at all. Both say
  which of the two they are.

- A chat that has been audited now says so, and opens the audit. ([888f303](https://github.com/xarleyn/dsh-plugins/commit/888f303))

  The chat list carries a badge on every row whose session has an audit: a check
  mark and the verdict, with the finding counts on hover. Clicking it opens a
  dialog with the same three views the ordinary DSH session shows — report,
  findings, JSON — over the surface's own shell. The badge and the verdict are
  deliberately two things: the check says an audit exists, the verdict and counts
  say how it went, so a green tick beside "poor" reads as "audited, and it went
  badly" rather than as approval.

  The surface does not scan, watch or index anything to do this. It asks the
  session-audit plugin, which owns the only audit registry, through one optional
  Remote namespace; when that plugin is not installed the namespace never
  resolves, and the rows render exactly as they did before — no badge, no empty
  state, no other change. Nothing in the surface imports the audit plugin, and the
  audit plugin knows nothing about this one.

  Loading is two-step and lazy. The badge costs one summary read per listed chat
  on a slow poll, which is a map lookup on the host; the report and the analysis
  are fetched only when a dialog opens, and the JSON tree is built only when its
  tab is selected. A provider that is slow or absent degrades to a sidebar
  without badges rather than a sidebar that waits.

- Stop a delegated child from being a chat anywhere in the QA surface. ([fc51737](https://github.com/xarleyn/dsh-plugins/commit/fc51737))

  A subagent's session is an implementation detail of one answer: it has no QA
  owner, the Host refuses to attest it, and its sources reach the parent chat
  through the provenance inheritance flow. Nothing enforced that on the way into
  the chat list, though. The browser hands the Host a session id whenever it
  binds one — including a subagent transcript, which the surface opens read-only
  — and the id lands in `ensureSessionAccess`, whose first-come claim ran before
  anything could tell a child from a fresh chat. A child from an earlier Host run
  is not materialized when a browser first presents it, so its header was
  unknown, the claim was recorded, and from then on it rendered as an ordinary
  chat row: the delegated task's title, a transcript that is a subset of the
  parent's work, and no way to send into it. A deployment that ran an affected
  release carries one such record per subagent transcript someone opened.

  Three layers close this, each answering a different question:

  The client projection asks the one that matters to a reader — `isDelegatedSession`
  reads the two marks the host list already carries (`origin`, `parentId`) and the
  sidebar, the chat counter in the account settings and the claim batch all use
  it, so a chat row, a chat count and a migrated index cannot disagree about what
  a chat is. The members list also refuses a stored id that resolved to a child:
  restoring one, or switching to one through a stale browser index, forgets the
  entry instead of opening a subagent's transcript as chat history.

  The Host refuses to write the record in the first place: `QaAccessService.claimSessions`
  filters a browser's legacy chat index before the store sees it, keeping the
  lineage check on the side that can answer it (`QaAccessService.isDelegatedChild`:
  the live registry for a running child, the cached durable listing for one that
  finished).

  And the records already written are reclaimed. `pruneDelegatedOwnership` drops
  ownership rows for ids the Host positively identified as children — no grace
  period, because a chat is never a child, but no guessing either: a listing that
  cannot be read reclaims nothing. The sweep is throttled, runs off the
  reservation path next to the vanished-session sweep, and remembers the listing
  so later refusals need no second read.

  One more artifact of the same family goes away: a refused `createSession` used
  to keep its ownership reservation once the Host session existed, so every
  refusal (an unmounted tool, a permission preset that no longer resolves) left
  an empty "Новый чат" row in the account's list that nothing could remove — the
  browser's delete only forgets it locally, and the record brought it back. The
  reservation is now released on any failure: the browser never learned the id,
  so no chat can exist under it.

- Give a parked question the composer, and make sure it never outlives its turn. ([eb31d34](https://github.com/xarleyn/dsh-plugins/commit/eb31d34))

  While a question from `ask_user_question` was on screen, the composer stayed
  next to it and accepted typing: a send was refused only because the turn looked
  busy, and a turn whose snapshot stopped reporting as running left an empty field
  that looked ready while the model kept waiting for an answer to the form above
  it. The form now takes the composer's place for as long as the request is
  parked, and the composer is hidden behind it rather than unmounted so the draft
  the operator had typed is still there when the answer is sent. The run's own
  stop moved into the form's header, so ending the turn instead of answering
  stays possible, and `interaction.questions` accepts `enabled` as the same value
  as `interactive`.

  A parked request is now live only while the agent that asked is running. The
  asking tool's abort signal already settled a stopped turn, but a request that
  arrived without one — or one whose turn ended by a path that never aborted it —
  stayed parked for the life of the process: the operator kept a form that could
  no longer be answered, and the answer they sent resolved a promise nobody was
  waiting on. The gate also settles what it parked when that agent goes idle, so
  the wait and the form end together.

  The page, in turn, keeps reading the Host's list while a form is visible and
  reads it once per chat binding and per reconnect. A question parked before a
  reload comes back instead of leaving an empty composer in front of a waiting
  agent, a request the turn can no longer answer leaves the screen within a poll
  instead of sitting there answerable but dead, and an answer for a request the
  Host no longer holds is refused rather than silently resolved.

  Two configurations that quietly do nothing were also made visible: questions
  interactive while `lockdown.toolPolicy.allow` does not name `ask_user_question`
  (no form can ever appear), and the tool allowed while questions are refused
  (every ask is turned away). Both now log one `question.config-incomplete`
  warning per attested session, naming which half is missing, and the settings
  card's status view shows the seam's mode and raises the same warning in the
  page, so an operator sees it without reading a log. The lifecycle of the seam is
  reported as `question.claimed`, `question.answered`, `question.cancelled`,
  `question.aborted`, `question.delegated` and `question.refused` — with the shape
  of an answer, never its text.

- Add the slash interface — user-invocable skills and admitted human commands — ([16349e8](https://github.com/xarleyn/dsh-plugins/commit/16349e8))
  as an opt-in layer over the native DSH mechanisms.

  The QA composer had one path, `sendPrompt`, and a guard that turned every
  `/`-leading line away. That guard is still the default: the interface is off
  until `lockdown.allowSlashCommands` is turned on, and a deployment that upgrades
  without touching it behaves exactly as before. When it is on, `/generate-tkp …`
  becomes an ordinary `Session.prompt` carrying the gesture, so the native skill
  consumer injects the instructions and QA reads no `SKILL.md` of its own; and an
  admitted `/compact` goes to the native command runtime, which never turns it
  into a model message and whose `command/run` / `command/done` pair is projected
  from the session log as a control row rather than a bubble.

  Admission is the Host's, twice over. `slashCatalog` answers with a catalog
  already cut down by `slashCommands.skills` / `slashCommands.commands` and by the
  chat's role, and `slashExecute` re-derives the command name from the line it is
  given and re-checks the policy against the deployment's own config, so a
  hand-typed name the palette never showed is refused rather than run. Commands
  default to `deny-all`: a plugin installed on the Host must not put its own
  control-plane command in front of a user who was never offered it. Skills
  default to an empty allow-list too, and the one case that widens anything —
  `allowSlashCommands: true` with no `slashCommands` section at all — admits every
  user-invocable skill of the chat and still no commands, and says so once in the
  Host log.

  `lockdown.allowSlashCommands` is now a real switch. It was pinned at `false` by
  a schema constant and by a resolver that refused `true` outright, which made it
  dead configuration; it stays off by default and opens nothing by itself, because
  what it admits is a second, separate decision. Nothing else moved: the sandbox
  mode, the tool allow-list, the permission preset and the approval policy are
  untouched, and a skill invoked by hand carries exactly the permissions it
  carries when the model loads it.


### 🩹 Fixes

- Read the administrator's capability catalog in the QA preset's scope. ([4ac878b](https://github.com/xarleyn/dsh-plugins/commit/4ac878b))

  `«Общие возможности»` listed almost nothing: the catalog was read globally, while everything a deployment actually mounts — the kit's skill catalog (`search-jira`, `search-docs`, `search-corporate-work`), the preset's tool family (filesystem, web, delegation) — registers in the agent preset's scope. Every skill the operator opens the console to grant was invisible, and the skill-grant ceilings resolved against a tool set that did not contain the preset's tools either.

  The catalog now borrows the standing scope of the preset QA chats run under (`session.agentPreset`; `qa-research` on the stand) — the same key the harness hands a reader as a registry view scope. Resolving it composes the preset but starts no agent, no session and no turn; without a pinned preset, or when the composition cannot be read, the read degrades to the previous global view and the page still opens.

- A failed personal-skills listing no longer hides the whole skill catalog. ([5a96a7a](https://github.com/xarleyn/dsh-plugins/commit/5a96a7a))

  The discovery provider is one voice in the harness skill registry, and the registry treats a throwing provider as an incomplete snapshot: the model-facing available-skills section is withheld in full, for every session, together with the plugin-provided and file-based skills. One account hitting a racy filesystem error on its own `.dsh/skills` directory — an access denied, a share violation mid-read — was enough to answer `SKILL_NOT_AVAILABLE` for every skill name on the stand.

  `discover` now degrades to "no personal skills read" for that account and logs the reason as `skill.discover-failed`, so the rest of the catalog keeps publishing. The editor paths are unchanged: they still surface diagnostics loudly, because there a refusal is the feature.

- Remove a chat's QA record when the Harness has actually lost it — and only then. ([6576e94](https://github.com/xarleyn/dsh-plugins/commit/6576e94))

  The sweep that reclaims ownership records of deleted chats asked the live
  session store what exists, and that store answers only for the sessions this
  process has open. A chat nobody had opened since the last restart was therefore
  absent from the answer without being gone: once its claim passed the grace
  period, the record — the chat's authorization boundary — was reclaimed, and the
  chat left its owner's list, the console and the counters while the conversation
  itself was still on disk. The sweep now asks both halves of what the Harness
  knows, the live sessions and the durable listing, and treats an incomplete
  listing (a deployment that serves no durable query engine, or one that failed
  this read) as a question it cannot answer: it reclaims nothing rather than
  guessing.

  Dropping a chat takes the rest of what the deployment kept about it. Ratings,
  reviews and queue entries are keyed by conversation and outlived it, so a chat
  deleted in the Harness left its verdicts behind, still counted by the metrics
  and still pointing at a conversation the console could not open. The sweep
  hands the ids it reclaimed to the deployment, which drops those rows; the audit
  trail stays, because it records what administrators did rather than what a
  conversation held.

  The review reads run the sweep before listing conversations, so the console
  reflects what exists when it is opened instead of waiting for the next chat
  creation to trigger housekeeping.

- Document where a per-user QA deployment puts its chats in the host UI, and give ([2029e23](https://github.com/xarleyn/dsh-plugins/commit/2029e23))
  the operator a way to repair the stragglers that are still adoptable.

  `accounts.perUserWorkspace` hands every QA chat a private
  `<workspace>/.qa-users/<account UUID>` root and deliberately does not register
  it as a DSH Workspace. DSH grants Workspace membership only to a session whose
  stored cwd IS the Workspace path (`Workspace.attachSession` compares the two
  after `realpath`, and the workspace browser derives its groups from
  `workspace.sessionIds` alone), so those chats appear under `Ungrouped` in the
  host's sidebar. The mode is not misconfigured and nothing can move them
  afterwards: the contract has no attach or membership request for an existing
  session, `insertSessionBefore` reorders only sessions a Workspace already
  accounts, and dragging a session never crosses groups. Registering one Workspace
  per account directory is the one mechanism that would group them, and it would
  put every visitor's scratch root into the operator's global workspace registry.
  README, `docs/CONFIGURATION.md` and SPEC.md now state that consequence instead
  of leaving an operator to rediscover it.

  The second straggler family is repairable and now has a command. A chat created
  while the deployment pinned `session.cwd` - or through `workspaceId` with the
  same directory spelled differently (`E:/base` against `E:\base`) - never calls
  `attachSession` at all, so it lands in `Ungrouped` even though its cwd IS the
  Workspace path. `qa-attach-sessions`
  (`scripts/attach-workspace-sessions.mjs`) adopts exactly those: it reads the
  session store and the workspace registry, matches the stored cwd to a workspace
  path after `realpath`, and writes the membership the host itself would have
  written. Dry run by default; `--write` requires DSH to be stopped, keeps an
  exclusive `*.pre-workspace-attach.bak` copy, replaces the registry atomically
  and re-reads it before reporting success. Sessions below a workspace path are
  reported and refused, because the host re-applies the same comparison on every
  read and would drop them again; subagent sessions and archived sessions stay
  untouched unless asked for. The command changes no plugin runtime behavior.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.3.0
- Updated @yadsh/dsh-audit-core to 0.1.0
- Updated @yadsh/dsh-audit-ui to 0.1.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.0 (2026-09-17)

### 🚀 Features

- Bound what the deployment's own stores keep, and stop paying for the whole ([1453d15](https://github.com/xarleyn/dsh-plugins/commit/1453d15))
  history on every write.

  Durable provenance was one JSON file holding every chat of every user, and
  every agent turn — including every subagent turn — read, parsed and rewrote the
  whole of it synchronously. The cost of a turn therefore grew with everything
  the deployment had ever recorded, and the write blocked the host's event loop
  for every user on the stand: measured on a live deployment, one turn cost 7 ms
  over a 121 KB file and 106 ms over a 12 MB one. Provenance is now one file per
  chat under `$DSH_HOME/qa-sources/`, which is exactly the unit a writer touches,
  because the read path was already per-chat: at the same volume a turn costs
  4.2 ms instead of 106 ms, and filling the store is linear rather than
  quadratic. A pre-0.8.0 `qa-sources.json` is split into per-chat files on first
  use and renamed to `qa-sources.json.migrated-<ISO>`, so nothing is lost and the
  old file stays readable.

  Retention bounds what is kept: the newest 200 turns per chat, the 500 most
  recently written chats, and any chat untouched for 30 days. An old conversation
  still opens; its sources panel may have been released. Every bound is
  configurable under `sources.retention`, and zero keeps everything.

  The accounts file was the only store with no bound at all, and it held two kinds
  of redundant bytes. Every admitted chat froze the capabilities it was admitted
  with, and on a real deployment those snapshots are almost always the same list:
  25 of them were byte-identical and made up 45% of the file. They are now stored
  once per distinct policy with a reference per chat, which took the live file
  from 84.3 KB to 26.8 KB without losing a byte. Nothing removed ownership records
  either, so a record outlived its chat forever: a deleted chat stayed in the
  admin console's conversation list and in its counters for good. The deployment
  now reclaims records of chats the Harness no longer knows, once they are older
  than a day, and never touches a chat that exists — a record is a chat's access
  boundary, so only a vanished chat may lose one. `accounts.retention` controls
  it, including turning it off.

  A completed turn that collected nothing is stored as its turn number rather
  than an empty frame, and an incomplete collection is never collapsed into one.

  The same treatment reached the deployment's other stores, which shared the
  problem: the capability policy and its audit trail, and the feedback, reviewer
  verdicts, review queue and administrative audit, were each one document
  rewritten whole on every change — and every audit row carries the full
  configuration that preceded it, so each change rewrote everything the change
  before it had recorded. They are tables now, in `qa-capability-policies.db` and
  `qa-quality.db`, with one row per record; a change writes what it changed.
  Their previous files are imported once, verified inside the transaction, and
  renamed beside the database, so an existing deployment upgrades without losing
  a policy, a verdict or a line of audit. A file left behind never overwrites a
  record the database already holds.

- Stop a delegated child from being a chat anywhere in the QA surface. ([6471f09](https://github.com/xarleyn/dsh-plugins/commit/6471f09))

  A subagent's session is an implementation detail of one answer: it has no QA
  owner, the Host refuses to attest it, and its sources reach the parent chat
  through the provenance inheritance flow. Nothing enforced that on the way into
  the chat list, though. The browser hands the Host a session id whenever it
  binds one — including a subagent transcript, which the surface opens read-only
  — and the id lands in `ensureSessionAccess`, whose first-come claim ran before
  anything could tell a child from a fresh chat. A child from an earlier Host run
  is not materialized when a browser first presents it, so its header was
  unknown, the claim was recorded, and from then on it rendered as an ordinary
  chat row: the delegated task's title, a transcript that is a subset of the
  parent's work, and no way to send into it. A deployment that ran an affected
  release carries one such record per subagent transcript someone opened.

  Three layers close this, each answering a different question:

  The client projection asks the one that matters to a reader — `isDelegatedSession`
  reads the two marks the host list already carries (`origin`, `parentId`) and the
  sidebar, the chat counter in the account settings and the claim batch all use
  it, so a chat row, a chat count and a migrated index cannot disagree about what
  a chat is. The members list also refuses a stored id that resolved to a child:
  restoring one, or switching to one through a stale browser index, forgets the
  entry instead of opening a subagent's transcript as chat history.

  The Host refuses to write the record in the first place: `QaAccessService.claimSessions`
  filters a browser's legacy chat index before the store sees it, keeping the
  lineage check on the side that can answer it (`QaAccessService.isDelegatedChild`:
  the live registry for a running child, the cached durable listing for one that
  finished).

  And the records already written are reclaimed. `pruneDelegatedOwnership` drops
  ownership rows for ids the Host positively identified as children — no grace
  period, because a chat is never a child, but no guessing either: a listing that
  cannot be read reclaims nothing. The sweep is throttled, runs off the
  reservation path next to the vanished-session sweep, and remembers the listing
  so later refusals need no second read.

  One more artifact of the same family goes away: a refused `createSession` used
  to keep its ownership reservation once the Host session existed, so every
  refusal (an unmounted tool, a permission preset that no longer resolves) left
  an empty "Новый чат" row in the account's list that nothing could remove — the
  browser's delete only forgets it locally, and the record brought it back. The
  reservation is now released on any failure: the browser never learned the id,
  so no chat can exist under it.

- Expose the entry cookie bootstrap and the login attempt budget in the ([756c6bb](https://github.com/xarleyn/dsh-plugins/commit/756c6bb))
  configuration.

  `entry.cookieBootstrap` existed in the defaults and in the config resolvers
  but not in the settings schema, so an operator could not turn the flag off:
  the `/qa` route always bootstrapped the host cookie through the one-time
  `?token=` exchange. The key is now a schema boolean defaulting to `true`
  (the previous effective value), next to `entry.redirectNonLoopback`, and is
  documented in the README's configuration reference.

  `accounts.maxAuthAttemptsPerMinute` was hard-coded at 30 inside the accounts
  store: the browser-facing remotes never passed the option, so a deployment
  could not tune the store-wide login/registration budget. It is now part of
  the `accounts` configuration domain (integer from 1 to 600, default 30),
  included in the accounts-store memoization key so a change rebuilds the
  store, and documented in the README next to the other accounts keys.

- Harden the Host side of the QA surface against malformed and foreign input ([00141f5](https://github.com/xarleyn/dsh-plugins/commit/00141f5))
  found in the host audit.

  The administrative role write now re-validates the role union before it
  stores anything: `adminUpdateUser` accepted an arbitrary string from the
  wire, and a role outside `user`/`reviewer`/`admin` was persisted as-is,
  crashing every later permission check for that account with a `TypeError`.
  The accounts, quality, capability-policy and provenance files are created
  owner-only (`0o600` on POSIX, where the atomic rename keeps the mode;
  Windows ignores the mode and keeps its own ACLs), matching the `0o700`
  directories the plugin already used for per-user workspaces.

  Delegated subagent sessions are no longer attestable from the browser: they
  have no QA owner and their sources reach the parent chat through the
  dedicated inheritance flow, so pinning a capability policy onto one only
  created an unreviewable conversation. The first-come auto-claim of unowned
  sessions in `ensureSessionAccess` is bounded the same way: a session the
  Host knows to be a delegated child is refused outright, and one older than
  the fresh-session bootstrap window (120 s, the same constant the admission
  boundary uses for adoption) is refused instead of being silently attached
  to whoever opened it first. Owners re-attaching after a Host restart are
  unaffected — their claim already exists in the accounts file.

  `qa-sources.json` stopped growing without bound: backstop caps — 256
  sessions, 500 turns per session, oldest first — bound the file, and the
  store keeps an mtime+size stamp of it, so a turn no longer re-reads and
  re-parses the whole JSON it just wrote. Session disposal clears only the
  in-memory records; the durable file intentionally survives, because
  `session/disposed` also fires for runtime teardown of chats that still
  exist and are reopened later — their stored turns are what keep sources
  visible after a Host restart.

  Two small reliability fixes ride along: the question gate folds a malformed
  answer payload (a non-array, a non-object entry, a non-string selection)
  into its existing refusal/skip semantics instead of throwing, and the
  admin ownership listing re-reads the accounts file when another process
  changed it, like every other read in the store.

  One claim subtlety is closed as well: a delegated child session from a
  previous Host run is not materialized when a browser first presents it, so
  its header is unknown and the ownership claim used to be recorded before
  the refusal for delegated sessions could fire. The claim is now deferred
  until the session header is known, so an adopted child never ends up in
  the accounts file at all.


### 🩹 Fixes

- Send the answer ratings a user gives to the Host instead of dropping them in ([e685c90](https://github.com/xarleyn/dsh-plugins/commit/e685c90))
  the browser.

  The rating control files an answer under its durable log position, and the
  client projection dropped that position: `emitTurn` rebuilt the assistant
  message from its collected parts and carried the id, text, timing and turn
  stats, but never `seq`. The browser therefore had no position to file a rating
  under, `QaMessage` called back without one, and the surface's own guard
  returned before making a request — no RPC, no warning, and the 👍/👎 state
  written to `localStorage` first, so the control kept showing the user's choice
  while `qa-quality.json` stayed empty. Every rating a user gave since per-message
  feedback shipped was lost this way, and with it the reviewer's feedback list,
  the derived review queue's negative signal, the quality metrics, and the
  positive/negative counters on a user's activity card.

  The projection now carries the log position onto the answer it emits, and an
  answer that somehow reaches the surface without one reports the loss in the
  console rather than looking filed.

- Keep «Файлы» next to the tabs it belongs to instead of stranding it mid-row. ([6e541b7](https://github.com/xarleyn/dsh-plugins/commit/6e541b7))

  Two header buttons each claimed the row's free space with `margin-left:auto`:
  «Новый чат» (or, when a deployment hides it, the files control through its
  `--end` variant) and «Администрирование». A flex row hands its free space to
  every auto margin in it, so the space split into two equal gaps and the files
  control — the sibling tab of «Источники», opening the other page of the same
  right rail — floated alone between them, in no group at all. Whether it drifted
  depended on an unrelated switch (`ui.showReset`, a fixed session policy or a
  lockdown without `allowSessionReset`), so the same button sat with the tabs for
  one deployment and in the middle of the row for the next.

  The row now carries one right-hand cluster with a single auto margin, and the
  files control stays with «Агенты» and «Источники» in every configuration.

- Render assistant Markdown with the transcript's own grammar and typography ([5ddf384](https://github.com/xarleyn/dsh-plugins/commit/5ddf384))
  instead of a hand-rolled subset.

  The renderer recognized `#`-through-`###` only, so a model that wrote a
  `####` sub-heading — the shape every MR review answer uses for its numbered
  sections — got its hashes painted as literal text. Below that it had no nested
  lists, no task checkboxes, no images, no reference links, no autolinks, no
  strikethrough, no setext headings, and it turned every soft line break into a
  hard one. A fence rendered as a bare `pre`: no language banner, no syntax
  color, and long code sat in a box whose styling shared nothing with the chat
  transcript next to it, while the surface's own theme tokens for Markdown sat
  unused.

  The block and inline grammars now live in `src/client/markdown/`, and the
  stylesheet reads the same custom properties DSH's transcript reads:
  `--dsw-font-markdown-*` for the size ladder (headings, body, tables, inline and
  block code, all following the user's font-size preference and the 0.875 scale),
  `--dsw-alias-markdown-*` for code surfaces, and `--shiki-token-*` for the
  syntax palette — so light, dark, and a re-branded theme all move together with
  the host. Raw HTML still never reaches the DOM, link and image destinations
  keep their protocol allowlist, and a path or link the message knows as a source
  still renders as a source chip.

  A fence now renders as the code card the transcript uses: a sticky-height
  banner naming the language, a copy button, and a small built-in highlighter
  (comments, strings, numbers, keywords, keys, markup, diff roles) for the
  languages answers use. That highlighter is ours rather than shiki's: shiki's
  grammar set alone is ~1.6 MB, which the self-contained client bundle cannot
  carry, so the scanner covers the shapes that carry meaning and renders any
  other language as plain monospace. The whole change costs the bundle ~50 KB.

- Refresh administration and source examples for consistency with the public ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  fixture conventions. No runtime behavior changes.

- Keep the administrator preview inside the chat it was asked for, and report a ([ddb51a1](https://github.com/xarleyn/dsh-plugins/commit/ddb51a1))
  profile's effective capabilities the way a session resolves them.

  `Preview as role` wrote a marker into a history entry, but the surface read it
  once, on mount, and latched the mode in component state. Nothing ever cleared
  it: the role selector — the one control that names the profile in force — is
  hidden while previewing, the corner banner carried no way out, and so every
  later new chat in that tab was created as a preview of the previewed profile
  instead of the account's default one. A chat could therefore run as `Общий`
  while its owner's default profile was another, with the preview banner the only
  sign of it. The mode is now a property of the history entry: a preview
  navigation enters it, an entry without the marker leaves it, an account that is
  not an administrator never holds it, and the banner carries a `Выйти из
  просмотра` control that returns to the account's default profile.

  The same marker was validated against the roles the signed-in administrator
  holds, although the Host allows previewing any enabled role — so previewing a
  role the administrator is not assigned to silently fell back to the default
  profile and told nobody. The marker now carries what it needs and the Host stays
  the authority on who may preview what.

  `Действующие возможности` on a user page counted the configured lists alone,
  against the whole registry. It reported `0 инструментов` for a profile whose
  chats resolve the deployment's entire pinned allow-list, counted the
  skill-grantable ceiling as if those tools were already visible, and ignored the
  skills that reach a role by declaring it in their own `SKILL.md`. The counts now
  follow the same resolution a session uses — pinned set plus Common plus the role
  for tools, the ceiling separately, declared audiences included for skills.

  A scoped restriction and a scoped guard cover the scope that owns them and its
  descendants only, and a delegated child is composed from the parent's preset
  rather than from the parent agent (`applyChildComposition`), so the parent's
  layers never enter the child's chain: an expert was bounded by its preset
  `toolFilter` alone and could hold — and call — a tool the subrole never
  granted the chat. An attested conversation now carries a ceiling of its own,
  held in the admission and inherited by every child session, and a context-global
  guard denies every agent of that conversation anything outside it. The ceiling
  is the subrole's reach: its visible tools plus the ones a skill may grant it, so
  a delegated assistant can still be handed a tool by a skill and can never exceed
  what the role could ever grant. The session's own policy list rides along, which
  keeps the provenance reporter available to delegated runs.

  The deployment's pinned `toolPolicy.allow` reaches every profile, so a pinned
  tool — the read-only `dsh_git_*` provenance tools, for one — could not be
  withdrawn by unchecking it in a role: the operator had to edit the profile and
  restart the Host. `tools.deny` is the third tool class and the way out. A denial
  beats every grant, the pinned set and the Common layer included, and it narrows
  the skill-grantable ceiling, so a skill cannot hand back what the profile
  withdraws. A denial in a role applies to that role, one in Common to every
  profile, and both shrink the conversation ceiling, which is what takes the tool
  away from that role's experts as well. Both editors and the effective-access
  view report it, and a user page subtracts it from the counts it shows.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.4 (2026-09-16)

### 🩹 Fixes

- Never pin a tool the session cannot resolve. With the sources fallback on, the ([7bb58f8](https://github.com/xarleyn/dsh-plugins/commit/7bb58f8))
  admission appended `qa_report_sources` — this plugin's own provenance reporter —
  to the session's tool policy. On a deployment that enables the fallback but does
  not mount the tool, that name failed the mount check and refused every chat with
  `unknown-tools`, the same way an agent-local name in a mask did. The append now
  passes the same mount test as every configured name: where the reporter is
  mounted nothing changes, and where it is not, the delegation fallback is what
  gives way instead of the whole chat, with one `sources.report-tool-unmounted`
  warning in the operator log.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.3 (2026-09-16)

### 🩹 Fixes

- Keep the tools a deployment's agent preset mounts. `tools.restrict()` filters ([eff52d6](https://github.com/xarleyn/dsh-plugins/commit/eff52d6))
  the names a scope INHERITS — the global layer and the ancestor layers, which is
  where a preset's own tool rows live — and the previous release built that list
  from the global layer alone. Every tool the QA agent preset mounts (the
  filesystem, web, subagent and named-expert tools) therefore dropped out of the
  mask and left the model surface: the account-free path refused the session with
  `unknown-tools` naming exactly those tools, and a role-based session answered
  the browser's policy proof with the shortened list, which the browser rejects as
  a mismatch. The mask now leaves out only the names the QA tool catalog registers
  on the agent itself — no restriction can name those — and gives up whatever else
  the registry refuses, so one unnameable entry costs that entry instead of the
  whole call and the whole chat. The proof reports the deployment's pinned list
  again, which is the list the browser compares it against, rather than a role's
  effective one.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.2 (2026-09-16)

### 🩹 Fixes

- Keep the sources a turn produced when the Host's own collection answers with ([f6a80c2](https://github.com/xarleyn/dsh-plugins/commit/f6a80c2))
  nothing for that turn. An empty bundle means "collection saw no sources here",
  not "the answer had none", so it no longer erases the turn the transcript
  itself accounts for: the sources a reader could watch appear while the answer
  ran stay beside it afterwards. A fetched page's card no longer repeats its own
  address either — the snippet starts after the Host web tool's envelope instead
  of at it. The starters editor aligns its two fields on one right edge and
  renders the row's remove control as an icon button rather than as an empty
  input, the skill tool picker clamps long descriptions to two lines inside a
  taller list and shows the full text on hover, and the General section no longer
  lists personal integrations as something still to come. A deployment that hides
  the session list — the default — no longer leaves a signed-in user with no way
  into their own settings: the header carries the entry the sidebar would have
  held.

- Name only inheritable tools in a scoped restriction. The QA tool catalog ([85fa84d](https://github.com/xarleyn/dsh-plugins/commit/85fa84d))
  attaches its tools to the agent itself, and `tools.restrict()` accepts only the
  names a scope inherits: the activation diagnostic is mounted, callable and
  still unnameable in a mask. Passing it made the registry refuse the whole call,
  so every chat's attestation failed with `unknown global tool
  "qa_tools_selfcheck"` and the session was rejected. The base tool set now keeps
  that name out of the mask while the policy and the guard keep admitting it, and
  a skill grant for a tool the agent registers for itself is accepted without a
  mask of its own — the same name used to make every grant attempt collapse
  silently.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.1 (2026-09-16)

### 🩹 Fixes

- Publish the signed-in QA account as a client service. A QA panel plugin receives ([b71afd5](https://github.com/xarleyn/dsh-plugins/commit/b71afd5))
  the account token through its panel props, which is why the integrations page
  could live in the settings dialog and nowhere else: a card mounted in the host's
  own settings has no panel to read it from. `qaUserSession` closes that gap — it
  reports `checking`, `anonymous` or `authed` with the bearer credential the
  principal-scoped QA remotes authorize with, and follows the same account
  controller the pages use, so every mount sees one session. The credential is
  transport authentication only: consumers must not persist it, log it, or place it
  in a URL or a model-visible value.

- Keep the administrative console mounted while it walks its own sections. The ([77bb316](https://github.com/xarleyn/dsh-plugins/commit/77bb316))
  surface recognised the console only at the bare `/qa/admin`, so opening any
  section — and any pasted deep link to a user, a conversation or one message in
  it — fell back to the chat: the console vanished, and every such click left an
  empty chat behind in the deployment's own counters. The console now owns its
  base path and everything under it.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.0 (2026-09-16)

### 🚀 Features

- Add the administrative console behind `/qa/admin`: an authorization model with ([3025adb](https://github.com/xarleyn/dsh-plugins/commit/3025adb))
  the `reviewer` role and named permissions, user management (role, status and
  QA subrole assignment), a filterable list of every conversation with a review
  viewer that reads the stored transcript and the frozen capability snapshot,
  per-message 👍/👎 feedback with an optional reason and comment, a derived review
  queue with the reviewer taxonomy and severity, quality aggregations by subrole
  and over time, and one audit timeline covering both writers.

- Let a SKILL.md declare its own QA routing: the audience it belongs to and the ([2396f48](https://github.com/xarleyn/dsh-plugins/commit/2396f48))
  tools it needs. Tools listed as skill-grantable stay out of the model surface
  until the skill is loaded, activation is capped by the subrole's ceiling, and
  an administrator can extend or withdraw the declaration without editing the
  file.

- Add server-enforced QA agent subroles with Common and role-specific Tool and ([d57c69f](https://github.com/xarleyn/dsh-plugins/commit/d57c69f))
  Skill policies, user assignments, immutable session snapshots, administration,
  audit, role selection, and real-policy admin preview.

- Add `document_from_url`: an online source stored as a document artifact. ([04623a4](https://github.com/xarleyn/dsh-plugins/commit/04623a4))

  The pipeline could already turn Markdown into DOCX/PDF and read a DOCX/PDF back
  out of the workspace, but nothing could take a document that lives behind a URL —
  a wiki attachment, a text document served by an authenticated provider — and put
  it where the other tools work. The new tool fetches the URL through the
  deployment's web provider, so the fetch rules, credentials, address policy and
  byte/char caps configured there decide what may be read; the plugin opens no
  socket of its own, and without a web provider the tool answers
  `BACKEND_UNAVAILABLE` instead of guessing. A text response is written into an
  artifact bundle whose manifest names the operation and the source file, and the
  payload is bounded on both sides: `documents.limits.maxMarkdownChars` for what is
  stored, `documents.extraction.maxInlineChars` for what is returned inline. An
  HTML response is refused with `UNSUPPORTED_FORMAT` (pages are read by the web
  fetch tool), and the fetch layer's own refusal — "the .pdf format is not
  extracted", "no rule matches", a timeout — reaches the model unchanged rather
  than being flattened into a generic failure.

- Move the document pipeline into its own plugin. ([04007c9](https://github.com/xarleyn/dsh-plugins/commit/04007c9))

  The document subsystem — the five `document_*` tools, their backends,
  artifact store, templates, limits and retention sweep — now lives in
  `@yadsh/dsh-documents`. It was never QA-specific: it resolves the calling
  session's working directory and registers plain agent tools, so extracting it
  makes the capability available to any composition and takes roughly a third of
  this plugin's host source, its configuration section and its settings-card
  section with it.

  What a QA chat sees is unchanged: the tool names are identical and become
  visible through the same `lockdown.toolPolicy.allow` entries, and artifacts stay
  where they were (`<session workspace>/.qa/artifacts/documents/<id>`). What
  changes is where the pipeline is configured: `qa-surface.documents` is gone,
  replaced by the `documents` namespace of the new plugin and its own card, and the
  `QA_DOCUMENTS_*`/`QA_DOCLING_*`/`QA_PANDOC_*`/`QA_LIBREOFFICE_*`/`QA_MARKITDOWN_*`
  environment variables became `DSH_DOCUMENTS_*`.

  A deployment that still carries the old section is told so: the plugin logs
  `documents.moved` on each configuration change, naming the new plugin, so a
  leftover cannot silently take the Docling endpoint or the artifact root with it.
  The bundled settings card drops its «Документы» section, and the deployment must
  install `@yadsh/dsh-documents` wherever the allow-list names those tools —
  otherwise the names are missing from the session catalog and attestation fails
  closed, which is the existing behaviour for any allow-list entry without a
  matching tool.


### 🩹 Fixes

- Materialize an account's personal skill root as soon as the account works in ([caee7a8](https://github.com/xarleyn/dsh-plugins/commit/caee7a8))
  its own directory, and make a refused source-bundle fetch visible. Opening the
  editor and discovering skills for a session now leave
  `<personal root>/.dsh/skills` behind, so a hand-made skill directory lands in a
  root that already exists and the manual-edit watcher stops reporting a missing
  directory on every boot of every account. The transcript's source bridge now
  reports a rejected bundle fetch once per distinct reason instead of rendering
  it as a chat that simply carries no sources.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.6.1 (2026-09-15)

### 🩹 Fixes

- Validate the pinned Workspace and permission preset before creating a durable ([a383035](https://github.com/xarleyn/dsh-plugins/commit/a383035))
  QA session. Creation failures now retain a coarse `permission-preset` or
  `workspace-unavailable` reason for browser diagnostics without exposing Host
  details, and failed attestation no longer marks a session as trusted. Existing
  chats whose recorded composition predates a deployment config change remain
  available as read-only transcripts while new chats use the current policy.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.6.0 (2026-09-15)

### 🚀 Features

- Introduce principal-scoped user integrations for QA Surface with an initial ([0bf810f](https://github.com/xarleyn/dsh-plugins/commit/0bf810f))
  read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
  settings page, write-only manual webhook setup, envelope-encrypted secret
  storage, per-user policy and audit records, and four narrowly scoped CRM/chat
  tools whose schemas cannot select a user or credential.

  QA Surface gains a public client settings-section registry and owner-attested
  integration principal binding. Admin cross-user viewing, unowned sessions and
  subagents do not inherit access to another account's integration.

- Give the QA agent documents instead of command lines. Four tools — ([0d1c51f](https://github.com/xarleyn/dsh-plugins/commit/0d1c51f))
  `document_create`, `document_to_markdown`, `document_convert` and
  `document_inspect` — sit on top of a document pipeline that owns every backend
  invocation itself: the model supplies Markdown, a template name and formats and
  receives DOCX and/or PDF, or hands over a DOCX/PDF and receives Markdown with
  its images extracted. Markdown is the canonical source, so the artifact bundle
  keeps the source, the assets, the produced files and a manifest recording the
  input hash, the template hash, the backend versions and every warning.

  The agent cannot reach the converters. As in the git tools, the command line is
  built by the orchestrator and never by the caller: there is no parameter for a
  Lua filter, a resource path or a PDF engine option, remote image references are
  refused rather than fetched, paths are resolved and checked against the session
  workspace before anything is opened, `.docm` files and encrypted PDFs are
  refused with their own codes, and the backends run with a filtered environment
  so ambient secrets and proxies do not reach them.

  Nothing is registered until a deployment wants it: the plugin registers the
  tools when `documents.enabled` is true (the default) and a QA chat still sees
  them only if the deployment lists their names in `lockdown.toolPolicy.allow`.
  Pandoc and headless LibreOffice are assumed to exist where the plugin runs
  (a missing executable answers `BACKEND_UNAVAILABLE`), docling-serve is the
  extractor and defaults to `http://docling:5001`, and Typst and MarkItDown stay
  disabled until a deployment enables them. A second format that fails no longer
  discards the first: partial success is returned with a `FORMAT_FAILED` warning
  and the failed file named. Artifacts live under
  `<session workspace>/.qa/artifacts/documents/<id>` — inside the per-user
  workspace when accounts are on — or in a pinned `documents.storage.root`, where
  retention also works. The settings card gains a «Документы» section for the
  endpoint, the template root, the artifact root and the default choices.

- Attach the plugin's QA tools only after the QA skill has been loaded, so the ([3e73ccc](https://github.com/xarleyn/dsh-plugins/commit/3e73ccc))
  first request of every chat carries the composition's own tool schemas and
  nothing else. Loading the configured skill — by default `qa-surface`, or
  whatever `tools.activationSkill` names — is what unlocks the catalog;
  `qa_tools_selfcheck` reports the resulting state for the calling agent.

  The catalog is registered per agent, so the tools genuinely do not exist for an
  agent that has not loaded the skill: no deny-list has to be kept in sync, and a
  newly added QA tool cannot leak into a chat that never entered the QA workflow.
  Activation follows the authoritative successful result of the built-in `skill`
  tool, never the model's attempt or conversation text. Loading an unrelated
  skill, a refused or failed load, and a repeat load all leave the tool surface
  unchanged, and a registration failure unwinds every tool that attempt
  registered rather than leaving a partial surface behind. Registrations live as
  long as the agent that owns them, so disposal and plugin unload leave no scoped
  tool behind.

  A resumed chat gets its catalog back from its own journal before the first
  model step: the successful skill load is already recorded there as a standard
  tool-call/result pair. The plugin writes no session event of its own — an
  unknown event type without an `ignorable` marker makes a log unreadable to a
  harness that does not mount this plugin, so the restoration marker stays
  derived and a QA session stays openable in a plain DSH deployment.

  QA tools cannot be `lockdown.toolPolicy.allow` entries, because that list is
  validated against the mounted catalog before activation can run and a tool that
  appears only later would fail the check. The QA execution guard therefore
  authorizes exactly the names the activation manager reports for the calling
  agent, which keeps a dynamically attached tool as checked as an allow-listed
  one. Tool visibility is not an authorization boundary.

  New configuration under `tools`: `dynamicActivation` (default `true`; `false`
  attaches the catalog to every managed agent at creation), `activationSkill`,
  `activationMode` (reserved; `all` only), and `activationPresets` — the preset
  gate that keeps an unrelated DSH agent from unlocking the same catalog by
  loading a skill of the same name.

  The shipped catalog contains `qa_tools_selfcheck`. `qa_report_sources` keeps
  its existing registration: it is a subagent provenance fallback, and moving it
  behind a model-visible skill load would remove it from delegated children.

- Show an optimistic user bubble immediately after Send, including local image ([a3f385e](https://github.com/xarleyn/dsh-plugins/commit/a3f385e))
  previews and file handles, while session creation, policy admission and the
  Host's pre-loop preparation are still pending. The bubble carries an animated
  «Подготавливаю ответ…» status, reconciles with the durable user message without
  duplication, and disappears on a refused send while the composer keeps its
  draft.

- Turn `/qa` into a small extension host for optional feature panels. External ([a3f385e](https://github.com/xarleyn/dsh-plugins/commit/a3f385e))
  client plugins register metadata and navigation through `qaSurfacePanels` and
  provide their body separately through the keyed `qa.surface.panel` slot. QA
  Surface supplies launcher ordering, a resizable width-reserving desktop column,
  narrow-screen fullscreen presentation, focus restoration, `keepMounted`
  lifecycle behavior and crash isolation without importing any concrete Browser,
  logs, artifacts or terminal implementation. The stable public types live at
  `@yadsh/dsh-qa-surface/client/panels`, with an external consumer compile
  fixture guarding the contract.

- Give every account skills of its own, and one settings dialog to manage them. ([4a0b429](https://github.com/xarleyn/dsh-plugins/commit/4a0b429))

  A QA user could shape how the assistant answers only through the profile: the
  preset, the tools and the model all belong to the deployment. A skill is the
  first artifact a visitor authors themselves, so it is stored as what the
  harness already defines — an ordinary `SKILL.md` directory below the account's
  own workspace, `<workspace>/.qa-users/<uuid>/.dsh/skills/<name>/SKILL.md` —
  rather than as a format of this plugin's invention. The file stays editable by
  hand, copyable as a directory, and readable by DSH itself; the frontmatter
  fields the editor does not own survive a save verbatim.

  The catalog reaches the model through a `qa-user-skills` provider the plugin
  registers with `ctx.skills`, not through the shipped filesystem provider: that
  one resolves its project root through the nearest `.git`, which for an account
  directory inside a larger checkout climbs above the account and mixes users
  together. Discovery reads exactly one place and only for a cwd that matches the
  `.qa-users/<uuid>` layout, so no account sees another's skills and an arbitrary
  cwd names nothing. Saving invalidates the registry, so a new skill is usable
  without a restart, and a lazy bounded watcher covers files edited outside the
  editor.

  `allowed-tools` is stored as declared and never grants anything: the effective
  set is the intersection of what the QA scope allows with what the skill
  declares, an unavailable tool is reported and kept in the file so an imported
  skill stays repairable, and the editor says so in as many words. Runtime
  restriction of an active skill's turn is deliberately not implemented — the
  harness has no reliable active-skill seam for a plugin, and promising
  enforcement the code does not perform is worse than not offering it.

  The separate profile modal is gone. The account button now opens one
  `Настройки` dialog with a section list — `Профиль`, `Общие`, `Навыки` — and
  the profile page inside it is the old form unchanged: same fields, same
  storage, same limits, same instruction that it widens no tools. The skills
  section is a catalog with search plus an editor carrying the description, the
  "when to use" hint, the invocation flags, the Markdown body, a tool picker over
  the deployment's registry and a preview produced by the same serializer a save
  uses. Saving is atomic and carries the revision the editor read, so an edit
  made in another tab or by hand is refused instead of overwritten, and a delete
  moves the whole directory to `.dsh/skills-trash/`.

  The editor asks the Host for the file a draft would write and for the
  authoritative diagnostics (`skillsValidate`, which also carries the operator's
  own size limit), because a YAML library's Node build carries `require` calls
  the DSH client module loader cannot answer: bundling it stopped the packed
  surface from mounting at all. The shared rules that need no YAML live in one
  browser-safe module, and the package gate now rejects any Node builtin in the
  client bundle.

  Deployments that cannot host the feature — accounts off, or
  `accounts.perUserWorkspace` off, since there is no shared fallback to store a
  personal skill in — resolve `accounts.skills.enabled` to false and simply see
  no Навыки section.

- Let every account define its own starter messages. ([d92eb2f](https://github.com/xarleyn/dsh-plugins/commit/d92eb2f))

  The three pills above an empty composer were deployment-wide and
  label-equals-prompt: `suggestedQuestions` is a list of strings where the text
  on the button is also what pressing it sends. A user whose everyday request is
  a long tracker query had no way to keep a short button for it.

  The `Настройки` dialog gains a «Быстрые сообщения» section. Each entry is a
  pair — the label the button shows and the prompt pressing it sends — and a
  toggle hides the deployment's standard suggestions for that account. The list
  is stored on the account next to its profile, replaces wholesale on save
  through the new `accountsUpdateStarters` remote (token-scoped like the profile
  write), and is projected to browsers on `QaAccountUserPublic`, so the composer
  picks the change up without a reload. An anonymous visitor, a deployment with
  accounts off, or one with the new `accounts.starters.enabled` flag off sees
  exactly the previous behavior. The stored record is pure UI preference: unlike
  the profile, none of it is injected into the agent prompt.

  Validation and limits live in one browser-safe module (`src/starters.ts`) the
  Host store and the editor form both import: at most 12 starters, labels up to
  80 characters, prompts up to 2 000, and an incomplete pair — a label or a
  prompt left empty — is refused on the write path and dropped on the read path,
  so a hand-edited accounts file never yields a dead button.

- Sign subagent completion notices with readable names instead of raw session-id ([fe5aceb](https://github.com/xarleyn/dsh-plugins/commit/fe5aceb))
  hashes. The projection resolves the settled child's delegation description from
  the host session list (the same title the agents panel shows) and, when the new
  `ui.subagentCodenames` switch is on — the default — signs the notice with a
  deterministic adjective-noun codename («Дотошный Барсук») folded from the
  session id. The real task name and the short id move into a muted meta line
  inside the expanded notice, so a plaque stays matchable against the session
  logs either way. Delegating agents are also asked, through a conversation
  note, to give each delegation a short vivid description of its own — the
  name that then shows up in the agents panel.


### 🩹 Fixes

- Brand the tab favicon while the surface owns the route. The guard swaps the ([a3f385e](https://github.com/xarleyn/dsh-plugins/commit/a3f385e))
  favicon to `branding.logoUrl` for as long as the QA route is active — the same
  logo the sidebar and the auth gate render — and restores the host's own icon
  links on exit. On proxy-fronted deployments `DSH_QA_FAVICON_URL` pins the icon
  from the first paint, before any bundle loads.

- A crash inside the QA surface no longer uncovers the operator harness. ([8e97eb6](https://github.com/xarleyn/dsh-plugins/commit/8e97eb6))

  The QA overlay is a `shell.overlay` slot entry, and the host's per-slot
  isolation retires an entry that throws during render: the cell falls through
  to its (empty) crash face, the overlay disappears, and the harness shell it
  exists to cover — settings, native sessions, everything the deployment means
  to keep away from QA visitors — becomes reachable on the same page. One
  render-time `TypeError` anywhere in the surface tree was enough.

  The registered entry is now its own error boundary (`QaSurfaceGuard`) that
  the host never sees past: a crash swaps the surface for a fullscreen failure
  card in the same opaque overlay class, with a reload button as the recovery,
  and logs the error for the operator console. The slot inject joins the same
  contract — its lazy host-service reads degrade to an empty face instead of
  throwing, which lands in the guard as the same failure card rather than an
  abdicated entry.

  The same trade existed without any crash: the overlay only *covered* the
  harness, which stayed mounted and fully alive beneath it, so deleting the
  overlay element in the browser revealed the operator shell on the same page.
  While the surface owns the route, a stylesheet rule now masks every sibling
  of the host's overlay layer inside the app frame — hanging off the
  `data-dsh-qa-surface` body attribute rather than off the overlay node, so
  element deletion changes nothing. The attribute is owned by the guard, above
  the error boundary (a crash unmounts the surface, not the mask), and a face
  that fails to assemble keeps the page masked as well; off-route the mask
  lifts and the host shell is the page again.

  A reload on the QA route also flashed the harness for a moment, because the
  harness mounts and paints before the plugin's client bundle registers the
  overlay. On proxy-fronted deployments the proxy now injects a boot mask into
  the served HTML: on `/qa` navigations the body stays hidden from the first
  paint, and the guard lifts it in the same synchronous block that takes the
  page over (`data-dsh-qa-boot="done"`), with a fail-open timeout so a
  deployment whose plugin never loads still reaches the harness.

  The browser tab is part of the same picture: while the surface owns the
  route, the guard swaps the favicon to the deployment's `branding.logoUrl`
  (the same logo the sidebar and the auth gate render) and restores the host's
  own icons when the route is left. On proxy-fronted deployments,
  `DSH_QA_FAVICON_URL` pins the icon from the first paint, before any bundle
  loads.




- Keep one leading separator on POSIX source paths. The lexical canonicalizer ([abfbaca](https://github.com/xarleyn/dsh-plugins/commit/abfbaca))
  shared by the evidence bundle, the reported-source validation and the file
  preview prefixed an absolute POSIX path with a second `/`, so on Linux
  deployments a source read from a shared read-only root was echoed as
  `//shared/...` and the preview assertion failed the Linux CI leg. A drive
  spelling keeps its canonical `c:/` form and workspace-relative spellings are
  unchanged.

- Open the source preview over the roots the QA read policy already grants. The ([720cf66](https://github.com/xarleyn/dsh-plugins/commit/720cf66))
  endpoint validated a source against the session's `cwd` alone, so a file the
  assistant had legitimately read from a shared read-only directory — the normal
  shape of a deployment that keeps `docs` and `code` beside the per-account
  scratch directory — was refused as an escape and the panel reported it as
  moved. The preview now reads the chat's `cwd`, every
  `lockdown.sharedReadOnlyRoots` entry and the mounted attachment store, mirroring
  the per-user execution guard, and it canonicalizes the requested path the same
  way the evidence bundle did, so the browser's spelling of a file (its
  projection uses the configured `session.cwd`, which is null for a chat pinned by
  `workspaceId` or by an account directory) no longer decides whether a preview
  opens. Refusals carry a coarse `(reason: <code>)` marker and the panel says
  which directory group a file falls outside instead of calling every refusal a
  moved file.

- Restore the account settings dialog's visual quality. The dialog renders ([a3f385e](https://github.com/xarleyn/dsh-plugins/commit/a3f385e))
  outside the `.dsh-qa-surface` element, so none of the `--dsh-qa-*` custom
  properties reached it: the backdrop never dimmed and the primary Save button
  lost its brand fill. The brand tokens now ride the `.dsh-qa-modal` root as
  well, and the border-box reset covers its subtree, so full-width fields with
  horizontal padding no longer grow past their column and run under the modal's
  right border.

  The panel drops from a fixed 920x680 to 840 wide and hugs its content up to
  the capped height, each page gains a title, and the form actions become a
  full-bleed footer strip (sticky within the scrolling content) so Save is
  always visible, matching the compact profile modal this dialog replaced.

- Keep the transcript's drag handles off the answer. The width handles claim a ([f9751bc](https://github.com/xarleyn/dsh-plugins/commit/f9751bc))
  40px strip just outside the text column, and the break-out that let code blocks
  and wide tables use the page gutter was measured against the browser viewport
  instead of the chat column — with a side panel or drawer open it overshot both
  the column and the strip, so the handle (and its drag glow) painted on top of
  tables and code. The gutter is now measured from the live column the way the
  handles are, the break-out is capped eight pixels short of the strip and is
  zeroed on the phone layout where the handles are hidden, and tables no longer
  break out at all: they sit in the text column, sized to their content instead
  of stretched to the column width, with per-cell ceilings computed from the chat
  width so a long column wraps rather than inflating the table — anything wider
  than the column scrolls inside its own frame.

- Keep plugin-specific records out of Harness session journals so sessions remain ([82d5890](https://github.com/xarleyn/dsh-plugins/commit/82d5890))
  readable after a DSH restart even when linked packages resolve separate module
  instances. Safety audit records now use the plugin logger with explicit session
  ids, QA source snapshots use plugin-owned durable storage, and the QA package
  ships a dry-run-first repair command for legacy journals with automatic backups.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.0 (2026-09-14)

### 🚀 Features

- Answer a composed tool gate's `ask` in the QA view. `interaction.approvals` ([570d010](https://github.com/xarleyn/dsh-plugins/commit/570d010))
  now takes `blocked` (default) or `interactive`: an interactive deployment parks
  the call on the Host, lists it over the composer with the gate's own reason and
  the two stock outcomes (Reject / Allow once), and applies the operator's answer.
  A request is Host state, so it survives a page reload, and the turn's own
  cancellation settles it when it is never answered. The QA listener is owned by
  the plugin context, so it also wraps delegated children, acts only on attested
  chats, and never approves anything without a person — the pinned
  `approval=never` policy stays the fail-closed backstop.

  `interaction.questions` does the same for `ask_user_question`: `unsupported`
  (default) refuses the request with a reason the model can act on, because the
  stock DSH browser answerer sits behind the QA overlay where nobody can reach it,
  while `interactive` parks the request as a form over the composer — one question
  at a time with a pager, radio/checkbox options, free text, and explicit skip and
  cancel. A skipped question is reported as skipped, never guessed. The tool
  itself still has to be mounted by the deployment preset and named in the tool
  allow-list.

  The same listener keeps refusing a parked `ask` with the QA reason while
  approvals are blocked, so a headless `approval=never` decision is no longer
  misreported as a user rejection. The per-user path guard supports absolute
  `sharedReadOnlyRoots` for reviewed filesystem read tools while keeping every
  write inside the account directory, and no longer rejects read-only `dsh_git_*`
  tools by name; repository selection remains the responsibility of the
  separately configured Git plugin.

- Let a deployment record sources the model reports as facts. A source reaches a ([b7621a8](https://github.com/xarleyn/dsh-plugins/commit/b7621a8))
  turn either from a tool call the surface observed or from the `qa_report_sources`
  tool, and the second channel refused more than it looked like it did. Only a
  delegated run could report at all, so the QA agent reaching for the tool itself
  was answered with `Recorded 0 source(s)`; and every entry needed a path or a URL
  that survived normalization, so a source describing a fact — the kind `other`,
  a title, a snippet, a note that it came from the user's profile rather than from
  a search — was dropped even inside a run.

  The new `sources.subagents.validateReportedSources` flag (default true, so the
  shipped behaviour does not change) turns both checks off. A report from the QA
  agent lands in that session's current turn, exactly where a tool-derived source
  of the same turn would, and an unaddressed entry keeps the type, title and
  snippet the model wrote under the identity `reported:<kind>:<title>`. A URL the
  normalizer cannot parse is kept verbatim instead of discarded, and a missing
  title falls back to the last path or URL segment. An entry with neither a title
  nor an address is still dropped: there would be nothing to render in the source
  panel, and the file-preview capability still follows a path alone.

  The switch ships as a toggle in the settings card's «Источники» section, under
  «Субагенты», beside the report channel it governs.

- Give the accounts CLI a way to reset a password. The store keeps only scrypt ([16f6448](https://github.com/xarleyn/dsh-plugins/commit/16f6448))
  hashes, so the `qa-accounts` command set could create an account and change its
  role, but nothing could put a password back: a QA user who forgot theirs was
  answered by an operator hand-editing `qa-accounts.json`, and dropping the entry
  to re-add it would have minted a new account id and stranded every chat that
  account owned in the ownership map.

  `qa-accounts set-password <email> --password-stdin` rehashes in place. The
  account keeps its id, so its profile and its claimed chats stay its own, while
  the password it replaces and every token minted under it stop working: the token
  version bumps, exactly as it does on `disable` and `revoke`, so a reset doubles
  as the single-step answer to a leaked credential. The address is validated like
  `add` — a weak password is refused with `weak-password` and leaves the stored
  one untouched — and the password is read from stdin, one line, so it never lands
  in shell history.

  The length rule now lives in one shared `validatePassword`, used by
  registration, `addUser` and the reset, so a password good enough to register is
  exactly the one an operator can put back. `docs/CONFIGURATION.md` and the
  accounts spec list the new command alongside the rest of the operator set.


### 🩹 Fixes

- Keep a QA chat openable after the Host restarts. DSH materializes an agent on ([7909005](https://github.com/xarleyn/dsh-plugins/commit/7909005))
  demand — a session's journal opens straight from persistence, and only
  Agent-bound work (a prompt, a model selection, an upload) resolves or resumes
  one — so a chat from an earlier Host run had a readable transcript and no agent.
  Attestation, the first thing in this surface that needs an agent, refused it
  with `agent-unavailable`, and every restored chat was unopenable until something
  else in the Host happened to wake it: the sidebar answered «Не удалось открыть
  этот чат.», and the startup restore abandoned the previous chat and bootstrapped
  a fresh session instead.

  Attestation now resumes it. `secureSession` resolves the session through the
  Host's session controller before the policy checks, composing the preset that
  session recorded — the same composition a stock prompt would produce, so a chat
  composed outside the QA preset still lands on the existing mismatch refusals.
  The policy is pinned on the resumed agent, and a resume that cannot produce an
  agent (a recorded preset that no longer mounts, a log the Host refuses to read)
  still refuses, now with the composition detail logged Host-side under
  `session.agent-resolve-rejected`. The browser console gained an operator hint
  for `agent-unavailable` instead of the generic "facts are in the Host logs"
  fallback.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-13)

### 🚀 Features

- Flip the QA transcript width bound from a cap to a floor. The surface used to ([466b4f5](https://github.com/xarleyn/dsh-plugins/commit/466b4f5))
  carry an operator-set `ui.maxContentWidth` that no drag could pass, so a QA
  deployment with a wide screen left the transcript boxed in at 900px. The
  setting is now `ui.minContentWidth` (default 650): the drag handles narrow the
  transcript no further than that, and apart from it the page is the only
  ceiling — the content keeps widening until its handles reach the edge budget,
  which is how the DSH conversation column itself is bounded. A window too narrow
  to hold the floor wins over the floor, because there is no other space to take
  and the handles have to stay reachable.

  The width a browser persists is still clamped before it is written, so a stored
  preference from the capped era resolves against the new bounds instead of
  surviving as an out-of-range value. Deployments that still carry
  `maxContentWidth` keep working on the shipped default: the removed key is not
  part of the schema and is ignored, and the settings card's field is relabelled
  "Минимальная ширина содержимого, px".

- Surface provider retries and failed turns in the transcript. The Host-side ([789b986](https://github.com/xarleyn/dsh-plugins/commit/789b986))
  llm-retry already recovers transient provider failures, but the QA projection
  rendered neither the scheduled retries nor the failure code: a dropping turn
  read as a normal "Готово за N с".

  Model-retry nodes now project as work-group rows: the scheduled wait counts
  down live, while started and cancelled retries settle into history. Turn-error
  rows render copy derived from the failure code only (a transport drop, a rate
  limit, a quota or auth escalation) instead of one generic line, so raw provider
  messages never reach QA-facing rows. A turn the Host ended with an error marks
  its work group as failed, which the work group labels "Прервано за N с" and
  styles accordingly.

- The sources drawer becomes a collapsible right rail with tabs, mirroring the ([908efc6](https://github.com/xarleyn/dsh-plugins/commit/908efc6))
  Harness right Sidebar's interaction pattern (a tab strip is the panel's whole
  top edge). The rail hosts «Источники» — the same grouped list and safe
  file-preview the drawer rendered, with a message footnote still opening it
  pinned to that answer's subset and a new «Все источники» way back — and a new
  «Файлы» tab: every attachment the visitor sent in this chat, grouped by
  message and ordered newest first, with file cards (badge, name, size) and
  image thumbnails resolved through the session's asset repository. Each group
  jumps back to its message in the transcript. The header gains a «Файлы»
  button with a live count; the agents drawer keeps its behavior and closes
  when the rail opens. Below 600px the rail goes full-bleed like the drawers
  did.

  The Host mechanism for right-sidebar tabs was deliberately not used: the QA
  page is a full-frame overlay painted over the Host shell, so the Host's own
  right column stays invisible and unreachable behind it while `/qa` is active.

- Add an operator settings card for the deployment. The `qa-surface` namespace ([cfd56a4](https://github.com/xarleyn/dsh-plugins/commit/cfd56a4))
  was readable from the Host settings page but editable only by hand-editing the
  profile; the browser half now registers a card into the shared
  `settings.plugin.item` slot — Settings → Plugins → plugin configuration →
  «Помощник QA» — with nine sections: the running state, the route, branding, the
  session, the interface, the lockdown, accounts, sources, and embedding.

  The card writes the user layer of the namespace through path-addressed
  mutations, so every change stays revertible through the card's own reset, and it
  reports what the running Host resolved next to the form, read through
  `qaSurface/describe` while the card is visible. Values the resolver refuses in
  isolation are written together in one mutation — a provider with its model,
  `accounts.perUserWorkspace` with the `workspace-write` sandbox, which is also
  refused alone — and a control the resolver would reject is disabled with the
  reason stated instead of offered. The values that cannot be configured
  (`approvalPolicy`, the white-list mode, the forbidden capability flags) stay
  visible as facts.

  Two transport details shaped the card. A write the Host refuses does not reject
  the settings scope's promise: the scope reloads Host state and settles, so the
  card confirms acceptance itself — the namespace revision advances on every
  committed change, and a write that changed nothing is answered by the section —
  and reports a refusal instead of leaving a control that silently does nothing.
  That report also survives the status poll, which a shared error channel would
  have wiped within one interval. The card renders only where the settings
  namespace is readable, which the DSH gateway pins to loopback.

- Make the running indicator's phrases configurable. The list a QA surface cycles ([f99d72f](https://github.com/xarleyn/dsh-plugins/commit/f99d72f))
  through while a turn runs was compiled into the browser bundle; it is now the
  `thinkingPhrases` config field, so a deployment can speak its own vocabulary
  instead of the shipped workshop imagery.

  The work block's label and the composer hint read the same entry and advance it
  together every four seconds, off the same turn start, so the two can no longer
  disagree about what the surface is doing. The canonical default list moves out
  of the client component into the shared config module, which keeps the schema,
  the resolver and the browser on one list.

  Like `suggestedQuestions`, the field drops blank and duplicate entries and caps
  a phrase at 120 characters. Unlike quick questions, an empty list cannot hide
  the control: an empty or absent list restores the built-in phrases, because the
  indicator always needs a label.

  The settings card's "Фразы ожидания" field shows the list that is actually in
  effect — the stored list when there is one, otherwise the list the running Host
  resolved, and the built-in list before the Remote answers — instead of an empty
  box for a setting that is doing something. Typing in any list control now
  survives a parent render: the draft follows the stored text rather than the
  array identity, so a caller that renders an unset list from a literal default
  no longer wipes the field on the next render.

- Give QA accounts a self-declared profile. `accounts.profile` collects a full ([7d50bc9](https://github.com/xarleyn/dsh-plugins/commit/7d50bc9))
  name, one handle per external system the deployment declares, and free-form
  instructions about how the account wants answers; the owner edits them from the
  sidebar footer, and the deployment decides which handle fields exist and how
  long the instruction text may be.

  The Host injects both into the QA agent's system prompt: one section names the
  user with their email and handles, a second carries the user's own wording
  framed as preferences that cannot move tools, permissions, the sandbox, or any
  rule the deployment set. Both are re-resolved on every prompt assembly, so a
  profile edit lands on the next turn, delegated experts included.

  The account token is the only identity on the wire, so a browser can write
  nothing but its own profile, and the prompt says the values are self-declared
  rather than verified directory attributes.

- Add opt-in per-account writable research directories below the configured DSH ([b17aee2](https://github.com/xarleyn/dsh-plugins/commit/b17aee2))
  Workspace path. Session creation and ownership move to the Host, child
  directories stay out of the Workspace Registry, and canonical path guards,
  subagent inheritance, process/git denial, and storage quotas keep model file
  access inside the owning account's directory.

- Let a QA visitor attach text files, not just images. A composer attachment is ([6f29bf0](https://github.com/xarleyn/dsh-plugins/commit/6f29bf0))
  now one of two kinds: an image still rides the prompt inline as base64, while a
  file is staged on the Host through the browser upload service first and the
  prompt cites the returned receipt. The Host stores the file verbatim and its
  prompt assembly hands the model the name, the size and the read-only path of
  the stored copy, so a `.md`, `.txt` or `.log` reaches the model through the
  same handle every other attachment does.

  Pasted plain text over a line threshold becomes an attachment instead of a wall
  of text in the input field. `attachments.pastedTextLines` (default 200) sets
  that threshold and `0` turns the conversion off; the resulting file is named
  after its line count, e.g. `Вставленный текст (312 строк).txt`. Everything
  shorter pastes into the field as before.

  The `attachments` config section carries the rest of the policy:
  `textFiles` switches file intake off entirely (images remain), `maxFileBytes`
  caps one file, `maxPending` caps images plus files on one message — replacing
  the compiled-in limit of eight images — and `extensions` names the accepted
  text extensions. A file whose extension is not listed is still accepted when
  the browser reports its type as `text/*`, so an empty list narrows the intake
  rather than closing it.

  The settings card gains a "Вложения" section for all five fields, and the
  transcript renders a sent file as an extension badge, its name and its size.
  Files are never readable back through the attachment route (that route serves
  images), so the sent row shows the same handle the model resolves.

  In the per-user workspace mode the monotonic path guard now exempts read-only
  access to a single file under the mounted attachment store's root. Uploaded
  copies are immutable, content-addressed and live outside every workspace, so
  without that exemption the model would be denied the exact file the prompt
  points it at. Directory-wide tools stay confined, because the store is shared
  by every account, and writes are never exempted.

- Open the "История версий" dialog at the wide panel width the profile dialog ([35514a1](https://github.com/xarleyn/dsh-plugins/commit/35514a1))
  already uses. Its entries are full sentences, so the shared 560px panel
  stranded a word or two on every second line; the 720px panel leaves them on
  one line and keeps the two dialogs the same size, which is what a reader
  opening one after the other expects.

  The panel width stays a property of the dialog and not a preference: neither
  dialog is resizable, so there is no width for the browser or the deployment to
  persist and no bounds to keep in sync with the viewport. Both keep the
  `max-height` cap and scroll their body on a short window.

### 🩹 Fixes

- Reorganize the plugin sources without behavior changes. The settings card ([789b986](https://github.com/xarleyn/dsh-plugins/commit/789b986))
  sections, the config resolver, the accounts store, and the QA surface split
  into per-domain modules: one file per card section, one resolver per config
  domain, the account token/file/credential layers beside the store facade, and
  the header, right-rail hook, prompt staging, and stream publisher extracted
  from the surface and the session controller. The repeated browser storage-key
  derivation and the base64 helper moved into shared modules. Public exports,
  wire contracts, storage keys, and timing semantics are unchanged.

- Remove internal project identifiers from the shipped sources and fixtures. The ([e1a4981](https://github.com/xarleyn/dsh-plugins/commit/e1a4981))
  provenance specification (`docs/*.md` ships in the tarball) and the provenance
  test used a real Jira project key, a real task title and real product and
  document names in its examples; they now read `PROJ-123` with placeholder
  titles, a generic product path and a generic knowledge-base page. Only the
  example content changed — the provenance contract, the source-kind table and
  the worked walkthroughs describe exactly the same behaviour.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Optional QA accounts and entry routing. `accounts.enabled` mounts a ([dc2f582](https://github.com/xarleyn/dsh-plugins/commit/dc2f582))
  full-frame login/registration gate (email + password, coarse audience-safe
  refusals, per-store rate limiting, self-registration toggle) backed by
  `$DSH_HOME/qa-accounts.json`: scrypt password hashes, a persisted HMAC secret
  for stateful-expiry account tokens, and a session ownership map. Ownership is
  first come, first served - attesting or bulk-claiming an unowned session binds
  it to the caller (the migration path for existing per-browser chats on first
  login); sessions owned by another user refuse attestation with
  `session-owned-elsewhere` and stay hidden from the sidebar, admins are not
  refused. The identity rides as an explicit token argument into the gated
  `qaSurface` remotes (the typert carrier never exposes HTTP requests), the
  policy admission checks it before any session fact is revealed
  (`auth-required` reopens the gate on expiry), and the account chip with
  logout lives in the sidebar footer. `entry.redirectNonLoopback` injects a
  guarded head script through the `webserver/index-inject` event that continues
  non-loopback hostnames into the QA route - the navigation-marker hand-off is
  never redirected (no loops), `/?ui=admin` persists an operator bypass and
  `/?ui=qa` clears it. Accounts are an identity layer for the QA surface, not a
  harness boundary: QA users still hold the shared host launch-token cookie.

  Follow-ups adopted from a review of the independent dsh-auth-gate plugin: a
  proxy-side deny list for the privileged config-plane RPC methods behind the
  deploy proxy's Host/Origin rewrite, a plugin-side launch-token bridge
  (`entry.cookieBootstrap`) that performs the one-time host-cookie exchange on
  the `/qa` route itself, a `qa-accounts` bin CLI (list/add/set-role/disable/
  enable/revoke) so account administration never requires hand-editing the
  JSON file, and per-account state — a `disabled` flag refusing logins with
  `account-disabled` plus a `tokenVersion` burned into tokens that
  `disable`/`revoke` bump, making logout and lockout server-side facts.

  Admins get cross-user views over the same ownership map:
  `qaSurface/accountsListOwnership` (admin-only, `admin-required` refusal
  otherwise) returns every chat with its owner's resolved display name, the
  admin sidebar switches to per-owner sections ordered by their freshest chat
  (unclaimed chats trail under "Без владельца"), and user messages in foreign
  chats carry an `author` byline naming the chat owner. Ordinary accounts and
  deployments with accounts disabled keep the flat sidebar and unlabeled
  messages.

- The chat-history sidebar gained a footer version button that opens an ([d9d5868](https://github.com/xarleyn/dsh-plugins/commit/d9d5868))
  end-user changelog dialog: a curated per-version summary (new features and
  fixes in Russian) rendered in a themed modal with Escape/backdrop close.
  The bundled version and entries are pinned to package.json and the release
  CHANGELOG by a unit test, so a release cannot ship a stale dialog.

- Rebuild the client on the 0.1.5 surfaces: the transcript projects from the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  ui-chat conversation view's legacy slice, chat/model pinning moves to the
  wire remotes (`agentPresets.select` on the still-blank session, then
  `session.selectModel`) with the attestation ordering preserved, and
  history reads go through the session-v3 surface. The supported host range
  moves to `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.

- Harden the gated QA experience and make cross-user history explicitly ([2ed2024](https://github.com/xarleyn/dsh-plugins/commit/2ed2024))
  opt-in. A new `accounts.showOtherUsersChats` setting defaults to `false`, so
  administrators only see their own chats unless the deployment enables the
  shared ownership view. Account storage now follows external CLI updates and
  uses process-scoped temporary writes, while session admission and client state
  handling avoid stale async results and reset session-bound assets reliably.

  The QA client now presents a dedicated test-interface disclosure, improves
  chat search and owner matching, keeps row actions from disturbing result
  layout, distinguishes administrator roles, and removes decorative middle-dot
  separators from the sidebar, messages, and source details. Its curated 0.3.0
  history entry is prepared in advance, while the current-version marker is
  injected from package.json at build time so the release bump promotes it
  without another source edit.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-10)

- Added DSH-style symmetric transcript/composer width handles with adaptive
  defaults, viewport clamping, and per-route browser persistence.
- Added Host-owned structured source provenance for parent and delegated turns,
  replayable `qa/sources` snapshots, dedupe/ranking, opaque-provider reporting,
  grouped source UI, and safe rendered/raw file previews.
- Updated packed Host/browser smoke coverage for browser authentication,
  revisioned client batches, scoped Remote injection, and current Typert RPC
  envelopes.

### 🚀 Features

- Make the QA surface a complete end-user assistant shell: image attachments ([b9af082](https://github.com/xarleyn/dsh-plugins/commit/b9af082))
  (drag & drop, paste, and a picker with removable previews; base64 prompt
  parts the Host promotes to durable attachments, rendered back as clickable
  thumbnails), subagent delegation presentation (launch work items with the
  durable child id, settlement notices collapsed into titled expandable rows,
  an agents panel listing the chat's subagents, and live read-only subagent
  transcripts with a one-click return), source cards with a full-output detail
  pane, clickable links and an open action, answer regeneration with
  ChatGPT-style variant switching, message ratings with hover response
  metadata (duration, TTFT, tokens per second), a data-usage disclaimer
  plate under the composer, per-browser chat history
  ordered by host updates with search and a collapsible sidebar, lazy draft
  chats that create nothing until the first prompt, directory/workspace
  pinning with a dedicated `workspace-unavailable` refusal, the company
  interaction palette as `--dsh-qa-*` tokens, and a split of the surface into
  focused drawer, switcher, and formatting modules.

### 🩹 Fixes

- Pack the generated Typert host and remote-client entrypoints: the `files` ([0059cb4](https://github.com/xarleyn/dsh-plugins/commit/0059cb4))
  allowlist only kept declarations under `lib/types/`, so the `./remote` and
  `./typert` exports previously shipped without their implementation modules
  and type definitions.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-06)

### 🩹 Fixes

- Add the dedicated browser QA surface backed by native DeepSeek Harness ([dfdc430](https://github.com/xarleyn/dsh-plugins/commit/dfdc430))
  sessions.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 - 2026-09-05

- Added the `/qa` full-screen overlay backed by native DSH sessions.
- Added persistent, new-on-load and fixed session policies.
- Added streaming transcript, Stop, New chat, safe Markdown and responsive UI.
- Added Host settings registration and safety filtering for internal events.
- Added a narrow Host navigation redirect for DSH releases whose static
  frontend returns 404 for direct `/qa` requests.
- Added fail-closed Host policy attestation, the `qa-read-only` permission pin,
  an inherited-tool allow-list, and a monotonic execution guard.
- Disabled session reset by default and added capability-regression gates.
- Refined the QA surface with first-party-style conversation chrome, plain
  assistant flow, user bubbles, copy actions and a floating two-row composer.
- Added opt-in reasoning and tool-call details grouped into a live turn work
  disclosure that collapses to a `Worked for …` summary before the final answer.
- Added an optional minimal chat-history sidebar (`ui.showSessionList`) with a
  per-browser localStorage chat index, attested switching and a gated
  New chat control.
- Send-time policy attestation now survives a Host that idled the session's
  agent out: the client re-binds the session (re-materializing the agent) and,
  when the refused session is still blank, continues in a fresh attested
  session instead of surfacing an error.
- Added GFM table, ordered-list and horizontal-rule rendering to the safe
  Markdown output.
- Added a two-click chat delete control to the chat-history sidebar; it
  removes the chat from the per-browser index only (DSH has no
  session-deletion seam).
- Added attestation diagnostics: the Host folds a coarse reason code into the
  refusal and the browser console prints one operator hint instead of a
  duplicate stack trace.
- Fixed repeated policy attestation for tools contributed by an agent preset:
  the applied restriction now retains the exact scoped allow-list instead of
  accidentally reducing it to global-only tools. Removed the redundant native
  presentation override so reloads cannot collide with the preset's mode.
- The browser re-reads the Host configuration when the connection is restored,
  so an open page survives a Host restart with a changed deployment config.
- Added LAN serving support: a shipped `deploy/qa-lan.patch.yml` webserver
  overlay, and a `qaSurface/describe` Host Remote the browser falls back to
  when the loopback-pinned settings namespace is unavailable, so branding,
  session pinning and lockdown UI switches keep working over the network.
- Localized the end-user chat interface into Russian, added rotating playful
  thinking phrases, and moved the default quick-question chips next to the
  composer on an empty chat.
