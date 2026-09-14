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
