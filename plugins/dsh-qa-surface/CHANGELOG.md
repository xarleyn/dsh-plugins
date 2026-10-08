## 0.15.5 (2026-10-08)

### 🩹 Fixes

- The version history stops drawing a heading for a section that has no entries. ([#770](https://github.com/xarleyn/dsh-plugins/issues/770))

  A published entry can carry an empty section — `0.8.0` lists "Новое" with
  nothing under it — and that text is frozen by the release that published it, so
  the heading is the half that can yield. The dialog now renders only the sections
  that have at least one entry, which leaves every published sentence exactly as it
  shipped while removing the titled box that read like a changelog that lost its
  content.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.15.4 (2026-10-08)

### 🩹 Fixes

- The source list explains an empty result instead of hiding the control that ([#720](https://github.com/xarleyn/dsh-plugins/issues/720))
  would show it.

  A turn that answers from recalled memory, or from what this chat already said,
  adds nothing to the source list. No extractor in the provenance registry
  recognises a memory read, and the deployment notes name recalled memory as the
  background an answer is written against rather than as one of its origins, so an
  empty list after such a turn is the design working, not a collection that broke.
  The interface said nothing either way: no chip appeared under the answer, and the
  header's "Sources" control stayed disabled — no counter, no reason — which also
  sealed the one surface that could have explained the emptiness.

  The control is no longer gated on a non-zero count, so a deployment that shows it
  keeps it clickable, and the panel answers an empty settled list by naming the kind
  of material the list holds and saying that an empty list is not a failed
  collection. That sentence is drawn only once the collection has settled: a turn
  still running and a delegated run that still owes its origins already say so on
  the line above, and two contradictory texts on one screen read worse than none.

  `README.md` §Sources, `SPEC.md` §46.2 and
  `docs/specs/sources-provenance.md` §20.1 now carry the definition itself: both
  channels that write the list — matched tool results and the report the answering
  agent files through `qa_report_sources` — and why a bridged memory read reaches
  neither.

  Covered by `tests/provenance/provenance.test.ts` (a memory read yields no
  source), `tests/client/components/qa-sources-panel.test.tsx` (an empty settled
  list explains itself, an unsettled one stays silent) and
  `tests/client/components/qa-header-layout.test.tsx` (the control is clickable on
  a completed chat that has no sources).

- The first question into a new draft stops failing with «Не удалось начать чат.» ([#719](https://github.com/xarleyn/dsh-plugins/issues/719))
  over a session the stand had in fact created.

  The browser holds its own catalog of sessions, and `sessions.retain` answers from
  that catalog: an identity it has not listed yet is refused with `sessions.retain:
  unknown session`. A QA session is born on the server, through this plugin's own
  Remote, so the create can answer before the row that lists it reaches the browser —
  and the surface asked for the reference in exactly that window. The refusal was
  reported as a chat that could not start, while the conversation the stand had
  created was already there — one the visitor had no row of and could not open.

  The adoption now waits for the catalog to name the id before it retains it, and asks
  for a fresh baseline rather than only for whichever of the push or the pull happens
  to come first. The patience is one round-trip, not a second adoption timeout: the row
  is a push or a pull away, and a full window of waiting would stack onto the waits
  that follow it and hold a chat that never opens on screen for two. When the row
  really never arrives the operator reads the Host's own refusal, not a timeout nobody
  asked for, and a refusal of a session the catalog already names stays the refusal it
  is — no re-read asked for, no race printed beside an answer that was never a race. A
  baseline the Host refuses is said out loud too, because a chat lost in that shape
  reads as a slow catalog and is really an unreadable one. Because the failure is
  intermittent, the two moments of the race are logged when it happens — the refused
  retain with its timestamp, and the row that came for it with the time spent waiting —
  so a round that loses the chat can tell which side of the create it lost it on. The
  chat a page restores when it opens rides the same repaired path.

- A turn a person stopped is reported as stopped, not as ready. ([#723](https://github.com/xarleyn/dsh-plugins/issues/723))

  The work group closed a stopped turn with «Готово за 2 с» over an empty answer:
  no notice over the fragment, and — because a turn stopped before its first
  sentence commits no text row at all — no actions either. «Готово» claims a
  complete answer, so the surface contradicted the click the reader had just made.
  The surface already separates a provider failure, which has both a status of its
  own and a row naming the code, so a human-stopped turn was the one turn outcome
  left unreported.

  The Host marks the difference. `AssistantMessageNode.interrupted` is set on the
  message committed after a cancel, and on the prefix the Host assembles from the
  streaming chunks when nothing was committed — that fallback is built at the
  closed step boundary and is allowed without any prose as soon as reasoning or a
  tool call counts as evidence (`dsh-client-ui-chat` `finalNode`). The projection
  read `blocks`, `seq` and `timing` only, so a stopped turn carried no failure code
  and settled into `complete`.

  `QaTranscriptAdapter` now seats the flag on its turn and gives the turn a third
  terminal status, `stopped`, which the work group prints as «Остановлено на N с»
  and collapses the way it collapses a finished or failed turn, beside a notice row
  that says the answer is incomplete and how to get the whole of it. A provider
  failure still wins: a turn that stopped into a recorded `turn-error` keeps the
  failure's own row rather than gaining a second banner. The text that did arrive
  stays a committed answer row, so copy and rating stay reachable over a fragment —
  stopping a turn to reword the question no longer eats what was written. A prefix
  with no prose in it still gets the notice, which is the case that used to close
  silently.

  Covered by `tests/transcript/transcript-projection-stopped.test.ts` (both the
  durable prefix and the chunk-only fallback read as stopped; the prefix keeps its
  committed text row and the notice follows it; an unsettled variant of the same
  fixture still reads `complete`; a failure suppresses the notice) and
  `tests/client/components/qa-work-group.test.tsx` (the stopped label and the
  automatic collapse off a running turn).

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

- The QA surface's small controls say what they are, and its body text reads at 16px. ([#727](https://github.com/xarleyn/dsh-plugins/issues/727), [#764](https://github.com/xarleyn/dsh-plugins/issues/764))

  A browser round over the surface (1440/1280/390) collected eleven defects of one class —
  a control that looks alive but is not, a hit target below the surface's own 44px minimum,
  and body text at 11-15px. Each is fixed on its own:

  - The `Агенты`, `Источники` and `Файлы` chips in the header were `disabled` at a zero
    counter: dimmed, outside the Tab order, and silent about what had run out. They now stay
    reachable as `aria-disabled` and name the empty state in their label and tooltip.
  - `Чат` in the header carried the selected-tab treatment (`aria-current="page"`, accent
    color, a 2px underline) while being an unclickable `<span>`. With a rail or drawer open it
    is a real button that closes the panel and returns to the chat; with none open it stays a
    caption, which is the only state where it is not a control.
  - At 390px the panel covers the screen and its only exit was the 26x26 close button, while
    the same stylesheet demands 44x44 for sidebar controls at that width. The close target,
    the panel tabs and the per-message actions now meet 44px, Escape closes the rail from
    anywhere, and the close control names the tab it dismisses.
  - Assistant answers ran 15px (14px at 390px) against the user's 16px, and the settings and
    sign-in cards sat at 11-13px. Body text moves to 16px in both stylesheets; the deliberate
    exceptions (tooltips, counters, footer notes) are listed at the rule.
  - A truncated conversation title in the history was cut at 20 characters with no ellipsis
    and no tooltip, so two chats beginning `Напиши двадцать корот…` were indistinguishable.
    The row now ellipsizes, carries the full name in its tooltip, and searches the full name.
  - The third quick question was clipped at the right edge on a narrow screen and Tab did not
    scroll it into view; the chips now wrap.
  - A refused attachment (an 11MB drop) left its red line above an empty composer after a
    successful send, and the Files panel printed `Рабочий каталог` twice — as the section
    heading and again as the root crumb.
  - The approval card for a workspace delete showed an English reason inside a Russian
    interface, and the `/` palette mixed Russian badges with English command descriptions.

### ❤️ Thank You

- qoder-bot

## 0.15.3 (2026-10-08)

### 🩹 Fixes

- The slash palette names the same skills in a chat that has not been woken as in ([#760](https://github.com/xarleyn/dsh-plugins/issues/760))
  a chat that is running.

  A chat this Host holds no live agent for — one reopened from disk, one its
  visitor has not sent anything into yet — answered the palette read with "the
  role system has no opinion", because the capability snapshot the role is read
  from rides on the agent. Its catalog was therefore narrowed by the deployment's
  allow-list alone, while the very same chat, once woken, was narrowed by that
  allow-list *and* by the role. A visitor could read a skill name in the list,
  type it, and be refused — or watch the list hide a skill the chat would have
  accepted.

  Both reads now resolve one grant. `policyForColdSession` walks the same session
  record, the same role of the same account and the same model as the read of a
  woken chat, and differs only in what it reads the role against: the catalog the
  deployment mounts for every chat, since this chat contributes no agent of its
  own. That is why nothing is written onto the session record — a palette read
  must not freeze the capability snapshot a later turn runs under — and why what
  only this chat's workspace contributes, its project layer and the account's own
  skills the provider discovers under that workspace, stays out of the list until
  the chat is woken: the palette's own read of a chat with no agent does not see
  them either, so neither side of the comparison is left behind. A chat whose role
  no longer exists refuses the read instead of showing everything, exactly as a
  woken chat does.

  The list itself is now derived in one place. `userInvocableSkillNames` is what
  the palette is narrowed by and what `/name` is admitted or refused by, so the
  two cannot drift into reading one rule two ways; an empty `userSkills` still
  means the role keeps no separate user list, not that it grants nothing.

  Covered by `tests/access/access-service-cold-session.test.ts` (a cold read
  excludes a name no role grants, answers the same list as a woken read, refuses
  a foreign browser, pins no snapshot) and by two cases in
  `tests/slash/slash-remotes.test.ts` (a skill outside the grant stays out of a
  read that has no agent, and the cold and woken reads agree).

### ❤️ Thank You

- qoder-bot

## 0.15.2 (2026-10-08)

### 🩹 Fixes

- A chat the stand refuses now says why, and a delegated run stops looking like an outage. ([#718](https://github.com/xarleyn/dsh-plugins/issues/718))

  One day of a stand's journal carried twelve ERROR lines of one shape —
  `session.agent-resolve-rejected` followed by `lockdown.rejected reason="agent-unavailable"` —
  over five sessions, some of them two or three times in a row within minutes. The Host had
  answered `session/agent-busy` (`session "<id>" is owned by subagent routing`), which is the
  Session domain saying the identity belongs to a delegated run rather than to a chat.
  `liveAgent` folded that answer — a correct statement about another conversation's child — into
  the same coarse `agent-unavailable` it uses when a restored chat's recorded preset no longer
  mounts, so the operator read an outage where nothing needed repairing, and the visitor's console
  hint blamed a preset nobody had changed.

  The two classes are named apart now. A `session/agent-busy` answer is refused as
  `subagent-session` with the one sentence the live-child header check already used, so a delegated
  child is refused the same way whether or not its agent happens to be live; the Host answered
  correctly, so the journal takes a warning, and `lockdown.rejected` follows it at that level for
  the refusals that describe the browser's chat (`composition-mismatch`, `adoption-refused`,
  `subagent-session`) while a chat with no agent behind it keeps its ERROR pair — that one is the
  deployment's problem. Its message points at the line holding the composition detail, and both
  console hints name the cause and the move that follows: re-mount the recorded preset and re-open,
  against read the run from its parent chat and start a new one.

  The repeat, not the refusal, made the noise. Admission is what lets the Host answer about a chat
  at all, so the sources, approvals, questions and workspace Remotes each admit the session before
  reading it and one refused chat met the gate once per panel refresh. It was no cycle — every line
  belonged to a distinct browser call, and the bridge coalesces while one is in flight — but the
  subagent view was asking for the bundles of a session the Host refuses to attest by design, so it
  asks for none: a delegated run's sources reach the chat through the inheritance flow, and its
  transcript reads them off the projection alone.

  The harness stays out of this. `packages/api/session-controller` refuses to resume an identity its
  subagent routing owns, reading the durable `origin` mark off the session record — the correct
  answer about a child — and what needed repair was the caller flattening it.

- A refusal block reads as a refusal again, and a token the Host never declares ([#717](https://github.com/xarleyn/dsh-plugins/issues/717))
  cannot be written down unnoticed.

  Unknown `var(--dsw-…)` is not a missing colour: the substitution yields the
  guaranteed-invalid value, so the browser drops the whole declaration at
  computed-value time and says nothing. `--dsw-alias-bg-error` and
  `--dsw-alias-label-error` are named by no theme sheet — the error ramp is
  `--dsw-alias-state-error-primary` — so every block of refusal text written with
  them lost its fill and its ink together and rendered as ordinary small text,
  which is how issue #717 looked on the Memory tab of a stand with no access to
  the service. The same mechanic had already cost `dsh-sleev` its focus and
  invalid borders (`--dsw-alias-border-brand`, `--dsw-alias-border-error`) and
  `dsh-session-scope` its chip fill (`--dsw-alias-fill-tsp-secondary`).

  Text and borders now take `--dsw-alias-state-error-primary` with a `#b3261e`
  fallback. The theme declares no error *surface* alias — `state-success` and
  `state-warn` have a tint, `state-error` does not — so a block mixes the state
  token the way the Host's own danger control does,
  `color-mix(in srgb, … 8%, transparent)`, and keeps its soft red in both themes.
  Three names that only ever survived behind a fallback are retired where a live
  token exists (`--dsw-alias-bg-elevated` → `--dsw-alias-button-elevated-fill`,
  `--dsw-alias-label-inverse` → `--dsw-alias-label-primary-foreground`), and
  `--dsw-font-family-mono`, for which the theme offers no alias at all, becomes
  the `ui-monospace` stack the other bundles already write. No computed value
  changes except where a dead name had been silently winning.

  `pnpm verify:tokens` (`scripts/verify-design-tokens.mjs`) is the class turned
  into a gate: it collects every `--dsw-*` name substituted under any package's
  `src/` and refuses one the installed `@deepseek-ai/dsh-client-ui-theme` does not
  declare — a dead name behind a fallback included, because the fallback paints a
  colour the Host never chose. The vocabulary comes from the pinned package rather
  than a hand-kept list, so the check needs no harness checkout and reads the same
  version the plugins build against; where the theme cannot be found the gate
  reports that instead of passing. `dsh-plugin-log-ui`'s own bundle pin flips from
  requiring `--dsw-alias-bg-error` to forbidding the dead error names.

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

- A document the chat made arrives as a file, not as a path. ([#739](https://github.com/xarleyn/dsh-plugins/issues/739))

  A stand that was asked to build a Word document built it and then said nothing
  about it: the answer was a paragraph, the files tab said the chat had no
  attachments, and the only trace of the artifact was a line of text the model had
  copied out of a tool result — `/workspace/work/.qa-users/<account>/.qa/artifacts/…`,
  which is the container's own layout and the account directory inside it. A chat
  whose dialogs are readable by other accounts of the same server has no business
  printing that.

  The producing tools now report each file by its path inside the session
  workspace — the same spelling their own input parameters accept, so a document
  reported by one call is read back by the next — and the pipeline's absolute
  paths stay where containment is checked, inside the runtime. The chat reads
  those names out of the turn's tool results and cards the file under the answer
  that made it: badge, name, size, `Открыть` into the workspace viewer with its
  Word preview, `Скачать` for the bytes. The card is on the roster of the files tab
  too, so the answer's document is listed with what the chat sent. It appears
  whatever the tool-activity switch hides, because a file the reader asked for is
  not tool noise, and where the Host refuses workspace reads the card still names
  the file without offering a control that would be refused. An answer that quotes
  an absolute path anyway — one written before this change, replayed from durable
  history, or rebuilt by a model from the working directory it was given — is
  projected with the workspace directory and the account partition masked out.

- Opening the QA surface no longer writes an empty chat into the history. ([#721](https://github.com/xarleyn/dsh-plugins/issues/721))

  The page used to ask the Host for a session the moment it opened, so every visit
  that sent nothing left a blank «Новый чат» line behind — six rounds on one
  account were six empty rows, and the search over the history returned them. The
  session was real too: the browser retained a reference to it and the account
  claimed ownership of it, so the stand kept sessions nobody talked in.

  A load now opens a draft, which is what the «Новый чат» button had already been
  doing: nothing is created until the first prompt is sent into it
  (`materializeDraft`). `ensureSessionNow` asks the browser whether it has a chat to
  resume — only `browser-persistent` with a persisted id does — and takes the draft
  path instead of `createQaSession` otherwise, including the case where the
  persisted id names a session the Host no longer lists or a delegated child. A
  fixed-policy deployment keeps its one session and cannot draft, so its bootstrap
  is untouched, and so is the ladder that replaces a restored chat the current
  policy refuses to attest.

  Two supporting changes make the draft the same surface it was behind the button.
  `enterDraft` is the tail of `startDraft` factored out, and it keeps the chat
  identity when the draft on screen already names no session — taking another would
  rebuild the composer over the question still sitting in it — while retiring the
  send the abandoned attempt had in flight. `publish` treats a draft whose first
  send created a session the stand then refused to attest as a draft rather than a
  chat, because projecting that never-claimed binding leaves the composer disabled
  with no retry over it; a proof still in flight keeps projecting the session its
  question is waiting for.

  Covered by `tests/session/session-controller-lazy-chat.test.ts` (a load spends
  nothing under either policy; three visits leave no row and the first prompt leaves
  one) and `tests/client/surface/qa-visit-leaves-no-chat.test.tsx` (the same over the
  mounted page). The empty chats an account already has are user data and are not
  touched by this change.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.6.2

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.15.1 (2026-10-05)

### 🩹 Fixes

- A question nobody is waiting for any more stops being answered. ([b9dea68f](https://github.com/xarleyn/dsh-plugins/commit/b9dea68f))

  The integration API released its concurrency slot correctly, but the turn outlived
  the caller: `prompt` carries the caller's signal only up to admission, and the
  wait ending is not the work ending. So a bridge that gave up left the agent
  running — model still generating, tools still firing, the chat's agent still
  busy — and the next question continued into that chat queued behind work nobody
  had asked for, which is how a stand ends up with several asks hitting its full
  answer budget in a row.

  An abandoned ask now stops the turn it started, and only that turn: the stop
  fires on the caller's own disconnect, and only when the session's durable log
  says this request's turn is still running. Other callers' queued prompts survive
  it. An expired budget is unchanged — that is the escalation the bridge polls
  with the `chat_id` it was handed — and both outcomes now leave a line in the log
  (`integration.dropped`, `integration.turn-abandoned`), where before a dropped
  caller left no trace at all.

- The integration API now documents its answer budget as a deployment setting. ([d5a46e99](https://github.com/xarleyn/dsh-plugins/commit/d5a46e99))

  `README.md` ships inside the package, and it showed `requestTimeoutMs: 90000`
  without saying what the number decides. It is not a client's patience: past the
  budget the endpoint answers `200` with `escalate: true` and the `chat_id`, which
  is how a ticket bridge hands a question to a human instead of retrying a turn
  that is still running. A deployment that raises the budget changes when that
  hand-off happens, and a bridge reading the example as a contract would wait the
  wrong amount of time.

  The reference now names the value as the deployment's budget, points at the
  section that explains the escalation, and states the polling path
  (`GET {basePath}/session` with the returned `chat_id`) for a bridge that cannot
  hold one request open for the whole budget.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.15.0 (2026-10-04)

### 🚀 Features

- An answer now says where its facts came from, and the chat history is reachable ([86a58b68](https://github.com/xarleyn/dsh-plugins/commit/86a58b68))
  on a phone again.

  The sources a reader can click are the difference between a claim and a check.
  A report filed by the agent that answered — as opposed to one delegated to a
  subagent — was being turned away silently: the channel asked who was reporting
  instead of whether the entry carried an address, so every such report recorded
  nothing and the Sources tab stayed empty on a stand where the conversation's own
  agent does the reading. Reports from the answering agent now land in the turn
  that made them, and the per-entry rule that a source must name a file or a URL
  still applies to each entry.

  On a phone the surface hid its sidebar and, with it, the only controls that
  could show it again: the history, the search field and «Новый чат» were
  unreachable, and the header offered nothing in their place. There is now an
  opener in the header, sized for a thumb, and the history slides in as a drawer
  over a dimming layer — closed by Escape, by a tap outside, or by choosing a
  chat. The drawer leaves the desktop layout's collapsed state alone, so going
  back to a wide screen restores what the reader left there.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.6.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.14.0 (2026-10-04)

### 🚀 Features

- A finished turn says so — to the person waiting for it, and to nobody else. ([#306](https://github.com/xarleyn/dsh-plugins/issues/306))

  The chat list carries the completion into the page: a line naming the chat whose
  turn has just ended, opened by clicking it. Only the chats this browser keeps in
  its own history can raise one, so another account's activity stays another
  account's business. Waiting means having seen the whole of a turn: a page that
  opened on a run already under way stays silent about that run, and so does every
  turn a dropped link interrupts in a gap the screen reflected — even one it had
  watched begin, because while the link was down the chat may have run a different
  turn and the rows that come back do not say which one this is. An idle row that
  has not moved since the gap arms nothing either, and what arms it is a turn of
  that chat ending — so the first turn to finish after the link returns is silent
  whichever turn it was, even one begun and finished on the recovered link, and a
  turn that finished while the link was down is lost on top of it. Notices come
  back with the turn after that. On a stand whose link drops inside every long
  turn, and whose screen reflects each of those drops, every turn pays for its own
  drop and none is announced. A link lost and recovered between two screen updates
  is the one gap the page is never shown: it hands the page nothing to go silent
  about, so a turn that began inside it is credited to the reader as though its
  start had been seen. A tab that is hidden or behind another
  window can hand the same line to the operating system; the page asks for that
  once, remembers the answer, and keeps the in-page line whenever the answer is no.
  A stand can close the channels from its configuration:
  `notifications.enabled` stops both, `notifications.allowOs` leaves the one
  inside the page.

- Сообщение, заданное во время ответа, теперь ждёт своей очереди, а не теряется. ([#367](https://github.com/xarleyn/dsh-plugins/issues/367))

  Пока агент отвечал, стенд не давал отправить вопрос: поле ввода оставалось
  редактируемым, Enter и кнопка ничего не делали. На самом деле Host умеет
  принимать вопрос следующим ходом — именно в этом смысле он и отправляется в
  `queue`, — но собственный композитор стенда этим режимом не пользовался, а
  затем и не показывал то, что там уже лежит. Теперь во время ответа можно
  написать следующий вопрос: он встаёт в очередь над полем ввода, и строку этой
  очереди можно отредактировать, отправить сразу (вставив в текущий ответ) или
  убрать.

  Очередь принадлежит Host, поэтому стенд ничего не хранит сам: строки читаются
  из очереди сессии, а три операции — `edit`, `steer`, `remove` — идут в
  `session/updateQueue`. Сообщение, которое ещё летит через транспорт, показывает
  эхо, которое mintит сам Host, и гаснет в тот момент, когда его очередь-occurrence
  приходит; из-за этого один и тот же вопрос не может одновременно читаться как
  «летит» и как готовая строка очереди. В переписке его тоже не видно: в
  транскрипте он появится, только когда агент его возьмёт.

  Строка без правки не остаётся: сообщение с вложениями Host не отдаёт как чистый
  текст, поэтому его можно убрать или отправить сразу, но нельзя переписать —
  кнопка правки говорит об этом прямо. Отклонённую операции Host'ом очередь не
  молча не перерисовывает: стенд пишет, что сообщение, возможно, уже отправлено,
  потому что ровно это и происходит, когда очередь забирает ход, закончившийся
  между кадрами.

- Where a finished turn is allowed to reach a reader is now the reader's own ([#322](https://github.com/xarleyn/dsh-plugins/issues/322), [#306](https://github.com/xarleyn/dsh-plugins/issues/306))
  choice, and it travels with their account. The `Настройки` dialog gained an
  «Уведомления» section with the two channels the stand has: the line inside the
  page, and the notice a hidden or backgrounded tab can hand to the operating
  system. The choice is stored on the account next to the profile and the starter
  buttons, so signing in on another laptop brings it along; on a stand without
  accounts the desktop answer stays in the browser that gave it, which is the only
  record there. What the deployment closed with `notifications.enabled` or
  `notifications.allowOs` stays closed, and the section names which of the two
  shut a channel instead of offering a switch that cannot take effect. The browser
  is asked for its permission from a click — the notice's button or the new
  section's — never on load and never once per turn.

- A stand can now be told how many questions it is allowed to answer at the same ([#324](https://github.com/xarleyn/dsh-plugins/issues/324))
  time, and a visitor whose question does not fit is told so instead of being
  answered slowly — or, on a single graphics card, three at once, not at all.

  `session.maxActiveRequests` (0 through 50, default 0 = no ceiling) is the
  setting; the card shows it in «Сессия». The count it bounds is read on the Host
  from the harness's own `running` state of the top-level agents, because that is
  the only place the whole load is visible: a browser sees its own chats, never
  another account's, and a question that arrived through the HTTP integration API
  is invisible to every chat view. Delegated experts ride the turn that delegated
  them, so they do not cost a second place.

  Before a send the browser asks `qaSurface/queueStatus`, and a full stand holds
  the question back where nothing has been spent yet: the draft chat is never
  materialized, nothing enters the transcript, and the composer keeps its text —
  the visitor reads «Подождите в очереди» with the number of requests the stand
  already has in work, closes it, and asks again on the same draft. Refusing after
  `prompt` would have been the other option, and it is worse on every axis that
  matters here: it creates the chat the issue says must not exist and leaves an
  unanswered question in the durable log.

  What the ceiling bounds is a question that would wake a second driver. A message
  typed while its own chat is answering joins that chat's queue and is admitted
  without the read — the driver is busy either way, and a stand capped at one would
  otherwise stop a visitor from continuing the conversation it is holding. A human
  command rides the Host's command runtime and is never held back: the palette is
  how one inspects a saturated stand, and this plugin cannot tell which commands
  wake the model. Both enter the same Host count once they do, so the next question
  waits behind them as behind any other turn. That count is of the model's load
  rather than of this plugin's traffic: any top-level turn the harness is answering
  occupies a place, a native assistant's as much as a QA question's, which is the
  point of a ceiling set for one weak card.

  Two properties are stated rather than fixed, and both come from one fact — the
  prompt rides the native session RPC, which this plugin does not own. The ceiling
  is a ceiling, not a lock: two questions pressed in the same instant can overshoot
  by one, and the next read sees both. And a load the Host cannot report sends the
  question anyway, because a deployment that does not know how busy it is has not
  earned the right to refuse a visitor.

  No behavior changes where the setting stays at its default: with no ceiling
  configured the browser asks nothing, so an ordinary deployment keeps both its
  send path and its wire traffic exactly as they were.

- Expert memory can be maintained, and junk stops being recorded. ([1c783708](https://github.com/xarleyn/dsh-plugins/commit/1c783708))

  The QA admin console gained a "Expert memory" section: the records an expert
  wrote to itself, listed per domain, searchable, correctable and deletable one at
  a time or as a selection. A reviewer reads it; only an administrator writes it,
  and every write is audited with the line as it was before.

  On the write path, the `domain_memory` tool now refuses a note that records
  nothing — an acknowledgement, a placeholder, an echoed command, or "nothing was
  found" — and answers with the reason, so a wrong line stops being injected into
  every later answer of that domain by the same expert that wrote it. Operators
  are not gated: correcting or emptying a record from the console stays allowed.

- The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section, and it paints only its body there. ([#659](https://github.com/xarleyn/dsh-plugins/issues/659))

  The Plugins page draws the heading of a row's page itself — the crumb, the artwork and the title — and seats the bundle's configuration under it, so the card no longer competes for a place in the Settings dialog's tab strip. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-qa-surface#dsh-qa-surface`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page.

  The page seats one entry in two views, and this entry answers them differently. As the page it renders the card; where the page wants the row's one-liner — the seat it falls back to for a row carrying no description — it returns a sentence, because a card mounted inside a line of text draws a page within a line and starts a second poll of the Remote. That sentence is the manifest's own `description`, which is where the page reads the row's paragraph from: one row that reads two ways is a defect, so the two are kept equal and a test and the package gate read the manifest rather than repeating the words. An entry the page renders without naming a view is that page rather than an empty column. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it.

  The row's page draws the card surface, the heading and the expand control, so the bundle stopped drawing them: the plugin's own shell — the 12 px frame, the header with the badge, and the chevron of the card contract — is gone rather than nested inside the Host's 20 px one, and the configuration sections mount directly; the 16 px the body used to keep under its own header went with that header, because the page's own configuration column already spaces what it holds (`detailSections` carries a 32 px margin and gap in the installed build, and the Host's own section beside ours sits on that rhythm alone). The route and the on/off state the header badge repeated are already in the status section, so nothing is lost with it. Focus rings now come from the Host's `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, with each rule's own colour as the fallback, instead of a hard-coded outline the Host's `focus.css` outranks: this reaches every control the bundle paints, the row's body and the assistant's own pages alike. The disclosure arrows of the message queue, the administrator's tool list and the audit JSON tree left the card shell's chevron for one arrow drawn on the 16 by 16 grid, each inside the box its own stylesheet already gave it; the audit tree's `viewBox` moved together with its path, since a 16-grid path inside a 14 box renders larger than the arrows beside it. A namespace the Host does not serve answers with the reason in one sentence rather than with an empty column — the row's heading and its configure control are already drawn, so silence would carry no explanation — and the poll that would feed a status section nobody mounts stays off while the namespace is unreachable.

  Nothing about the stored settings moves: the configuration namespace stays `dsh-qa-surface`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it.

  `@yadsh/dsh-audit-ui` changes for one rule of its own — the tree disclosure arrow and the focus ring of its tab strip, both of which travel inside the `@yadsh/dsh-qa-surface` bundle and are held to the row card's contract there.

- The `/qa` surface can change its own theme. ([#303](https://github.com/xarleyn/dsh-plugins/issues/303))

  Light, dark and follow-the-system were the application's choice only: the Host
  publishes its Appearance row inside the settings, and the QA overlay is exactly
  the thing that suppresses the host shell — so on `/qa` there was nothing to
  click, and a stand opened in a palette nobody had picked. The surface now
  carries the three preferences itself, as an icon control in the header next to
  the role it belongs to.

  The choice is the browser's, not the deployment's. It is written to this
  stand's own localStorage namespace and never to the Host user-settings document,
  because a stand is shared by everyone who opens it and one visitor's eyes are
  not a configuration. A browser that never touched the control stores nothing and
  writes nothing at all — the stand keeps the palette the application booted it
  in, and the control reports the palette on screen instead of claiming a
  preference nobody picked — so the default deployment looks exactly as it did.

  What the control writes is the Host's own palette contract: `color-scheme` on
  the root and the dark-palette attribute on the body, the two fields the Host
  theme presenter owns. That is why the whole surface follows — the plugin cards,
  the transcript and the dialogs are built from `--dsw-alias-*` tokens, and those
  tokens are declared under precisely those two selectors. The Host publishes its
  preference nowhere in the DOM, only the resolved palette, so the surface keeps
  the font-size axis and a theme's own token overrides to the Host. `system`
  resolves through the OS and keeps listening, so a laptop that goes dark at dusk
  takes the chat with it.

  While the surface is on screen the choice owns the document; when it stops being
  what the visitor sees — the route changing inside the application, or the
  overlay unmounting — the palette the document wore is put back. That is the
  point of handing it over: off its own route the control is not on screen to
  undo itself, and a harness left in a QA stand's palette would stay in it for the
  rest of the visit.

  While the surface owns the row, the header no longer overflows on a phone: the
  title, the role, the palette and the action cluster now wrap instead of pushing
  «Настройки» past the clipped edge.


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

- A revoked account token stops working on the call that presents it. ([#336](https://github.com/xarleyn/dsh-plugins/issues/336))

  The Host keeps the accounts in memory and re-reads them when another process
  wrote the database — the `qa-accounts` CLI, or a second Host process, since a
  password change, a disable or a revocation is an operator act and usually comes
  from there. Which call actually re-read was a property of the *caller*:
  `whoami`, `currentUser` and the session-ownership checks re-read, while
  `requireUser` did not. The personal-skill remotes gate on `requireUser` alone, so
  a token revoked a moment ago kept authorizing those calls until some other method
  happened to refresh the model — and a browser that only ever opens its own skills
  never triggers one.

  The refresh itself was also not atomic. `loadAll` took its `PRAGMA data_version`
  baseline *after* the SELECTs, so a commit landing mid-read was invisible to it:
  the account rows came from before the commit and the baseline from after, which
  labeled a model of two database states as current. A revocation that arrived in
  that window survived not just the next call but until some later write moved the
  version again.

  Every credential check now reads the authorization state through one entry point
  that refreshes first, so the refusal lands on the call carrying the dead token.
  `loadAll` takes the version around its reads and repeats them when the version
  moved, which makes the returned model and the baseline describing it one instant;
  a database committed into faster than this store can read hands back a model whose
  baseline deliberately does not match, so the next access reloads instead of
  trusting it.

- An answer that carries LaTeX or a table no longer shows its markup while it is ([#323](https://github.com/xarleyn/dsh-plugins/issues/323), [#302](https://github.com/xarleyn/dsh-plugins/issues/302))
  being written.

  A research question costs minutes on this stand, and the answer arrives as a
  stream: the browser renders every frame of the text grown so far. The block
  parser read those frames the way it reads a finished answer, where a `$$` fence
  with no closer is a paragraph — so while the model was still inside a formula
  the reader saw its dollars and a half-typed `\frac{`, a table showed its own
  pipes until the delimiter row was typed whole, and the row being typed rendered
  as a truncated one. A Mermaid diagram made it worse: an open fence was handed to
  `mermaid.render` on every frame, which answered with a syntax error and then
  with the error panel next to the code.

  The parser stays the single authority on where a block ends. It learns exactly
  one fact from the caller — the text is a live frame — and reports the block the
  stream stopped inside as `pending`, so no component re-detects an unfinished
  tail. An open block is then held rather than guessed at: the TeX shows as a
  monospace frame carrying what has been written, without its delimiters, a
  half-written delimiter row opens the table header, a row still being typed stays
  out of the cells, and an open Mermaid fence stays source.

  A settled answer is untouched, which is the invariant the tests hold: every
  block the stream leaves open reads exactly as it did before once the text has
  settled, because without the flag nothing about the grammar changes.

- A signed-in chat stops falling back to the sign-in card on its own. ([#308](https://github.com/xarleyn/dsh-plugins/issues/308))

  The browser half of the surface rebuilds its account controller whenever the
  remote wiring re-injects, and the boot `whoami` of the instance being replaced is
  still in flight at that moment. Its answer used to arrive in a controller that
  nothing had ever unloaded: a definite "not authenticated" cleared the stored
  token under the shared `<storageKey>:v1:<route>:account-token` key — the very key
  the fresh instance had just written its login to. The browser then showed the
  sign-in card over a session it had actually kept, and asked for the password
  again. No account data was lost.

  The controllers teardown effect now unloads the account controller alongside the
  config and route controllers, as every other controller of the module already
  was, so the late answer stops at the `disposed` guard instead of reaching
  storage. The race is pinned at the level it lives on: the client module is
  loaded, unloaded and loaded again under a Cordis context, and the assertion is
  about what the second instance stored. That test fails on the previous sources,
  where the token comes back erased.

- An answer belongs to the question that asked it — in the API and in the composer. ([#339](https://github.com/xarleyn/dsh-plugins/issues/339))

  Two races, one on each side of a conversation.

  `/qa/api/ask` admits a question and then reads the reply back out of the durable
  log, and the read chose its turn by "the newest human prompt in this chat". That
  is a global counter, not an identity: while two callers hold the same chat, the
  second question's row is the newest row there is, so the first caller's read was
  cut at the second one's question and published its answer — the bridge posted one
  customer's answer under another customer's request, with that turn's citations
  attached. Selecting by "latest" also hid the opposite case: a question whose own
  turn was cut off before it wrote any text used to be answered with whatever a
  later turn had said. The harness already brands each durable prompt row with the
  rpc id of the call that wrote it, and the runner now looks for its own row and
  reads the turn that row was claimed into — so a question is answered by its own
  turn, or, when that turn committed no prose, by nothing at all. The provenance
  citation follows the same number instead of the chat's newest bundle, and the
  cursor rule is left as the fallback it was written for: a prompt whose row the
  read has not reached yet.

  The composer staged an attachment after it had chosen the chat to send into. An
  upload is a round-trip, and the binding was only tested once the answer came
  back — after the state had been written and the prompt dispatched. Leaving for
  another chat, or closing the surface, while a file was still going therefore sent
  the draft into the chat that had been left, and the chat now on screen inherited
  a send that was never its own: its composer stayed busy on a submission it had
  not made. The binding is re-checked between the upload and the send, on both
  routes that stage files — the model prompt and a human command — and a send whose
  chat is gone is dropped instead of landing somewhere else.

  The regressions: two concurrent questions in one chat, each with its own marker
  in the answer and its own evidence in the turn bundle, pinned to the answer and
  the citations its caller receives; a question whose own turn committed nothing
  pinned to an empty answer; six projector tests over the row lookup, a batched
  turn that answers two questions at once, injected context that must not end a
  turn, and a log that names no turn; and three composer tests that switch chats or
  dispose the surface in the middle of a stalled upload, pinning that neither chat
  received the draft and that the chat the operator moved to is not left reporting a
  running send.

- `qa-accounts` answered with nothing when a stand ran it through the installed ([#327](https://github.com/xarleyn/dsh-plugins/issues/327), [#284](https://github.com/xarleyn/dsh-plugins/issues/284))
  bin.

  A package manager installs a bin as a link, and Node resolves the entry point
  with `fs.realpath`: the process is handed the link path while the module knows
  the file it links. The launch guard compared those two paths as spelled, so the
  entry never matched, `main` was never called, and every command printed nothing
  and exited 0 — `list` on a database full of accounts read as "the stand has no
  accounts", and `add` reported success while writing nothing. The guard resolves
  both sides now, so a link behaves like the file it links; `qa-repair-sessions`
  and `qa-attach-sessions` compared the same way and are fixed the same way.

  The silence is bounded at pack time, where it cannot cost an operator an
  afternoon: package verification launches every bin through a
  `node_modules/.bin`-style link and requires a real answer — the usage text, and
  `list` against an empty database — and checks the node shebang that lets a bare
  `qa-accounts list` reach Node at all. A launch that goes quiet now fails the
  release instead of the deployment.

- The sidebar's chat-delete control becomes addressable, so a run of deletions ([#288](https://github.com/xarleyn/dsh-plugins/issues/288))
  removes the chats it points at.

  The confirmation dialog arrived in 0.12.0, and the browser round that asked for
  it named a second half of the same problem: after the first removal, the next
  click did not reliably reach the row it was aimed at. Two things made the row
  controls tell apart badly, and both are fixed here.

  Every row's control carried the same accessible name — "Удалить чат" — while the
  dialog carried that string as well, so neither a screen reader nor a test could
  say which chat a control belongs to or tell the dialog from the button behind
  it. The control now names its own chat ("Удалить чат «Как перевыставить счёт»"),
  and the dialog is named for what it asks ("Подтвердите удаление чата").

  A title is not an identity, though, and the stand shows it: every chat reads
  «Новый чат» until its first answer lands, so two of them standing side by side
  would share one name again. Where a title repeats, the control numbers the chats
  carrying it by their place in the list — «Удалить чат «Новый чат» (2 из 2)» —
  and the confirmation asks about that same numbered chat, so it stays the right
  chat while the rows move up under it. The numbering runs over every chat the
  browser lists rather than only the rows a search leaves visible: a chat's name
  does not change because another one is filtered out, and a lone match still says
  how many share its title. The limit is the number itself — it names a row by
  where it stands, so a reader who cannot see the order has the row's timestamp to
  go on, which is what the row shows them. The session id would be unique and is
  deliberately not used: it is noise in a name read aloud.

  The control is drawn only while its row is hovered, but transparency alone does
  not step out of the way: it kept the right edge of the row and answered a click
  that arrived without the row being hovered — measured in Chromium against the
  shipped sheet, a blind `locator.click()` pressed it, which is how an automated
  walk over the list removed rows nobody touched. (A pointer click cannot be
  caught that way, because moving onto the row reveals the control.) The rule now
  hands pointer input to the control exactly when it reveals it, so a click
  without hover falls through to the chat itself, and the keyboard path is
  unchanged, because focusing the control is itself a revealing condition.

  Closing the dialog hands the keyboard back where it came from: cancelling
  refocuses the row it was opened from, and a confirmed removal leaves focus in
  the chat list rather than on the document body, so the next Tab continues among
  the chats instead of restarting from the top of the page.

  Tests cover the history case (a chat with a real title is not removed before the
  dialog is answered), two chats sharing one title, a run of deletions across rows
  that move up, focus restoration on every way the dialog closes — the cancel
  button, Escape, its own close control, the backdrop — and on a confirmed
  removal, and the hit-testing rule in the sheet.

- The first message of a newly created chat no longer disappears without a trace. ([#287](https://github.com/xarleyn/dsh-plugins/issues/287))

  "New chat" spends no session: the chat is created by the first prompt, and that
  was the moment the message died. The composer kept its unsent text as component
  state keyed by the bound session, so binding the freshly created session
  rebuilt the field empty — the question vanished from the browser before the
  Host had accepted anything, and the chat came up empty with no error in the
  interface and nothing on the wire. The composer and the per-chat state beside
  it are keyed by the chat now, which a draft keeps through its own lazy session;
  the text and the attachments are handed back only when the session has taken
  the prompt.

  A submission that cannot be sent is said out loud instead of being dropped: a
  chat still being created and a chat that is no longer open both answer with the
  reason, and the draft stays in the field to be sent again.

  Chat identities are now drawn once for the whole page and handed to a session
  only where that session is actually adopted. The surface re-creates this
  controller whenever the account, the configuration or the route changes, and a
  rebuilt controller used to name its first chat exactly as its predecessor had
  named its last — so an unsent question, its attachments and the per-chat panels
  outlived the chat they belonged to and were shown by the next one. Adopting a
  session is the whole of it now: a first send whose session never reached a
  binding, never opened, or was refused by the policy check is retried in the same
  chat rather than read as another one, and an adoption that finishes after the
  visitor has moved to another chat — the Host listed or refused its session too
  late — belongs to nobody and takes nothing back: the chat on screen keeps its
  identity, its subscriptions and its own policy proof, and the next question
  rides it as usual. A chat that takes over the screen — because a persisted chat
  was refused, or because it simply vanished — starts empty and quiet, without the
  question and the "sending" state of the chat it replaced.

  An identity is never handed out twice, and that is the price: a rebuilt
  controller opens its first chat under a fresh identity too, so an unsent
  question, the files staged with it and the panels that were open are dropped
  even when the very same conversation comes back. Before this the rebuild reused
  its predecessor's identity and the draft did survive — by being shown to a chat
  that had never seen it.

  An adoption that steps back now says so. Leaving a chat for a fresh draft —
  choosing another role, or the way out of an administrator's preview — retired
  the binding a first send was waiting on without raising the generation that
  waiting adoption is measured against, and so the adoption resumed as the owner
  of a screen it no longer was. The send took that for a finished adoption and
  reported a draft that had never been adopted: the chat the visitor switched to
  answered every later question with «чат не открыт», and the way out was to press
  «Новый чат» again. Starting a draft raises the generation the way opening another
  chat does, retires the materialization the ending chat was still paying for, and
  `bind` answers whether it adopted, so no caller can read a step back as a
  success. The way out of a preview waits for the same «чат ещё создаётся» moment
  the header's «Новый чат» and the role selector already waited for.

  A step back now also takes itself back. Past the binding an adoption has already
  installed a chat of its own — the retained reference, the session, and the three
  subscriptions that answer every frame of it with a publish — and until now it
  undid none of that when it stepped back. That was safe whenever the screen moved
  to a chat that retires the binding itself, and it was not safe when the screen
  moved to the bootstrap, which raises the generation while deliberately keeping the
  transcript on screen until its own session exists: a bootstrap that then failed
  left the abandoned adoption holding a Host session nobody is in and republishing
  that chat's frames into the surface, and each frame cleared the «не удалось начать
  чат» the stand had just published — the silence this card is about, arriving a
  second time as a reason that vanishes. An adoption that steps back or falls over
  while the screen is no longer its own now releases what it took, and only its own:
  the chat that replaced it keeps its identity, its subscriptions and its policy
  proof. Entering a draft is held to the same rule across its own round-trip —
  stopping a running turn is a request, and a chat opened through it keeps the
  screen, because the draft was asked for before that click.

- The account gate is asked who owns a chat even when lockdown is off, and the client suite fails on console noise it did not expect. ([#364](https://github.com/xarleyn/dsh-plugins/issues/364))

  `attestPolicy` returned the session as attested the moment it saw
  `lockdown.enabled: false`, so with `accounts.enabled` on the browser bound a
  chat and enabled the composer without ever calling the Host. The Host checks
  account identity and ownership before it looks at lockdown — its own comment
  calls that order "independent of lockdown" — and every plugin-owned remote
  re-runs that check, but the bind path is the one that decides whether this
  browser may speak in the chat it restored. Browser chat persistence is keyed by
  deployment and route rather than by account, so signing out and back in as
  another user in the same browser restores the previous account's chat, and the
  skipped call was the only thing that would have named it as somebody else's.
  The call is now made whenever accounts are enabled: with nothing pinned, the
  Host answers with its vacuous proof, `proofMatchesConfig` compares only the
  session the proof names, and a refused restore falls into the path the surface
  already has — the stored id is forgotten and the account gets a chat of its
  own. A deployment without accounts still skips the round trip, because there is
  one principal and nothing to prove. `docs/CONFIGURATION.md` states the split,
  which the text previously described only for the lockdown-enabled case.

  Unexpected console output in the client tests now fails the test. The suite was
  green while jsdom printed an uncaught `props.route.subscribe` TypeError and
  nineteen React warnings, so a crash that no case intended looked the same as a
  run that had none. A setup file wraps `console.error` and `console.warn`,
  matches what it catches against an explicit list of the refusals the tests
  provoke on purpose — attestation reasons, a refused upload, an account action
  the Host turned down — and fails any line outside it. Three things the guard
  found are fixed rather than listed: the footnote section was appended to the
  rendered blocks without a key, the admin-route fixture left `accessApi.session`
  returning nothing which the surface reads once a chat is bound (so a mount
  effect threw and the failure only reached the console), and the async updates
  behind the auth gate, composer, skills page, question form and surface bootstrap
  are now flushed inside `act`, with the crash the guard test feeds its boundary
  suppressed at the window error event the way the panel host already does.

- An account's own skills reach its policy, so the palette and `/name` see them. ([#252](https://github.com/xarleyn/dsh-plugins/issues/252))

  A skill kept in the account's personal list (Settings → Skills, invocable by a
  person) was discovered by the capability catalog and still appeared nowhere a
  person could reach it: the list of skills one session may invoke was built from
  the Common and role lists the administrator maintains, and a personal skill
  belongs to one account while a role is shared by many, so naming it in a role is
  not something a deployment can do. The palette repeated that list, and the same
  list is what closed a typed `/name`.

  A personal skill now joins its owner's user-invoke list directly — palette,
  typed gesture and the enforcement guard read the one policy field, so they cannot
  disagree. It stays out of the model's catalog, which is the role's to decide.
  The role's ceiling still bounds the tools the skill activates with: what the role
  cannot hand out, a personal skill does not get either. An administrator's
  outright withdrawal of the same name wins over the personal layer, and it wins at
  once: a chat that froze the name loses it when the withdrawal lands, because the
  personal half of a frozen snapshot is the live half. The role's half keeps
  freezing, as it does for every other role edit.

- A full quality family keeps every record when one of them is re-judged. ([#337](https://github.com/xarleyn/dsh-plugins/issues/337))

  Retention cuts each family of `quality_rows` down to its cap, and the cut was
  expressed as a range of `seq`: drop everything below `MAX(seq) - cap`. That
  arithmetic equals the overflow only while every sequence value between the
  oldest row and the newest one is taken, and the store itself vacates values.
  Re-rating a message moves that row to the end of its family's order and leaves
  its old value behind; dropping a conversation or a queue entry leaves a hole the
  same way. Every vacated value therefore cost one real record. A family at its
  cap lost its oldest row to a re-judgement of a record it already held — 20 000
  ratings came back as 19 999 — with nothing new arriving to displace anything.
  The in-memory list is trimmed by row count, so the loss stayed invisible until
  the next open of the file replaced the list with the smaller database.

  The cut now ranks instead of measuring: a family keeps the newest `cap` rows by
  `seq` and gives up what falls below that rank, so re-judging what the store
  already holds costs nothing, while a genuine overflow still costs exactly its
  oldest entry. The cut runs on every write and the feedback family grows to
  20 000 rows, so finding the rank reads through an index instead of scanning and
  sorting: schema version 2 adds a `(kind, seq)` index. Four family-scoped reads
  are what it serves — the cap's lookup of the row at its rank, the `MAX(seq)` a
  write takes its place from, the reload of one family, and the ownership sweep's
  read of a family it is emptying. The two counts that check a legacy import are
  not among them — neither the emptiness test that runs before the import nor the
  per-family arrival check after it — because neither sorts anything and both were
  already answered from a covering index, so the new index only changed which one
  they read. What a reader sees newest-first is assembled in memory, by lists that
  sort on `createdAt`; the one statement that reads backwards through `seq` is the
  rank lookup, so the index is not what gives readers their shape.

  What the index removes is the sort, and it removes it from two of those reads —
  the rank lookup and the replay. A re-judgement meets both: the write runs the
  cut and the read that follows it replays the family, so what used to sort the
  family once per write and once per read now walks it. It does not cover the
  table: the reads that want nothing but `seq` — the rank lookup and `MAX(seq)` —
  are answered from the index alone, whereas the replay and the sweep read `json`
  too and still reach the row, so they get cheaper without becoming flat.
  Measured on a feedback family planted to its 20 000-row cap — those four reads,
  each bound the way the store binds it, median of 201 timed calls, SQLite 3.51.3
  on node v24.15.0, JSON parsing left out — the rank lookup went from 7.0 ms to
  0.35 ms and `MAX(seq)` from 2.9 ms to 0.02 ms, the replay from 14 ms to 7.6 ms
  and the sweep from 9.0 ms to 7.9 ms. Of those, the first pair is the figure that
  travels: read from the index alone, milliseconds becoming fractions of a
  millisecond held on a second machine. The shares the replay and the sweep saved
  moved between the runs taken here — the replay by between 45 % and 54 %, the
  sweep by between 4 % and 12 % — so those last two say a direction, not a ratio.
  What stays is the traversal: finding the rank walks as many index entries as the
  cap, so the cap bounds it rather than a seek, but only through that family's
  slice of the index, and the delete reaches just the rows it removes — a write
  that does not overflow pays the read alone.

  The tests fill the feedback family to its cap and re-judge one record, and do
  the same to the review family, each time asserting the row count and which
  record gave up its place both in the open store and after a reopen. Two more
  fill the queue: one drops an entry from the middle and then pushes past the cap,
  asserting in the open store, and one lets the ownership sweep forget three
  conversations of a full queue before refilling it to the cap, through the reopen
  as well. One more opens a file that schema version 1 wrote — rows, no index, and
  the version number saying so — checks that the upgrade adds the index, then
  re-judges a rating through it and reads the file back, so the step is proven on
  the paths a write takes and not only by opening the table. Every other test
  creates its file fresh and would only ever run that step on an empty table. A
  last test reads the query plan of the four statements above, bound with the
  arguments the store's own calls pass, so the index that bounds this cost is
  checked rather than assumed: the rank lookup and the replay walk it instead of
  sorting the family into a temp B-tree, and only the rank lookup and the
  `MAX(seq)` read are answered from the index alone. Nothing is seeded there,
  because a plan is compiled from the statement and the schema rather than from
  how many rows a table holds, and the sweep is claimed no further than that it
  sorts nothing — which of two same-cost indexes answers its bare
  `WHERE kind = ?` is the planner's tie-break and not a property of the statement,
  so what it saves is the measured direction above rather than a number asserted
  here.

- The check that guards answer ratings no longer depends on how fast the machine ([#407](https://github.com/xarleyn/dsh-plugins/issues/407))
  running it happens to be, so a loaded runner cannot report the rating path as
  broken when nothing in it is.

  `rating an answer from the chat surface` asked testing-library for the thumbs
  button and gave the surface one second to produce it. Reaching that button is a
  chain of awaited remotes — the account stage, the access profile, the session
  bind and its policy attestation — and every link commits a render, so the chain
  advances only when the test hands the event loop back to React. It settles in
  ~100 ms alone and needed 2.5 s on a runner shared by twenty project jobs, so the
  second ran out while the surface was still in `creating`. The report blamed a
  missing `Нравится` button, but the DOM it printed showed a chat that had not
  finished opening: no message, no footer, a composer reading «Подключаюсь…».
  Nothing in `QaMessage` was rendered in the wrong phase — the control is offered
  for any settled, non-system message, and the surface withheld the transcript
  until the bind settled, which is the behaviour the rating path depends on.

  The wait is now driven by render rounds: each round is one chance for React to
  commit, and the loop stops at the control it is looking for, so the rounds
  needed are a property of the surface's state machine rather than a stopwatch.
  The click reaches the Host on the spot, so the durable log position the rating
  is filed under is asserted rather than polled, and a surface that genuinely
  never settles says which phase it stopped in instead of naming a missing
  button. No assertion was relaxed: the same expectation, the same `21`.

  For the user the stand is unchanged.

- The QA page loads from a clean npm installation again. ([953bfd48](https://github.com/xarleyn/dsh-plugins/commit/953bfd48))

  The browser entrypoint is emitted as one self-contained classic bundle. Mermaid
  support can no longer leave relative runtime chunks outside DSH's module table,
  and the package and tarball checks reject that broken artifact shape before a
  release is published.

- The sent question stays on screen while the turn takes it over. ([#301](https://github.com/xarleyn/dsh-plugins/issues/301))

  The browser draws a submitted question itself and hands that row to the
  transcript once the Host's own copy of it arrives. The hand-off was timed by the
  session's running bit: a chat that had been seen running and then read idle
  again retired the optimistic row. That bit reaches the surface through the
  session list as well, and a stale `false` relayed at the start of a turn retired
  the copy before the Chat slice had assembled the durable node — the question
  vanished for about a third of a second and came back, with the composer
  unlocking and the empty-chat screen flashing in the gap. On the first question
  of a chat it read as a lost message even though the prompt had been taken.

  The row is retired by facts the transcript itself carries now: its own durable
  user node reaching the projection, or a turn the Chat slice has recorded as
  closed. The running bit on its own removes nothing. A chat whose transcript
  never shows the row still lets go once a turn ends, so the composer cannot stay
  locked by a copy that will never be superseded.

- A skill file the Host only read partly is reported as what it is, and a strict ([#338](https://github.com/xarleyn/dsh-plugins/issues/338))
  skill stops losing on a tool its role already hands out.

  `SKILL.md` is read up to a ceiling, so one oversized file cannot pin a
  memory-bound Host. The read then presented the prefix as the document: the size
  rule compared the loaded bytes against the ceiling they had just been cut to, so
  the limit could not fire for the one file it exists for and the answer came back
  valid, with no diagnostics. The revision was the hash of that same prefix, so an
  append to the tail changed nothing a caller could see, and the contract's
  `sha256(file bytes)` described only its head. The loss followed the edit: open
  such a skill, change the body the editor was handed, save, and the serializer
  wrote back what the draft held — everything behind the ceiling gone without a
  word. The administrator badge broke on the same seam from the other side,
  because a write records the hash of the whole text it wrote while a read answered
  with the hash of what it had loaded.

  The read now carries the file's real size and says plainly when it stopped
  early: the size rule sees the bytes on disk, `skill-file-truncated` joins the
  diagnostics, and the document is marked so the editor knows it is holding a part.
  The revision is computed over the whole file, hashed through a bounded buffer, so
  a change behind the ceiling moves it and a write built on the older revision is
  refused as the conflict it is. Saving over a partly loaded document is refused
  until the client says it knows the copy is incomplete: the editor asks once,
  names what will be lost, and puts the confirmation on the second save. The
  administrator sidecar keeps reading a truncated record as "no marks" — a lost
  badge stays a lost badge, and the reason is now written down where that read
  happens.

  The strict-skill half is the same class of mistake. A requirement was checked
  against the list of tools a grant may still ADD, and the capability policy
  subtracts the role's own base set from that list — so a skill asking for `read`,
  on a role that gives `read` to every chat, was told the tool was unavailable and
  refused outright. What a session already holds now satisfies the requirement, and
  only what it lacks goes through the ceiling and the mask.

  The regressions: a file above the ceiling is checked for its diagnostics, for the
  refused save, for the file it leaves untouched and for the save that proceeds once
  confirmed, and a tail append is pinned to the revision it changes; two grant tests
  cover a requirement the base set alone meets and one that mixes a base tool with a
  grantable one, and a browser test drives the two save clicks.

- The QA surface's own tests are filed by the area of the stand they check, following the shape `dsh-qa-integrations` got in b13e13e. ([#224](https://github.com/xarleyn/dsh-plugins/issues/224), [#325](https://github.com/xarleyn/dsh-plugins/issues/325))

  Two hundred and eight test files and twenty shared helpers sat in one flat `tests/` directory. The area a file belongs to was carried by its name prefix, and that prefix had stopped agreeing with the tree a long time ago: `provenance-*`, `qa-admin-console-*`, `accounts-*` and `session-*` files were neighbours, and finding the test that covers a behavior meant scanning the whole listing rather than opening the folder the behavior lives in. The suite had also grown past the point where a name-only convention holds: two hundred and eight entries in one column is not a table anyone reads.

  The domain folders now carry that information instead — access, accounts, admin, client, config, enforcement, integration, personal-skills, prompt-notes, provenance, qa-tools, questions, routing, scripts, session, slash, transcript, wiring, and a helpers folder. Two groups of latecomers are folded in here: the provenance host files, which landed flat after the first cut, and the notifications and message-queue tests that reached `tests/` from main afterwards. Those now sit under `client/notifications`, `client/components`, `config` and `session`, each next to the module it drives.

  Nothing is re-asserted: no test body, helper, or expectation was rewritten, only paths and the relative specifiers that resolve them. The suite runs the same — two hundred and thirty-two files, one thousand seven hundred and eighteen tests — and no test file is left at the top level, which is the measure this card was opened with.

- A settings card routed through the kit's helper reaches the Plugins panel row now. ([#694](https://github.com/xarleyn/dsh-plugins/issues/694), [#684](https://github.com/xarleyn/dsh-plugins/issues/684), [#647](https://github.com/xarleyn/dsh-plugins/issues/647), [#659](https://github.com/xarleyn/dsh-plugins/issues/659))

  `registerSettingsCard` and `registerSettingsSlot` mounted a card that named no
  `slotName` into `settings.plugin.item` — the keyed seat the Host deleted in
  `0.1.7`. Registering into a seat that no longer exists throws nothing: the card
  was drawn nowhere, neither on the plugin's row nor in Settings. The default is
  `plugins.row.config` now, the keyed seat of the bundle's own row on the Host's
  Plugins panel, which is where a plugin's configuration card belongs. The constant
  took the same rename, `PLUGIN_ROW_CONFIG_SLOT`, so the published surface stops
  naming a seat that is gone.

  Breaking for a consumer that imported `SETTINGS_PLUGIN_ITEM_SLOT`; no package of
  this repository did. A plugin that passes `slotName` behaves exactly as before,
  and one seated on a surface it must frame itself — `settings.section`,
  `settings.plugins.tab` — still names that seat, and `CardShell`,
  `PLUGIN_CARD_SHELL_CSS` and `ChevronDown` stay published for those two cards. A
  row card passing no `styles` is the point: the panel draws the frame, the heading
  and the expand control, so our shell there would be a second card inside the
  Host's.

  The row seat is keyed `<package name>#<row id>` rather than by a bare namespace,
  and `SettingsCardOptions.key` now says so — the same string is the namespace the
  Host resolves the plugin's volatile Config under, so a value saved before this
  change still reads back through it. Moving the seat without checking the key
  would have left the same silent failure one field over, so both registration
  helpers now throw at the call when the row seat is handed a key that is not that
  composite, or styles that declare the `dsh-plugin-card` shell next to the frame
  the panel already draws. A consumer that hit either case drew no card and said
  nothing; it now says what the seat asks for.

  The bump is `minor`, not `major`: below `1.0` that is the step this repository
  takes for a break, since `major` on a `0.4.0` package publishes `1.0.0` rather
  than announcing anything.

  `@yadsh/dsh-qa-surface` carries the same story in its spec. Section 12.3 told a
  reader to register the settings card into the keyed slot this release deleted,
  with the settings namespace as a bare `key`; the section now names the seat the
  bundle actually takes — a `settings.plugins.tab` page identified by that
  namespace — and says what a card seated on the Plugins panel row does instead.
  `SPEC.md` is outside the package's `files`, so nothing an install reads changes,
  which is why that half is `patch`.

- The QA changelog names what #286 actually shipped, and the guards #286 added ([#286](https://github.com/xarleyn/dsh-plugins/issues/286))
  gain the regression tests that hold them.

  Version 0.13.0 described three of its own capabilities — the one-request
  `/no-review` waiver, the automatic managed service profile for a new account,
  and `web_fetch_file` for non-graphic attachments — nowhere, although the plan
  that released them named all three; the curated list now carries them.

  Documentation search pins the grep syntax it promises the model (character
  classes and anchors) and its pattern budget, and `docs_read` refuses an
  absolute path that leaves the documentation tree the way `docs_search` already
  did. Automatic service binding is tested against both of the shapes it has to
  stand down for: a deployment that offers no default profile, and one that
  publishes several. Downloaded attachments test their leaf-only filename
  directly, so a percent-encoded path cannot reach the store with separators.

- The sources panel, the files panel and the markdown renderer now name every part ([#457](https://github.com/xarleyn/dsh-plugins/issues/457))
  of themselves, so a test can point at the node it means instead of guessing it
  from the Russian caption beside it or the BEM class under it.

  Every control those files draw, and every node whose state the sheet carries as
  a class modifier, takes a `data-testid`: `qa-sources-*` for the grouped list,
  `qa-source-detail-*`
  and `qa-source-preview-*` for the detail view and its file preview,
  `qa-source-badges*` for the origin badges the list and the detail share,
  `qa-files-*` for the attachment roster, `qa-md-*` for the rendered document, and
  `qa-source-chip-*` for the source faces the markdown shares with
  the panel. A group heading stays unnamed — its caption is the handle a run reads
  — while the count and the time beside it take one.
  A group takes the id of the kind key it already declares
  (`qa-sources-group-web`, `qa-sources-group-file`), so a new kind inherits its hook
  rather than naming one, and a state the class carried as a modifier carries the
  same fact in the id — `qa-source-preview-line-highlight`, `qa-md-math-pending`,
  `qa-files-thumb-broken`. The truncated file preview carries an id of its own, so
  the check that a long source does not take the answer down with it names the
  notice instead of matching its sentence. A `mermaid` fence is a code block here —
  the client carries no diagram engine since 0.14.0 — so the fence is reached
  through the code-block ids and nothing names a diagram of its own. The values are
  ASCII kebab-case, zoned by prefix, and no two of them name different things in
  the package.

  The panel and renderer tests now reach those nodes through the ids instead of
  `querySelector(".dsh-qa-*")` or `getByText`, and what a test asserts about a
  caption or a control — the group titles, the Raw/Rendered toggle, the
  jump-to-message button, a source link — it still asserts through
  role, accessible name, or the control's own ARIA state. No markup and no
  appearance changed: an attribute was added.

- The QA page stops downloading a diagram engine, and the bundle band starts ([#599](https://github.com/xarleyn/dsh-plugins/issues/599))
  measuring in CI.

  The browser entrypoint is one classic ModuleLoader file: DSH fetches
  `/plugins/<package>/client.js`, evaluates it, and never asks that plugin for a
  second module, so a client bundle carries its own copy of everything it uses and
  `react` is the only thing the shell answers for it
  (`docs/ARCHITECTURE.md`, §Host process vs browser client).
  Mermaid arrived in 0.13.0 as a plain import of the whole engine, and the artifact
  followed it: 239 027 lines and 9.3 MB where the same build measured 66 745 lines
  and 2.8 MB without it. Reading the built bundle's own source map names where those
  lines come from — mermaid 73 681, cytoscape 35 707, the diagram-language parser
  34 060, plus d3, dagre, roughjs and the rest — the tree behind one fence is 72% of
  what the QA page downloads before it paints anything.

  Neither way out that the size of a bundle usually has is open here. The engine is
  not something the shell could provide: none of the `@deepseek-ai/*` client bundles
  in the tested matrix contains it, so declaring it external would leave the page
  with a `require` nobody answers — which is the 0.13.1 incident. The tarball gate
  catches a relative `require("./x")` that resolves to nothing, not a bare one, so
  the size band in `check-file-budget.mjs` is what holds this line. And a deferred
  chunk is the same unavailable
  second file seen from the other end: `codeSplitting: false` is what made the QA
  page open again. So the diagram engine leaves the client. A `mermaid` fence
  renders as the code block it was before 0.13.0 — an open fence shows what has been
  written so far, a closed one shows the source, and both keep the copy control.
  KaTeX stays: math is 16 671 source lines against the engine's 172 111, it is what
  makes a formula read as a formula, and it is the one third-party tree this surface
  can name a reason for. Getting diagrams back is a host question, not a plugin one:
  either the shell renders them or the loader learns to fetch a plugin's deferred
  module, and until one of those exists the client must not carry the tree.

  The second defect is the one that let the first stand for two days.
  `pnpm check:files` holds a generated bundle to a runaway line limit, and its own
  comment bases that limit on this file — but `lib/` is gitignored and the gate runs
  in the `prepare` job, on a checkout that has never been built, so in CI the band
  reported `0 generated artifacts` and the line was crossed only because someone
  rebuilt locally. The CI workflow now runs the same gate in the project job, right
  after that project's build, which is where its bundles exist; the repository
  tooling test pins both the step and its position after the build, and
  `docs/VERIFICATION.md` says which band measures what where.

  Tests: the Mermaid suite pins the fence as source rather than a rendered diagram,
  the streaming suite keeps the open-fence case with the renderer's calls removed,
  and the curated changelog loses the 0.14.0 entry that promised to fix diagram
  re-rendering on every keystroke — the thing it described is gone with the engine.
  Verified with `pnpm nx run @yadsh/dsh-qa-surface:check` (lint, typecheck, test,
  build, verify) and `pnpm check:files`, which now reports the client at 66 745
  lines against the 80 000 warning.

- The settings card test reaches the session section through its own hook. ([#603](https://github.com/xarleyn/dsh-plugins/issues/603))

  One case in `qa-settings-card-sections.test.tsx` asked `section()` for «Сессия»
  — the caption an operator reads — while the helper takes a `data-testid`, and
  the section's test id has been `qa-settings-session` since the card named its
  markup. The lookup therefore found nothing and the case failed. It asked for the
  request-ceiling field inside that section, so the assertion it carries — the
  field's `max` must equal the number `QA_MAX_ACTIVE_REQUESTS_MAX` the Host
  validator enforces — never ran.

  The assertion itself is untouched: it still quotes the validator's constant
  rather than repeating a number, which is the half of the deal that keeps the
  card and the Host schema from drifting apart. No source of the package changed,
  so no release note is added.

- A turn the Host ended in failure says which failure it was, in the chat and in the stand's log. ([#636](https://github.com/xarleyn/dsh-plugins/issues/636))

  The terminal row was one sentence for every failure the Host does not own localized copy for, so a stand whose provider adapters never registered — each turn ending `NO_ADAPTER`, the answer never written — looked exactly like a transport hiccup: «Помощнику не удалось завершить ответ.» The code and the provider it names were in the session journal, which is a zstd archive nobody opens over an operator's shoulder, and in neither the chat nor the plugin's daily log, where the round's tool warnings were the only lines. Every such case became a manual decode.

  Every terminal failure row now carries its code, because the code is the handle an operator greps the log with — including the failures that already had their own sentence, since that sentence is identical on every stand while the log line is per chat, and the code is what ties the two together. `UNKNOWN` is left out of both rows, terminal and retry: it is what the Host writes for anything that is not a provider failure, so naming it promises a diagnostic that does not exist, and one failure must not be called two ways inside one transcript. A missing adapter gets its own sentence rather than the code alone, because the one thing a tester would otherwise try — asking again — cannot repair a registry the Host never filled, and that sentence points at the log line without promising a provider name the record may not hold.

  On the Host, a turn closed with an error is recorded as `session.turn-failed` with the chat, the turn, the failure code and the provider the request was routed to. A delegated expert is recorded under the chat that owns it, because an operator reads the log against the chats of /qa and an expert id matches none of them; the expert's own id rides along as `failedSessionId`, so two experts of one chat that died on the same turn number do not collapse into the same line. For a registry refusal the provider is read out of the Host's own refusal sentence — it comes in two variants, `llm.registration` naming a provider with no adapter and the pi-ai adapter naming one it does not own, and the second is what the stand of this card actually hits — because that sentence describes the route this turn asked for while the session's folded header describes the conversation and can still carry an earlier provider. Every other code keeps the header as its source. Only the name between the first pair of quotes is taken, and only from those two whole sentences: a provider message is free text that can echo a credential, so no message text reaches the log. Delegated experts resolve through the ownership map the interactive seams install, and the wiring test drives that map under a real context, so a seam that stopped listening or a resolver collapsed back to a boolean fails a test instead of quietly narrowing the record to the chat's own turns.

  This is the diagnosability half of #636 only. Why `llm-pi-ai` came up without registering `local-dev` after the container's restart, and the official-provider «Add an API key to get started» modal that appeared on `/qa` in the same restart, are left for separate cards: this change makes both readable from the log line rather than a decoded journal, and fixes neither.

- A queued question leaves the strip when the turn takes it, instead of staying ([#643](https://github.com/xarleyn/dsh-plugins/issues/643))
  behind as a question that has not been sent yet.

  A message sent while the agent was answering was admitted by the Host, listed by
  its queue and answered in the next turn, yet its row stayed above the composer
  marked «отправляется…» with no button on it. The strip drew two different rows for
  one send: the queue's own row while the message waited, and a transport row built
  from the submission echo the session library registers in this browser for it. The
  echo is supposed to be retired when the queue accepts the message; while it is
  listed, the strip folds it into the queue row it stands for. So an echo that
  outlives its own claim becomes visible again the moment the claim empties the
  queue — a permanent row over a question the transcript had already answered.
  Reload made it go away, which is how the repro proved the state was the browser's,
  and the visitor typed the question a second time: the duplicate send under load is
  exactly what the queue exists to prevent.

  Naming a message is the server's own receipt for it, and the Host names it in two
  of its own lists: the Inbox that holds what waits, and the durable input row it
  writes when the turn takes the message. The surface now records either name per
  binding — a submission the Host has once named is settled, so the strip reads it
  from the queue while it waits and never again as a question crossing the
  transport. The claim frame therefore yields no row at all, while a send the Host
  has never named is still marked as crossing, and a message the server holds and has
  not claimed keeps its three operations. The record is never dropped while the
  binding lives: `beginSubmission` mints a fresh `randomUUID` per submission, so an id
  the server named cannot belong to a later send, and dropping the receipt is what
  lets the survivor come back. It belongs to the chat that minted the ids, so another
  chat's queue says nothing about this one's sends.

  The receipt is taken from the Host's notification, before the running turn's frame
  spacing, and not from the frame that reaches the screen. A question sent while the
  agent answers is admitted inside a spacing window, and an absorbed window frame is
  dropped rather than replayed: measured on the projected frame, the pair of facts —
  the echo the snapshot registers and the message the queue lists — can reach the
  browser without ever being seen together, and the claim frame then finds nothing to
  settle the send against. That is the row this card reports, restored. Reading the
  transcript as well closes the order the Inbox alone cannot: a send admitted *and*
  claimed between two notifications is named by no queue frame this browser is
  handed, and only its durable row — which outlives the claim and arrives with the
  next frame — settles it.

  What the record costs and what it does not are both the mask's, not the Host's.
  It costs no row the contract would have drawn, because the library has already
  committed to the removal by the time either Host list can name the send: the Inbox
  frame that lists a queued echo latches the retirement there and then, and so does
  the durable row that opens the turn (`client.js:2201` and `:2213`, both handing the
  request to `scheduleObservedRetirement` at `:2233`). A message the Host takes out of
  its queue without handing it to the turn is therefore not a case the record
  swallows — its removal was latched the moment the Inbox listed it, and only the
  frame is missing. The retirements the library runs with no frame are the ones for a
  send the Host never named at all: the abandon path and a failed prompt
  (`client.js:1704`, `:1753`), and the splice reporting `outcome === "canceled"` for a
  settlement tracked by insertion receipt, which a queued echo never is
  (`client.js:2164`, `:2186`, `:2245`). So the mask differs from the contract by the
  clock, never by the outcome. What it costs is the binding:
  `unbind()` drops the record, and that runs not only on leaving a chat but also for
  a subagent view, a policy re-bind and entering a draft. Only a rebind of the same
  Session object could draw a survivor again, and this surface retains under one
  source — releasing its reference makes the manager withdraw the instance and
  dispose it (`client.js:2413`), so the next binding holds a session with no echoes
  at all. Where another holder keeps that object alive, the next Host frame names the
  send again and re-earns the record, so the row returns for a frame rather than for
  good.

  None of this is a cure, and the cure is not in this package. The echo is the
  browser's own: `@deepseek-ai/dsh-api-session-controller` — the harness's
  `packages/api/session-controller`, pinned here at 0.1.7-rc.2 — describes
  `SessionSnapshot.pendingSubmissions` as "Local prompt-submission echoes not yet
  observed as durable events or queue occurrences" and `beginSubmission` as "Queued
  echoes retire on queue acceptance", that retirement being the `observed` branch of
  `PendingSubmissionRetirement`. It does not happen at acceptance. In the pinned
  bundle `scheduleObservedRetirement` (`lib/client.js:2233`) latches the settlement
  and hands `finishSubmission` to `scheduleFrame` (`lib/client.js:2309`), which calls
  `requestAnimationFrame` and takes the macrotask only where that function does not
  exist at all. The follow-up is that one step: retire a settlement a delivered
  notification already proved without waiting for a frame — or take the macrotask
  whenever the frame clock stops, not only where there is no `requestAnimationFrame` —
  since a surface that gets no frames never runs the removal. This surface changes
  neither that contract nor the server: the strip only stops lying to the visitor
  while it goes unmet.

  So the mask has one proven case and one predicted, and the seam between them is the
  frame clock. The card measured the browser panel collapsed (`viewport=0x0`), where
  the deferred removal cannot run while the snapshot notifications keep arriving —
  those are published on microtasks by the same package — so the feed moved and the
  row stayed: that is the branch this change fixes, and the branch the repro is in.
  With the panel shown and the tab focused, the same mechanism predicts the row leaves
  by itself one frame after the claim, and the mask then holds the dock to its own
  promise rather than a symptom a visitor saw — "a row that left the queue must not
  keep anything" (`QaQueueDock.tsx:148`). The measurement that separates the two is
  the card's repro repeated with the panel open and the tab active, on a short turn,
  and it is not taken here.

- The shell's own screens are now addressed by a stable id. ([#454](https://github.com/xarleyn/dsh-plugins/issues/454), [#453](https://github.com/xarleyn/dsh-plugins/issues/453), [#456](https://github.com/xarleyn/dsh-plugins/issues/456), [#458](https://github.com/xarleyn/dsh-plugins/issues/458))

  The surface root, its zones, the account-checking placeholder, the
  administrator-only refusal, the empty-chat welcome, the read-only and error
  notices, the composer's slot and the guard's failure card carry `data-testid`
  (epic #453). Tests that located those nodes by CSS class or by visible wording
  now ask for the id, so rephrasing the stand no longer reads as a broken build;
  the role and accessible-name assertions that check the same nodes stay. The
  fullscreen frame the failure card inherits from the surface root is pinned as a
  stylesheet contract, which is the only claim a class query was really making.

- The chat, its message rows and its composer became addressable from a browser ([#455](https://github.com/xarleyn/dsh-plugins/issues/455))
  run, so the surface can be driven without naming the Russian words it paints.

  Every check of this surface had to say what it clicked in the operator's own
  vocabulary: a test found the optimistic row by its `data-status`, the attachment
  chip by the file name it renders, the running status by its copy, the pager of a
  parked question by a CSS class. Copy is the least stable handle the surface
  offers — it is localized, the composer hint changes with the phase of a turn, and
  an answer's text is the one thing a run cannot know in advance. The browser round
  of epic #453 asks for a second handle that survives both a copy edit and a
  language switch.

  The eight components of the transcript, the composer and the cards that park a
  turn now carry `data-testid`: `qa-message` and its parts (`qa-message-content`,
  `qa-message-actions`, `qa-message-meta`, `qa-message-pending`, the rating, copy
  and regenerate controls), `qa-composer` and its parts (`qa-composer-input`,
  `qa-composer-send`, `qa-composer-stop`, `qa-composer-attach`, `qa-composer-hint`
  and the pending-attachment lists), `qa-turn-rail` with `qa-turn-rail-mark` on
  every rung, `qa-question` and `qa-approval` for the two cards that wait on a
  person, `qa-turn-notice` for the stack, `qa-variants` for the answer switcher and
  `qa-file` for the attachment chip the composer and a sent message share. Values
  are ASCII kebab-case and every zone keeps its own prefix. A repeated node carries
  the value of its template rather than a number of its own — the rungs of the
  ladder, the chips of one message and the lines of the stack all read alike, and
  which one is meant stays the run's business, told apart by the accessible name or
  the place in the list the node already offered.

  Only attributes were added: no element moved, no class changed, and the sheet
  still describes every box, so the surface looks and reads exactly as before. The
  package's own checks moved to the new handles wherever they had used visible text
  or a class as the locator — the metadata row, the byline, the attachment chip, the
  composer hint and its hidden file input, the pager and the option list of a
  question, the reason and the delegation mark of an approval, the lines of the
  completion stack, the optimistic row on the whole surface — while every assertion
  on a role or an accessible name stayed where it was, because those are the checks
  that keep the surface usable without a screen.

- The `/qa` surface names the parts of its own chrome, so a browser test can point ([#456](https://github.com/xarleyn/dsh-plugins/issues/456))
  at a node instead of at the Russian words beside it.

  Sidebar, header, right rail, agents panel, workspace browser, work group, dialog
  shell, auth gate and the welcome notice were all reachable through their BEM
  classes or the visible label — and several of them repeat one class across every
  row, tab and entry, so a check had to match a caption or a modifier to find the
  node it meant. A reworded label, or a renamed class, broke such a check while
  nothing was actually wrong with the surface. Each zone now says what it is:
  `sidebar-*` and `sidebar-resize` for the chat history and its handle,
  `header-*` and `subagent-banner-*` for the chrome above the transcript,
  `rail-*` for the sources and files panel, `agents-*` for the subagent list,
  `workspace-*` for the file browser and its preview, `work-*` for the turn's
  reasoning and tool rows, `modal-*` for the shared dialog shell, `auth-*` for the
  sign-in card, `welcome-*` for the disclosure and `width-handle-*` for the two
  content handles. The values are ASCII kebab-case and unique in the package;
  where a zone repeats — a row per chat, a tab per panel, a handle per side — the
  recurring parts share one id and the side-specific ones carry their discriminator.

  Nothing else moved: no class, no attribute the reader sees, no layout — only the
  test attribute. The surface's own tests reach those nodes by id now and keep
  asserting every control through its role or accessible name.

- The QA admin console became addressable from a browser run, so driving it no ([#458](https://github.com/xarleyn/dsh-plugins/issues/458), [#453](https://github.com/xarleyn/dsh-plugins/issues/453))
  longer requires naming the Russian labels it paints.

  The console is the most clicked surface of the plugin and the least reachable
  one: a check found the delete control, the row's «Открыть», the reset queue's
  «Сбросить», a priority cell or the collapsed tool calls by the string rendered
  beside them, and the console shell itself by a BEM class. Copy is the weakest
  handle a page offers — it is localized, it is reworded without changing any
  behaviour, and a filter's label is exactly the line a maintainer edits when the
  filter stops matching what operators search for. This is the admin-console round
  of epic #453.

  Every node a run reaches now carries a `data-testid`: the shell and the
  navigation (`qa-admin-root`, `qa-admin-nav-<section>`), each page
  (`qa-admin-overview`, `qa-admin-conversations`, `qa-admin-review-queue`,
  `qa-admin-quality`, `qa-admin-audit`, `qa-admin-users`, `qa-admin-user-card`,
  `qa-admin-memory`), and inside them the controls, the state chips and the row and
  cell hooks. Filters and paging are named first, because they are what a copy
  edit breaks: one id per filter (`qa-admin-conversations-filter-from`,
  `qa-admin-users-filter-role`, `qa-admin-memory-filter-expert`, …) and one
  `qa-admin-pager` with its `-count`, `-more` and `-reset` controls, shared by
  every paged list. Values are ASCII kebab-case with the zone in the prefix, and a
  repeated node keeps the value of its template — the rows of a table, the badges
  of a message, the buckets of the effective-access tab all read alike, and which
  one is meant stays the run's business, told apart by the accessible name or the
  place in the list the node already had. Explanatory prose is deliberately left
  unnamed: an id marks a control, a state or a shell, not a sentence.

  Only attributes were added. No element moved, no class changed, and no `role` or
  `aria-*` attribute was touched, so the console looks and reads exactly as it did.
  The console's own checks moved to the new handles wherever they had used visible
  text or a class as the locator — the metric a counter row paints, the transcript
  and its collapsed tool calls, the refusal of a deletion, the priority and reason
  of a queue item, the password-reset queue and its field, the memory rows and
  their editor, the skill table's health and its blocked verdict, the role card's
  counts, the console shell in the routing checks — while every assertion on a role
  or an accessible name stayed where it was. The namespace picker and the review
  form's problem options are still reached through the name a screen reader reads,
  which is the coverage the epic asks to preserve.

- Every control of the plugin settings card is now addressable by a stable test ([#459](https://github.com/xarleyn/dsh-plugins/issues/459), [#453](https://github.com/xarleyn/dsh-plugins/issues/453), [#407](https://github.com/xarleyn/dsh-plugins/issues/407))
  id, so a browser run drives the card without naming the Russian words it paints.

  The card body is the densest form in the plugin: thirteen sections, their
  switches and fields, and the notices that appear when two of them contradict
  each other. Its checks reached almost all of that through the copy an operator
  reads — a section by its heading, a warning by its first words, the error plate
  by its class — and copy is the weakest handle the surface offers: it is
  localized, and a reworded hint silently broke the test that keyed on it.

  The sections now carry `qa-settings-<section>` and their controls
  `qa-settings-<section>-<setting>`, ASCII kebab-case with the zone in the prefix
  and no index substituted into an id; a notice is named by what it warns about
  (`qa-settings-lockdown-notice-disabled`), a status chip by what it reads out
  (`qa-settings-status-accounts`), and the «изменено» marker by the section it
  belongs to (`qa-settings-access-modified`). Two notices swap their wording
  between the branches of a condition and keep one hook, since only one of them
  is ever on screen; apart from that pair the open card answers to each name once.
  The card shell keeps the contract `AGENTS.md` sets for it: the hooks
  were added inside the body, and every className, role and aria attribute stays
  byte-identical — the card looks and reads exactly as it did.

  No release note is added for this: nothing a visitor sees has changed.

- The settings dialog, the role selector and the slash palette became addressable ([#460](https://github.com/xarleyn/dsh-plugins/issues/460), [#453](https://github.com/xarleyn/dsh-plugins/issues/453))
  from a browser run, so the parts of the surface a person configures can be
  driven without naming the Russian words they are painted in.

  Every check of these three zones reached its node through the copy on screen or
  through a BEM class: a test found the account facts by the email it renders, the
  refusal notice by its sentence, a starter row by `.dsh-qa-starters__item`, the
  group headers of the palette by «Навыки», and the confirm button of a role change
  by the name of the role it switches to. Copy is the weakest handle the surface
  offers — it is localized, it changes with the state of a form, and the label of a
  save button is literally the verb the feature is named after.

  The components of `src/client/user-settings`, `src/client/role` and
  `src/client/slash` now carry `data-testid`: `qa-settings-*` for the dialog shell
  and its seven pages, `qa-role-*` for the selector and the confirmation it asks
  for mid-conversation, `qa-admin-preview-*` for the preview banner and its way
  out, and `qa-slash-*` for the palette, its groups and its rows. Values are ASCII
  kebab-case and every zone keeps its own prefix. The field primitives the pages
  share — a field, a section, a toggle, a notice, a button — take the id from their
  call site rather than inventing one, so the same primitive reads
  `qa-settings-profile-save` on one page and `qa-settings-tokens-revoke` on
  another. A node repeated over a list keeps the value of its template — the tabs
  of the dialog, the rows of the palette, the chips of granted tools — so no
  account key is ever substituted into an id, and which one is meant stays the
  run's business, told apart by the accessible name or the place in the list the
  node already offered.

  Only attributes were added: no element moved, no class changed and no style was
  touched, so the dialog, the banner and the palette look and read exactly as
  before. The package's own checks moved to the new handles wherever they had used
  visible text or a class as the locator — the account facts, the leads and hints
  of the pages, the notices that refuse a save, the rows of the catalog and of the
  token list, the group titles and rows of the palette — while every assertion on
  a role or an accessible name stayed where it was, because those are the checks
  that keep the surface usable without a screen.

- The audit badge, the audit dialog and the extension panel became addressable from ([#461](https://github.com/xarleyn/dsh-plugins/issues/461))
  a browser run.

  Epic #453 gives the surface handles that survive a copy edit and a language
  switch. The transcript got its own in the same epic; this is the two zones that
  sit beside it — the mark a session row carries when its chat has been audited,
  the dialog that opens from it, and the right-hand panel an extension mounts into.

  The four components now carry `data-testid`: `qa-audit-badge` with its check and
  its verdict, `qa-audit-dialog` and `qa-audit-dialog-body` for the dialog, and
  `qa-panel` for the panel shell with `qa-panel-header`, `qa-panel-title`,
  `qa-panel-close`, `qa-panel-resizer`, `qa-panel-body`, the `qa-panel-launcher`
  strip and its `qa-panel-launcher-button`, plus `qa-panel-missing` and
  `qa-panel-error` for the two diagnostics the shell renders when a panel has no
  keyed body or its body throws. Values are ASCII kebab-case and each zone keeps its
  own prefix. A repeated node carries the value of its template rather than a key
  substituted into it — every launcher button and every retained panel body reads
  alike, and which one a run means stays the run's business, told apart by the
  accessible name or the place in the list the node already offered. Text
  paragraphs and the layout wrappers between the parts stay unnamed, so an id marks
  a control, a state or a shell rather than a sentence.

  Nothing here is user-visible: only attributes were added, every element, class,
  role and aria attribute stayed as it was, and the sheet still describes every box.
  The package's own checks moved to the new handles wherever they had used a BEM
  class as the locator — the verdict of a badge, the modifier a row with a delete
  control gets, the resizer and the retained body of a panel — while each assertion
  on a role or an accessible name stayed where it was.

- A turn notice speaks for a chat the reader owns, and for no other one. ([#477](https://github.com/xarleyn/dsh-plugins/issues/477))

  `accounts.showOtherUsersChats` is a read: it puts the other accounts' chats into
  the sidebar so an admin can open them. The completion notifier was handed the
  sidebar's own rows, so that same switch also decided whose finished turn this
  browser announces. An admin reading the shared history watched every listed chat
  and got a line the moment one of them stopped answering — and with the desktop
  channel on, the operating system got a notification whose title it keeps on disk,
  for a turn that belonged to somebody else. Reading a chat is not being told when
  its turns stop.

  The account now holds the two lists apart. `ownedIds` stays what the sidebar
  shows: the account's own chats plus, for an admin, every mapped one. `ownIds` is
  the account's own alone, and it is what bounds a notice — the differ never sees a
  chat the reader does not own, so it does not even remember that another account's
  turn was running, and a chat leaving the shared view leaves no notice behind. A
  chat this page claims enters both lists. A refresh re-reads the strict one: the
  merged list can survive the account losing a chat whose ownership record still
  names it, so it is not the proof that nothing changed.

  The read scope kept everything it had. The admin's sidebar, its grouping by
  owner, the author labels over foreign chats and the audit badges list exactly
  what they listed before, and a deployment with the shared history off behaves as
  it did — there the two lists are the same list. Nothing was made configurable
  instead: another account's activity has no delivery channel here at all, and
  giving it one would take a choice on the admin's side and an allowance on the
  deployment's, not the read flag that happens to be on.

- The keyboard reaches the turn notices, and keeps its place when one goes away. ([#482](https://github.com/xarleyn/dsh-plugins/issues/482), [#624](https://github.com/xarleyn/dsh-plugins/issues/624))

  The notice stack is painted in `document.body`, outside the `<main>` whose key
  handler holds Tab inside the QA interface, so the ring was drawn around a subtree
  the notices were not part of: a Tab leaving the composer turned back at the
  surface's last control, and `open`, the line's cross and the desktop opt-in
  could not be reached without a mouse. The ring now walks the surface and the
  stack together, and a key typed inside the portal is trapped by a handler mounted
  on the portal itself — `<main>` is not its ancestor and never hears it. Only Tab
  is taken there, so an Escape given inside the stack still reaches a dialog that
  listens on the window. And while a modal dialog holds the keyboard — the
  onboarding gate marking the page inert, or a `QaModal` standing over it — the
  ring steps back to the surface alone: the stack is a neighbour of such a dialog
  rather than its content, so a trap closed around both would take the reader out
  of the dialog they are working in and back onto a page under the scrim.

  Losing the focused control is read where it happens rather than from the number
  of lines. Waving one of the three off, a fourth turn pushing the oldest out of a
  full stack, and the opt-in going away once the browser has answered the
  permission question all take the focused button out of the page while the stack
  stays on screen; the page then answers the next Tab with the browser's own order,
  which leaves the interface. The ring remembers the line the reader stood on and
  hands the keyboard to the line that took its place, on the same control of it —
  a cross given back as a cross. A stack control alone is remembered: a row of the
  chat list, the queue dock, or a transcript action that leaves the page under
  focus is the surface's own business, as it was before. And the remembered place
  goes only with the focus it hands back — a reader who moved the keyboard
  elsewhere, by mouse or into another dialog, is not pulled back, and a dialog that
  owns the keyboard is left to place the focus where it belongs.

  Two of the ways a place is handed over are decided rather than left to chance.
  Opening a chat from a line is the one loss that also changes what the surface
  shows: the notice goes, its chat arrives, and the keyboard stays on the stack —
  the composer the switch remounts is disabled while that chat is being bound, so
  it can take no focus, and nothing in the surface moves the keyboard on a switch
  further than it already does. And a page the reader has left to work in another
  window is left alone: while `document.hasFocus()` is false nothing here touches
  the keyboard, because a control of a page nobody is looking at has no claim on
  the page the reader is typing in. The hand-over is owed rather than dropped —
  the remembered place stands until the window's own `focus` event pays it, so the
  reader who comes back to a stack that dropped a line under them finds their place
  and their next Tab is the interface's.

  What the ring counts as a step is what a browser stops on, read off the markup:
  the negative `tabindex` is subtracted from every kind of control, not only from
  the elements that carry the attribute, `hidden` is read along the ancestor
  chain, a `select` or a `summary` — the role picker of the header and the fold of
  a message — is a step of the way, and the body of a fold the reader has not
  opened is not. A ring with no controls in it takes no key at all: a Tab
  prevented with nowhere to hand the focus is a key that sticks.

  The markup is not the whole of what a page hides. The chat rail is switched off
  at ≤900px and the sidebar at ≤600px by a media query, which leaves neither a
  `hidden` nor a `tabindex` to read, so the enumeration reads the layout too: a
  control whose own or whose ancestor's computed `display` is `none` is off the
  path, and so the edge of the ring is drawn at a control the reader can actually
  stand on. The walk up the ancestor chain is what says it — a control of a
  switched-off subtree answers for its own `display` exactly as it does on screen,
  which a live Chromium measured on the two production rules. As a last step the
  hand-off still asks each candidate to take the keyboard and spends the key on the
  next control of the way if it answers by moving nothing, which covers the refusal
  no read predicts and the environments that apply no CSS at all.

  Both were measured in Chromium with the production sheet and the ring module of
  this branch on a fixture shaped like the mounted surface — the sidebar, the
  header, a fold, the rail, the composer, and the stack in `document.body` — with
  real `Tab` and `Shift+Tab` presses. At 1200px the trail from the composer walks
  `send → open → dismiss → opt-in` and turns back at the stack's edge into the
  first control of the sidebar. At 500px, where both parts are switched off, the
  ring enumerates neither, and Shift+Tab from the header's control — the front the
  width leaves — lands on the stack's opt-in; against the ring as it stood at HEAD
  the same press leaves the page for the browser's own order, and the walk back from
  the composer escapes at that same step. At 850px, with the rail switched off and
  no notices on screen, Tab from the composer's send turns back into the interface.
  What the stand still owes is the same walk on the mounted surface in a browser:
  not run, because the browser panel of the stand is collapsed (`viewport=0x0`) and
  gives no real key presses to observe.

- The QA surface reads its configuration the way a 0.1.7-rc.2 host publishes it, and its card edits it from its own tab. ([#513](https://github.com/xarleyn/dsh-plugins/issues/513))

  On 0.1.5 the plugin installed a settings namespace and the browser bound to it
  through a settings scope. The Host rewrote that subsystem: the namespace of an
  entry IS its profile entry id, a field is editable while its schema node carries
  `.volatile()`, and the browser edits it through `ctx.configForms`. Every
  top-level field of this plugin's Config is therefore declared volatile, the
  plugin reads the current snapshot of each reference on every operation instead
  of holding one resolved copy, and the parts that are not read per operation — the
  registered routes, the one-time configuration warnings — re-sync on the Host's
  `settings/document-updated` notification for this entry. The generated page is
  switched off, because the plugin's own card is the page; the card binds to
  `dsh-qa-surface`, the row id the bundle declares, and registers as a tab of the
  Plugins settings section under the shell contract it already kept. The key of a
  queued message is now read from the session's Inbox projection, since the queue
  left the session snapshot; delegated chats are named from the host list rows the
  `subagent` origin marks, since the parent-keyed catalog left the list state; a
  retained reference replaced the Host-wide `open`; a running tool call reports its
  arguments only once it has started; and the notes the plugin injects carry their
  own producer kind, because the catch-all `plugin` kind is gone.

  Two host facts the compiler surfaced are settled rather than worked around. The
  preset registry reads its scope through a revision lease (`acquireScope`), held
  for exactly the capability-catalog read that borrowed it, because
  `standingKeyFor` was deleted, not relocated. And the `auto` permission preset,
  which resolves to `approval: ask`, is now refused as a lockdown preset at
  configuration time — the lockdown pins `never` and cannot be weakened, so a
  deployment that named `auto` previously only learned it could not attest one
  chat at a time.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0
- Updated @yadsh/dsh-audit-core to 0.1.1
- Updated @yadsh/dsh-audit-ui to 0.1.2

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.13.0 (2026-09-24)

### 🚀 Features

- QA conversations now render Mermaid diagrams with secure source fallback, ([aafad8b](https://github.com/xarleyn/dsh-plugins/commit/aafad8b))
  documentation search accepts safe grep-style alternatives and canonical paths,
  and the role-change dialog uses the surface's normal controls.

  Managed integration defaults are provisioned for new users without overriding
  an explicit disconnect, the structured `/no-review <request>` command bypasses
  the automatic review gate for exactly one durably linked request, and
  authenticated fetching can retain arbitrary successful responses as durable
  file attachments while keeping grants administrator-controlled.

- Recover the answer ratings that stayed behind in people's browsers. ([#226](https://github.com/xarleyn/dsh-plugins/issues/226))

  Every thumbs given between per-message feedback shipping and the fix that
  started sending it to the Host lives only in `localStorage`, and nothing reads
  it any more. A browser's ratings map is chat-scoped and keyed by the answer's
  browser id, `assistant:<log position>`, so a rating of a chat this account owns
  can still be traced back to the durable row it judges — but only once, because
  the map carries no timestamp and no reasons, so it cannot tell a lost rating
  from one the Host already holds a fuller version of. Replaying it through the
  ordinary rating write would replace a negative verdict with its reason and
  comment by the bare thumbs.

  The Host therefore gained an insert-only write, `adminHarvestFeedback`: it
  records a rating nobody has filed yet, reports what it already holds instead of
  rewriting it, and refuses a conversation the token does not own entry by entry,
  so one foreign chat cannot lose the rest of the batch. On the first login of an
  account the surface reads its local maps through that write — only the chats the
  account owns, only the ids that name a log position, in batches — and marks the
  account as read afterwards, so the replay never repeats and a failed pass is
  retried by the next login rather than lost. Ratings whose answer id names no log
  position, and the deployment-wide map the first releases wrote, stay in the
  browser: guessing which chat a thumbs belonged to would put words in the
  reviewer's mouth.


### 🩹 Fixes

- The administrative console's aggregate pages answer without re-reading the ([#249](https://github.com/xarleyn/dsh-plugins/issues/249))
  deployment's conversation logs.

  «Обзор», «Разговоры», «Аналитика» and «Очередь разбора» took minutes to open on
  a stand with real history (over four and a half minutes observed), and while one
  of them was loading the other administrative calls waited behind it, because the
  browser gives a single origin only a handful of connections.

  The cost was in conversation-log reads, and two things made it unbounded. The
  conversation list read the log of every reserved conversation to filter a list
  that no filter had asked anything of — a title matters only while somebody is
  searching, and a page shows twenty-five rows. The aggregate pages read the newest
  two hundred logs again on every load, each of those reads being a full listing of
  every stored session plus a replay of the log asked for, and reading one page
  evicted the projections another page had just built because the cache was smaller
  than the scan window it serves.

  The list now reads logs only where a filter needs one: without search text a page
  costs its own rows. A conversation the Harness no longer holds cannot gain
  messages, so its projection is kept instead of expiring after the TTL — which
  still applies to a conversation being written. The counts and the tool-failure
  signals are collected in one pass over the window, and a caller that asks for a
  window already being scanned joins that pass rather than starting a second scan.
  All four of those calls now carry the browser's cancellation: leaving a page that
  has not answered stops the scan between two logs instead of finishing it for an
  answer nobody will read.

- The sources of a turn are collected from a real session journal again. ([d17bced](https://github.com/xarleyn/dsh-plugins/commit/d17bced))

  The host pairs a tool result with the call that produced it by the id written on
  the result block. The Harness names that field `toolCallId` — its own validator
  rejects a `tool/result` whose block id differs from `message.source.callId` —
  while the plugin read `callId`, a name no real event carries. On a deployed
  stand the pairing therefore failed for every call: nothing was collected, every
  turn's bundle stayed empty, and everything downstream showed the consequence —
  the sources panel had nothing to list, a file the chat had just read refused to
  open in preview, and the answer carried no evidence. `toolCallId` is read now,
  with `callId` kept as the fallback for a block that names the pairing that way.

  The fixtures took their share of the miss. The host tests replayed a result
  block of their own invention — `tool_result` carrying `callId`, a shape the
  Harness never writes and its validator would reject — so an empty bundle looked
  like a passing suite. They now carry the shape a session actually stores, and a
  test pins collection to it, with one more for the fallback name so it stays a
  supported path rather than a guess.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.4.0

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.12.0 (2026-09-23)

### 🚀 Features

- Documentation search answers from the corpus's documents, and a stand can name ([1e04cad](https://github.com/xarleyn/dsh-plugins/commit/1e04cad))
  the edition it is about.

  A published corpus carries its own working material beside its documents — the
  asset tree, the inventories, the triage notes — under leading underscores, and
  `docs_search` read that material first: `_` sorts before letters, so an
  inventory that names every module and version the corpus has answered the
  question and spent the hit budget before a document was opened. On the stand's
  own tree a path-less search reported no matches at all for a term 24 documents
  contain, because the walk counted its way through thousands of images first and
  stopped. The walk now visits documented modules before loose files and the
  corpus's own material last, decides the queue by path rather than by when a
  directory was met, recognises media, archives and office binaries by extension
  without reading them, and counts neither them nor out-of-scope files against
  its document budget. A search that finds nothing now says so having read the
  corpus.

  The two facets a filtered search answers under — `version` and `module` — were
  returned at the root of the result but were not declared in the tool's output
  schema, and the registry refuses an undeclared property: every call that used
  the filters failed with "returned invalid output" after doing the work, which is
  exactly the call the facets exist for. Both are declared now.

  `tools.docsDefaultVersion` and `tools.docsDefaultVersionEnabled` name one
  edition as the stand's: a search that named neither `version` nor `path` stays
  inside it, the answer says the stand narrowed it rather than the model, and a
  call that asked for another edition or another subtree still decides for itself.
  The settings card gains a "Документация" section with the switch, the version
  and the effective corpus root, so an operator sees which edition the stand's
  answers come from and where the corpus actually is.

  Changing the corpus root or default edition now affects already running QA
  tools instead of waiting for a plugin restart. A configured root may have any
  directory name while tool paths remain the stable `docs/...` spelling;
  uppercase `V2` editions match `v2`, excluded editions are pruned before they can
  spend the walk budget, and an explicit path is no longer described as the
  stand's default edition.

  The first message of a newly created chat no longer disappears. Claiming the
  new session updates chat ownership, but that list update no longer reloads
  account access and disposes the session controller between admission and the
  prompt. The optimistic question stays visible throughout the handoff. Removing
  a chat from the browser history now opens an accessible confirmation that says
  the conversation remains on the stand, with explicit cancel and delete actions.

  Role-bound chats only receive tools declared by their role or explicitly
  granted through its policy; attaching a dynamic catalog to an agent no longer
  silently expands a role's tool ceiling. Integration request timeouts are also
  bounded by the largest duration Node can schedule faithfully, so an overflowing
  value cannot turn into an immediate timer.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.11.2 (2026-09-22)

### 🩹 Fixes

- A tool the plugin attaches to the chat is callable in a role-bound chat. ([90897c6](https://github.com/xarleyn/dsh-plugins/commit/90897c6))

  The QA tool catalogue — the documentation readers, the workspace-fenced delete,
  the activation diagnostic — is registered on the agent itself, so no role list
  carries it and no scoped restriction can name it. Two layers decide whether a
  call to it runs, and in a chat that attests a role only one of them knew it: the
  grants admit a catalogue tool for as long as the policy holds, while the
  conversation ceiling was built from the deployment's pinned list, the role's own
  tools and its grantable reach. A catalogue tool therefore sat inside the chat
  and outside the ceiling, and every call to it was refused as "outside the
  capability profile of this conversation" — a refusal that names a profile the
  caller cannot see the gap in, on a deployment that attaches the catalogue at
  session start.

  The ceiling now includes the catalogue names the plugin attaches, exactly as the
  account-free path already did, and the profile guard reads them from the calling
  agent's own catalogue in a role-bound chat too. What the catalogue did not
  attach is unchanged: it stays the role's to allow, and a refusal there still
  names the execution profile.

- The documentation readers reach a corpus that is not inside every chat. ([24e150c](https://github.com/xarleyn/dsh-plugins/commit/24e150c))

  `docs_search` and `docs_read` resolved `<calling chat's cwd>/docs` and nothing
  else. In a deployment with per-user workspaces that cwd is the account's own
  directory, so the corpus published once — the stand's `/workspace/docs` — was
  outside the tree the tools looked in, and every chat and every expert got "this
  chat's workspace has no docs/ directory" from a tool that was working exactly as
  written. The file tools reached the same corpus all along, by absolute path,
  which is why the personas name it; the readers had no way to be pointed at it.

  `tools.docsRoot` names that root. Empty keeps the per-chat layout unchanged;
  an absolute path makes the documentation tree the configured one, with the
  same reporting (`docs/<module>/<version>/…`), the same canonicalization and the
  same fence: a root that is missing, not absolute, a file or a link is refused
  with a message that names it, and a path that leaves the tree through a
  symbolic link is refused as before. The tool descriptions say which of the two
  layouts is in force, so the model is told where the documentation is rather than
  left to guess.

- A `/qa` entry that raced the start of the process stops dead-ending at the ([7ecfe39](https://github.com/xarleyn/dsh-plugins/commit/7ecfe39))
  token screen.

  The route sends a browser without the host cookie through the host's one-time
  `?token=` exchange, so the cookie is installed before the root gate sees the
  request; without a token it falls back to the marker hand-off, which a
  cookie-less browser cannot pass. That token was resolved lazily but remembered
  *forever*, including the answer "not available": the first `/qa` request can
  arrive while `connection` is not answerable yet, and from then on every such
  browser went to the marker hand-off and saw the access-denied screen until the
  process restarted — a boot-order race that looked random from the outside.

  A resolved token is still cached (it is stable for the process), while a
  failure is reported once per reason and retried on the next navigation, so a
  single early answer can no longer disable the exchange for the whole run.

- An integration may wait as long as its operator allows. ([f35a6de](https://github.com/xarleyn/dsh-plugins/commit/f35a6de))

  `integration.requestTimeoutMs` was validated inside a fixed window whose ceiling
  was ten minutes, and that ceiling was not a budget the deployment spends: nothing
  in the plugin pays for a longer wait. It only cut off the questions an
  integration exists for — a long analysis came back as an escalation while its
  answer was still being written. The floor stays (five seconds: a shorter wait is
  not a wait), the ceiling is gone, and the refusal message says so. A deployment
  that wants thirty minutes now writes `requestTimeoutMs: 1800000` and gets
  thirty minutes.

- The slash palette captions each group once instead of once per run of rows. ([ff614f2](https://github.com/xarleyn/dsh-plugins/commit/ff614f2))

  Ranking is global across the two halves of the catalog, so one query can put a
  command between two skills — and the palette, which draws a titled group per
  kind, drew «Навыки» again after the command. One group read as two, and the
  second header said nothing about the rows under it.

  The grouped order is now the order the palette draws, and it is the order the
  keyboard walks: the rows of a kind stand together, the group holding the
  best-ranked row leads, and each group keeps the ranking's order inside it. The
  first row of the list — the one Enter picks — is therefore still the best match,
  which is why the group order follows the ranking rather than a fixed
  skills-then-commands rule.

  `palette-rows.ts` holds that translation as a pure function, so the hook, the
  component and the tests share one definition of what a group is.

- A source the answer just cited opens on the first click again. ([47d7cd6](https://github.com/xarleyn/dsh-plugins/commit/47d7cd6))

  The rail projects a turn's sources from the durable tool results, and the Host
  records the same results as the evidence the source preview checks a request
  against — but the two anchored the recorded path on different directories: the
  projection used the deployment's configured `session.cwd`, while the Host
  canonicalizes every recorded path against the chat's own cwd. While those name
  the same directory the two agree, and a request spelled one way is re-anchored
  on the way in. The moment they differ — an adopted chat, a chat whose cwd was
  pinned under an older configuration, a per-account directory below the
  configured workspace — one file gained two spellings, and the rail offered the
  one the Host does not hold: the detailed view then answered that the source was
  no longer evidence of the chat, although the answer had just cited it, and the
  same source opened after a page reload, when the rail was rebuilt from the
  Host's own bundles.

  The projection now anchors on the chat's own cwd, the directory the evidence
  itself is recorded against, and keeps the configured pin only as the fallback
  for a chat the browser's list does not carry yet. The refusal is unchanged
  where it is honest: a path this chat's own record does not carry is still
  refused as not-evidence.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.5.1
- Updated @yadsh/dsh-audit-ui to 0.1.1

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.11.1 (2026-09-22)

### 🩹 Fixes

- An attachment the deployment refuses is answered as the caller's 415, not a 503. ([82458e1](https://github.com/xarleyn/dsh-plugins/commit/82458e1))

  The integration API shipped in 0.11.0 with the rule that a file the Host cannot
  read refuses the whole question with `415` — the bridge's own fallback signal,
  which makes it repeat the question without attachments instead of publishing an
  answer whose material never reached the model. One class of refusal escaped that
  rule: the last ones happen in the Harness, past this plugin's reach, and the
  session controller folds every one of them — an image over the Host's byte,
  pixel or dimension budget, bytes that are not the type the caller declared, and
  an image at all on a model route that cannot see one — into a single Remote
  failure, `session/attachment-invalid`. The service knew only its own refusal
  vocabulary, so those fell through to its catch-all and became `503 unavailable`.

  The consequence was not cosmetic. A `5xx` is what the bridge retries, so a ticket
  whose screenshot the deployment's model cannot see was retried forever, and the
  question never got an answer. A deployment whose model route declares no image
  input — which is the common shape for a self-hosted text model — hit this with
  every attachment of that kind.

  The Harness's refusal is now read structurally and mapped onto the same `415`,
  with its reason code (`MODEL_DOES_NOT_SUPPORT_IMAGES`, `IMAGE_TOO_LARGE`,
  `IMAGE_TYPE_MISMATCH`, …) in the response body and in the Host log under
  `integration.attachment-refused`. A refusal this plugin raises itself keeps using
  that same log event, so one line covers both halves. A failure that is not the
  caller's to correct — a session that cannot be opened, a model that refuses the
  turn — stays `503`, because that one is worth retrying.

  Two smaller losses in the same path are fixed with it. A Host whose temporary
  directory cannot be created for a document extraction now answers the caller's
  `415` with the reason in the log rather than an opaque `503`. And the multipart
  reader reads the RFC 5987 `filename*` parameter, where a non-ASCII file name
  arrives: without it the part had no plain `filename`, so it was read as a text
  field and the attachment silently vanished from a question that was then
  answered without it. A part with no header separator is refused as
  `invalid-request` instead of being skipped, for the same reason.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.11.0 (2026-09-22)

### 🚀 Features

- Skill files became something an administrator can edit, and a person can tell ([f8a98ac](https://github.com/xarleyn/dsh-plugins/commit/f8a98ac))
  when theirs was edited by somebody else.

  The console gained a "Редактор навыков" section. It writes the deployment's own
  shared skills — a store that sits beside the registered workspace, is offered
  to the model by the same discovery provider as a personal one, and is labelled
  `qa-shared` so a loaded skill names where it came from — and it writes the
  personal skills of any account, chosen from the account directory. Neither is a
  second editor: every call goes through the storage service the owner's own
  settings page uses, so path checks, draft validation, revision conflicts,
  trash-on-remove and catalog invalidation are the same code, and a shared skill
  ranks between a personal one and the checkout's own layers (60 against the
  personal layer's 50 and the project layer's 100).

  Editing somebody else's file is a write on their behalf, so it is not silent.
  Each administrator write leaves a mark beside the skills it describes
  (`.admin-edits.json`, a dot entry no skill enumeration can mistake for a skill),
  keyed by directory name and carrying the revision it produced, and the owner's
  catalog shows "Изменено администратором" with the date while the stored bytes
  are still the administrator's. The owner's own save clears it, because the
  question the mark answers is "did an administrator write what I am looking at",
  not "was this file ever touched". Renaming a skill moves the mark with it;
  removing one drops it.

  Authorization is its own permission, `skills.manage`, held by the admin role and
  deliberately separate from `settings.manage` so a future curator role can hold
  one without the other. Every write appends an audit row (`skill.created`,
  `skill.updated`, `skill.deleted`) naming the actor, the skill, the store and the
  account it belongs to, with before and after images that carry the revision and
  the description but never the body: the trail records who changed which
  instructions, not a second copy of a person's instructions.

- A QA chat can read the stand's documentation on purpose instead of guessing at it. ([a759fab](https://github.com/xarleyn/dsh-plugins/commit/a759fab))

  Documentation was never a surface of its own: a reviewer would cite a path in
  the chat's own `docs/` tree and the model had no tool that said where that tree
  is, so it swept the workspace with globs, asked memory instead, and read a miss
  as "the document does not exist" rather than "wrong tree". The catalog now
  ships `docs_search` and `docs_read` (catalog version 3), both read-only and
  both pointing at `<chat workspace>/docs`.

  `docs_search` matches a phrase inside single lines and reports every hit with
  its path, its line number and the module and version parsed out of the layout
  `docs/<module>/<version>/…`; `version`, `module` and `path` narrow a search to
  one edition, one module or one subtree, so a chat that was told "3.8" stops
  sweeping every edition. `docs_read` opens one file at a bounded window of
  lines, and both tools bound what they return — `limit` and a byte budget on the
  reported hits, a line budget on a read — and say so when they truncate, which
  keeps a "right search" from answering with a wall of text.

  The fence is the same one the rest of the plugin uses. Only files inside the
  documentation tree are read; a path outside it, a path that leaves it through a
  symbolic link, a directory handed to a read, a binary file and a workspace
  whose `docs/` is missing, a file or a link are refused with an explicit reason
  that names neither an absolute host path nor anything outside the tree. Files
  the walk merely meets and cannot read are skipped rather than failing the
  search, and an explicitly named path still gets the honest refusal.

  The tool descriptions do the routing the catalog exists for: they state that
  documentation lives in `docs/` and is looked up with these tools rather than
  from memory, so the instruction travels with the schema the model is actually
  given.

- A question can be asked over HTTP, with an integration token instead of a browser. ([62e1533](https://github.com/xarleyn/dsh-plugins/commit/62e1533))

  The surface could only be used by a person in a browser: the account credential
  is an HMAC token minted at login, every action is a DSH remote call from the
  client bundle, and there was no long-lived credential and no HTTP endpoint for
  another application at all. A ticket system integration therefore had nowhere to
  send its questions.

  The deployment can now serve `POST {integration.basePath}/ask`,
  `GET {integration.basePath}/session` and `GET {integration.basePath}/health`
  (off by default, `/qa/api` when switched on).
  `/ask` takes the same request the bridge already sends — `application/json`, or
  `multipart/form-data` with the ticket's attachments: an image rides the prompt
  inline, a text file is decoded, and a PDF or Office document is extracted to
  Markdown through the deployment's own document pipeline, so the question is
  answered with the attachment in hand. A file the Host cannot read refuses the
  request with `415`, which is the fallback the bridge implements — it repeats the
  question without attachments rather than receiving an answer nobody could base
  on the material. Nothing is stored: the bytes live in a temporary directory for
  one extraction, and the inlined text is bounded. It answers with
  `chat_id`, a Markdown `answer`, `sources`, `confidence`, `escalate` and `reason`,
  within a configurable budget (90 seconds by default, and `maxAnswerCharacters`
  for the answer the ticket comment can hold — an over-long answer is cut at a
  paragraph break and marked, not silently truncated by the ticket system).
  Passing the returned `chat_id` back as `session_id` continues the same
  conversation.

  The account issues that credential itself, in a «Интеграционные токены» section
  of the `Настройки` dialog: it lists its own tokens with their scopes, expiry and
  last use, mints one (the secret is shown once and is never recoverable), and
  revokes one with a confirming click. Minting is offered only while the endpoint
  is switched on, while revoking keeps working either way, and the token always
  belongs to the account that asked — one account never sees another's tokens.

  Requests authenticate with an integration token, a second credential that is
  deliberately not the browser token: it survives a password change, it carries
  scopes, it expires on its own schedule, it is stored only as a SHA-256 digest,
  and it is revoked on its own (`qa-accounts token create|list|revoke`) without
  touching anybody's browser session. An account that is disabled, and the
  operator's `revoke <email>` leak response, do stop it.

  The conversation can be read back too: `GET {basePath}/session?chat_id=…`
  returns the prompts and answers of a chat the token's account owns, in the same
  words the answer carries them, page by page from a cursor the caller keeps
  (`after`, `limit` up to 200, `truncated` when older messages stayed below the
  window). This is what the `sessions:read` scope is for — a bridge whose question
  was escalated can show the specialist what was already said instead of spending
  a turn to ask it again, and a read-only integration can be granted that scope
  without the right to spend inference. Injected context, reasoning and tool
  traffic are never published: they are model input the caller did not write.
  Ownership is the rule `ask` already applies, so an unknown chat id and another
  account's chat answer one `404`. Reading stays cheap on a long conversation: the
  newest messages are kept warm and a chat this Host holds is checked against its
  own memory, so a page costs neither a stored read nor a walk through the history
  behind it — a page of a ten-thousand-message chat is a page.

  The endpoints run questions through the same admission path as the browser —
  deployment preflight, the per-user workspace, the capability snapshot, the QA
  tool policy and the attestation record — so an external caller cannot reach a
  chat composition a person could not open, and it can only ever continue chats
  owned by the account its token belongs to.

- A user can change their own password, and a forgotten one has a way back in. ([66eec35](https://github.com/xarleyn/dsh-plugins/commit/66eec35))

  The store already had everything an operator needs — `setPassword` with its
  token-version bump, `validatePassword`, the sign-in rate limit — but nothing
  reached the person who owns the account. Somebody who suspected a leaked
  password had no action to take, and somebody who had forgotten one had no path
  at all: the only way back in was an operator with shell access running
  `qa-accounts set-password`.

  `changePassword(token, current, next)` is the self-service half. It verifies the
  current password, applies the same strength gate as registration, and bumps the
  token version — which signs every *other* browser out, the point of a change
  after a leak — then answers with a freshly minted token, so the browser that
  made the change is not signed out by its own write. `accountsChangePassword` is
  its Remote, and the settings dialog gains a "Пароль" section: current, new, and
  the repeat that catches a typo in a field that cannot be read back later.

  A forgotten password has no mail transport on this stand, so the way back is a
  request an operator answers. `requestPasswordReset(email)` is deliberately
  indifferent: a known address, an unknown one and a disabled account all take the
  same path out, and the attempt spends the same authentication budget as a
  sign-in — so the screen can be used neither to learn which accounts exist nor to
  flood an operator's queue. Real requests land in a new `qa_password_resets`
  table (schema migration 2), one row per account with a repeat count, and the
  sign-in card grows the "Забыли пароль?" path that says the same thing to
  everybody. A change made by the account-holder clears their own pending row,
  because it answers the request.

  The operator reads that queue in the admin console's "Пользователи" page and
  answers it there: `adminPasswordResetRequests` (users.read) lists it,
  `adminResetPassword` (users.manage) sets the new password, drops the row and
  writes a `user.password-reset` audit event. The queue renders only while
  somebody is waiting — a permanently empty panel teaches operators to ignore it,
  and this one has to be noticed, because a reset ends every session of that
  account and the new password must be handed over deliberately.

- The QA prompt gains a note saying which source owns the question. ([025e2b4](https://github.com/xarleyn/dsh-plugins/commit/025e2b4))

  `notes` carried three ambient notes — who the user is, the rules about source
  provenance, how to label delegations — and none of them said where an answer
  belongs. The memory plugin's skill says so for the model that reads it, but a QA
  persona registers with `complete: true`, the persona is the whole system prompt,
  and a skill is read only once the model decides to reach for it; on a stand
  where the model went to memory instead, nothing told it otherwise.

  The new `notes.sourcePriority` note is the deployment's version of that rule,
  and a new editable surface beside the three the `notes` block already had:
  read what the conversation and its attachments already carry, then the product
  documentation and the domain expert, and only then memory — with the two
  consequences the failure needed spelled out, that a miss in memory is not
  evidence that no source exists, and that memory is not where a document, a page
  or a product fact is looked up. It is on by default beside the other notes, can
  be muted or reworded on its own from the «Заметки модели» section of the
  settings card, and reaches attested chats and their delegated children only, on
  the same gate as the provenance and delegation notes. A stand with no memory
  plugin keeps it harmlessly: the note names sources the model does not have.


### 🩹 Fixes

- An attached document becomes readable input for the document pipeline (#174). ([e86ee49](https://github.com/xarleyn/dsh-plugins/commit/e86ee49))

  The QA read fence has exactly one deliberate exemption: a single-file read of
  the mounted attachment store, which sits outside every workspace by design and
  whose stored path the prompt hands the model. The document pipeline keeps its
  own read scope — session workspace, artifact root, and the roots configuration
  names — and knew nothing about that store, so `document_inspect`,
  `document_to_markdown` and `document_convert` refused the very file the model
  had just been allowed to read, and the files panel's Word preview hit the same
  wall. Naming the store in `documents.storage.allowedInputRoots` would have
  closed the gap by configuration alone, at the price of two settings that must
  stay in sync and a fence nobody owns.

  The scope now carries the roots a *caller* grants for one call:
  `DocumentScope.extraInputRoots` is canonicalized like every other root and
  appended to `allowedInputRoots`, so it adds readable roots without touching the
  artifact root writes go through. The published `documents` face gains
  `registerInputRoots(sessionId, roots)` for the plugin that owns a session's read
  fence, and qa-surface uses it: the admission that installs the per-user
  workspace fence grants the attachment root for the session it just attested, a
  delegated child inherits the grant the way it inherits the fence, and
  `agent/disposed` plus `dispose()` revoke it. The files panel passes the same
  root inline on the conversion it starts, because its own read policy is what
  accepted the file.

  A grant stays as narrow as the exemption it mirrors: resolution still reads
  exactly one named file, so a shared store can never be walked, and symlinks that
  leave a granted root, directories, and paths outside every root are refused
  exactly as before.

- Attachments take the documents the stand can read, not only text files. ([6e89147](https://github.com/xarleyn/dsh-plugins/commit/6e89147))

  `attachments.extensions` was a list of *text* extensions in every sense: the
  constant, the normalizer, the settings label and the refusal copy all said so.
  A deployment whose document pipeline reads Word and PDF therefore still refused
  a `.docx` at the composer, with a message that named a fixed set ("md, txt, log
  и другие") which had nothing to do with its own configuration — the visitor
  could see the stand render that very document in the files panel while being
  unable to hand one over.

  The list is now what its name implies. Accepted extensions are the files the
  stand can work with, `docx` and `pdf` join the text files in the default set, a
  refusal names the extension it refused and says the operator owns the list, and
  the settings card calls the pair what they are ("Файловые вложения" and
  "Разрешённые расширения файлов"). A deployment that pins its own list keeps it
  exactly as written, which is why the operator-facing wording matters: an empty
  or text-only list is now visibly a narrowing rather than the only shape the
  setting can take.

- The prompt gains a note that sends an attached office document to the document ([ab4605e](https://github.com/xarleyn/dsh-plugins/commit/ab4605e))
  pipeline instead of the plain file reader.

  A chat user's `.docx` arrives as a path into the attachment store, and a run
  that reads it with the plain file reader gets `cannot read "…docx": binary
  file`. That answer is a fact about the format, not about the file being absent,
  but nothing said so: in the session this comes from the agent read the refusal
  as "the file isn't in the workspace", went looking for the document it had
  already been handed, and opened the next turn by announcing that it could not
  reach the file at all. The pipeline it should have used — `document_inspect`,
  `document_to_markdown`, and `document_from_url` for an attachment that only
  exists behind a URL — was available the whole time.

  `notes.documents` is that rule in the deployment's own words, on by default
  beside the other notes, muteable and rewordable from the «Заметки модели»
  section of the settings card, and delivered on the same gate as the provenance
  and delegation notes. It says which reader a DOCX or PDF belongs to, that the
  plain reader's refusal for those formats is expected rather than a hint to
  search elsewhere, and that a refusal from the pipeline itself is a report to
  make — with the path it named — rather than a reason to try a third reader.

  This is the last third of the routing the QA stand was missing: it is the only
  note whose subject is another plugin's tools, so a deployment with no document
  pipeline can mute it, and the note is advisory like every other — the
  lockdown, the tool allow-list and the sandbox hold whatever the conversation
  says.

- The chat list is the account's own, and a chat opened after login appears at ([071abce](https://github.com/xarleyn/dsh-plugins/commit/071abce))
  once.

  With accounts on, `QaSessionController.chatIds()` unioned the server's owned
  list with the browser-local chat index. The index is what a browser
  accumulated, not an identity: on a shared browser it still holds the chats the
  previous visitor started, and every one of them was listed — title, timestamp,
  running spinner, audit badge — beside the account's own. An account whose owned
  list was still empty listed the index alone, so the fresh sign-in saw someone
  else's chats and their live activity. The union also carried the case it was
  there for: a chat created after login is claimed on the Host but was never
  added to the owned list, so it stayed listed only through the index.

  The owned list is now the list. `claimNewSession` records the claimed id in the
  snapshot, so a chat created or reopened under the account enters it without a
  reload (a claim the Host answers with a conflict stays out; a claim that never
  reached the Host still enters, because the binding already passed the
  attendance boundary, which claims an unowned chat for whoever asks first and
  refuses another account's). Deployments without accounts are unchanged: the
  index is the list, as before.

  `subagentNames()` read the deployment-wide session list — every chat's
  delegations, catalogs included — to sign settlement notices. It now reads only
  the chats this page lists: `visibleSubagentCandidates` resolves a delegated
  session to the chat it belongs to through its parent chain (`chatRootOf`, so a
  nested child is not mistaken for a chat of its own) and keeps children of the
  visible chats alone.

  Verification: `pnpm nx test dsh-qa-surface` (1253 tests, 185 files),
  `pnpm nx run dsh-qa-surface:typecheck`, `pnpm nx run dsh-qa-surface:lint`.
  `tests/session-chat-ownership.test.ts` fails against the previous `chatIds()`
  on both list cases; `tests/accounts-controller-actions.test.ts` covers the
  claim path.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-documents to 0.5.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

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
