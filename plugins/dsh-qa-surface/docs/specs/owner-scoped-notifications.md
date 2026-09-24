# SPEC / PLAN — Owner-scoped turn-completion notifications

**Status:** draft (investigation + design record; no implementation yet).
**Target:** `@yadsh/dsh-qa-surface`.
**Tracker:** issue #306 «Замена плагина dsh-notification».
**Primary goal:** let a chat's owner learn that a turn has ended, without the
rest of the deployment learning it too. The external host plugin
`@yadsh/dsh-notification` broadcasts a turn-completion notice to every
browser; that is both a leak-shaped surface and the wrong UX. Fold the
capability into the QA surface, which already holds the account, the session
ownership map and the per-session running edge.

---

## 1. Problem

The deployment today uses `@yadsh/dsh-notification` for
"your turn has finished" notices. The plugin subscribes to the host's
agent-turn lifecycle and, on completion, produces a notification for
every connected user — not only the user whose chat ended. Two
consequences:

- **Cross-account chatter.** Alice gets a toast when Bob's turn settles.
  On a LAN stand with several QA accounts, every user sees every other
  user's activity. Nothing about the payload needs to be sensitive for
  the fact to be sensitive: "Bob just stopped" is itself information
  about Bob.
- **Wrong scope to configure.** Because the source is deployment-wide,
  the only user-facing choice is "on" or "off". There is no per-account
  preference, no per-chat mute, and no way to keep the notification for
  my own chats while suppressing it for a shared workspace.

The plugin is external. Inside this repository `@yadsh/dsh-notification`
exists only as an illustrative name in `SPEC.md:122` and `SPEC.md:487`;
it is not enabled here and this design does not remove it. It replaces
the need for it.

## 2. Facts already on the table

The investigation is the argument for doing this inside `dsh-qa-surface`
rather than upstream. Everything the notifier needs is already present.

### 2.1 The running→ready edge is per-bound-session

`plugins/dsh-qa-surface/src/client/project-session-state.ts:68-77`
derives `phase` from `snapshot.running`. `QaSessionController.ts:1263-1274`
subscribes to *this browser's* bound session and to *this browser's*
conversation target. The completion edge therefore fires only on the
browser that holds the session, not on any other. The rest of this
proposal is the last mile: what to do with that edge, and how to also
catch the turns that are running in chats this browser is not bound
to right now.

### 2.2 Session → owner is a server-authoritative fact

`plugins/dsh-qa-surface/src/accounts/store.ts:431-497` refuses
`session-owned-elsewhere`; `:1427 ownerIdOf(sessionId)` answers
`sessionId → userId`; `:1455 accountById(userId)` answers
`userId → QaAccountUserPublic`. The client already keeps
`snapshot.ownedIds` (see `QaAccountsController.ts:161-170`) and
`snapshot.ownership` for admin views (`:644-680`). No new identity
plumbing is required.

### 2.3 The leak class is documented

`QaSessionController.ts:1489-1510` — the comment is explicit that the
host list is deployment-wide and that every consumer must intersect
with `visibleChatIds()`. The subagent naming is the reference
implementation. A notification source is a second consumer with the
identical obligation, and the identical remedy.

### 2.4 A user preferences surface already exists

`plugins/dsh-qa-surface/src/client/user-settings/` holds `ProfileSettingsPage`,
`StartersSettingsPage`, `PasswordSettingsPage`, `SkillsSettingsPage`,
`IntegrationTokensPage`, all mounted inside `UserSettingsDialog`.
`QaAccountStarters` (`types.ts:377-387`) is exactly the shape a
notification preference should have: stored server-side on the account,
editable by the owner, never reaching the agent prompt.
`GeneralSettingsPage.tsx:41-46` reserves a "Скоро здесь" list with
«Настройки уведомлений» on it — the placeholder names this work.

### 2.5 There is no push channel host→specific browser

Typert remotes are request/response
(`plugins/dsh-qa-surface/src/index.ts:184` — `QaSurface extends TypertRemoteService`);
`@Remote` never sees the HTTP request
(`docs/specs/accounts.md §Wire design`). Host→client reach exists only
via cordis bus events, and every relevant listener already runs with
`{ global: true }` (see `src/provenance/host-store.ts:125-150`, and
`agent/turn-stopping` at `:139-141`). Consequence: any design that
"pushes from the host to the owner's browser" needs either a new
transport or a client-side filter on a broadcast that is already
there. This proposal keeps the browser-side filter as the primary
mechanism, and lists the alternatives in §6.

### 2.6 There is no user-facing notification API today

Grep across the plugin returns zero uses of `new Notification`,
`navigator.vibrate`, `document.title`, `BroadcastChannel`, or an
in-app toast primitive. Everything is on the floor.

## 3. Design

### 3.1 What a "turn completed" is, precisely

Define the event once, on the client, from state the client already
has:

- Fires on the transition `phase: "running" → "ready"` **for a chat the
  client has ever bound or listed** — that is, an id in
  `chatIds()` — and where the previous running snapshot had
  `running === true` **and** the client saw the turn start
  (`pendingSubmission?.sawRunning` at `QaSessionController.ts:1440-1457`
  is the precedent). A chat that never ran in this browser is not a
  completed turn; a chat that started before the tab opened is not
  attributed to this user.
- Does **not** fire on reconnect (`phase: "reconnecting"`), on error
  (`phase: "error"`), on unmount, or on `chatIds()` shrinking. The
  edge must be a real `true → false`, not a phase rewrite by an
  unrelated input.

Two delivery scopes, and the difference matters:

- **Bound chat.** The chat the composer is showing right now. This is
  what `snapshot.running` already tracks. Notification fires if the
  browser tab is hidden or unfocused, and optionally if it is
  visible but idle past a threshold.
- **Non-bound owned chat.** Any other chat in `ownedIds()` that is
  currently running. Today the sidebar renders a `running` dot per row
  (`QaSidebar.tsx:16,47`) from `summary.running`; the completion edge
  is derivable by watching that same field. The user should also be
  notified when a background chat finishes, otherwise the visible
  signal is only "the sidebar stopped spinning".

The controller owns both observations. The bound-chat case lives inside
`QaSessionController`; the sidebar case lives in a small peer that
projects `running` per owned chat from the same host list, keyed on
`chatIds()`, and diffs `true → false`. Both peers feed one notifier.

### 3.2 Ownership filter, done twice, cheaply

Every consumer of the host's session state filters before it renders.
The same rule applies here and it is not optional:

- Client-side: intersect the source of turns against
  `visibleChatIds()` before firing (`QaSessionController.ts:1519-1526`).
  Anonymous deployments (`accounts === undefined`, so
  `visibleChatIds()` returns `undefined`) fall back to the browser's
  own `chats.chatIds()` index — never to the host list. The rule is
  "a notification can only fire for a chat this browser would render
  in the sidebar".
- Server-side: when accounts are enabled, the notifier's payload is
  produced locally from data the browser already received; no new
  remote call is added. If a later iteration introduces a host-pushed
  channel (§6.2, §6.3), the server must resolve
  `ownerIdOf(sessionId)` and target only that account's open
  connection — the browser's filter is defence in depth, not the
  boundary.

The admin "showOtherUsersChats" case
(`QaAccountsController.ts:644-680`) is treated as a *read* permission
only: it does not silently widen the notification scope. A separate
admin preference gates whether other users' completions produce
notifications, and it defaults to off.

### 3.3 Delivery channels

The client picks channels per preference and per environment; the
decision is local (nothing about it needs the network).

1. **In-app toast** — a small surface inside `QaSurface` that renders
   the chat title and "готово". Always available; the safe default.
2. **Web Notification API** (`new Notification(title, options)` with
   `Notification.requestPermission()`) — for a hidden or unfocused
   tab. Gated on: (a) `window.Notification` exists; (b) permission is
   `granted`; (c) the user preference enables it. On denial or
   absence, fall back silently to the toast. Never re-prompt per turn.
3. **Tab title flash** — a prefix like `(1) …` while hidden. Optional;
   low risk; easy to turn off.
4. **Sound** — a short audio buffer. Off by default; opt-in.
5. **Sidebar dot already exists** — it is not new work; the toast and
   the OS notification reference it so a user can find the chat.

Do not use `navigator.vibrate` (permission model has changed on the
mobile web; no signal it is needed here). Do not add a badge
counter — the badge is per-origin and does not compose with the
harness.

### 3.4 Payload content

Only information the owner already sees in the sidebar:

- Chat display title (already client-side).
- Time of completion.
- A reason: "готово" | "остановлено" | "ошибка" — derived from the
  final `phase`. Never "the model said X" — the OS notification body
  is written to disk by the browser and is visible over shoulders.
- Never: message text, tool arguments, file paths, workspace, cwd,
  account email, session id.

A click on the toast or OS notification focuses the tab and calls the
existing `setActiveSession(chatId)`; it does not re-project anything
sensitive into the OS.

### 3.5 Preference shape

Mirror the shape of `QaAccountStarters` (`types.ts:377-387`):

```ts
export interface QaAccountNotifications {
  /** Fire for the chat currently bound to the composer. */
  readonly boundChat: boolean;
  /** Fire for the owner's other running chats as they settle. */
  readonly backgroundChats: boolean;
  /** Also raise the OS notification when the tab is hidden or
   *  unfocused; requires Notification permission and is silently
   *  skipped otherwise. */
  readonly osWhenHidden: boolean;
  /** Play a short sound. */
  readonly sound: boolean;
  /** Prefix the tab title with an unread count while hidden. */
  readonly titleBadge: boolean;
}
```

Stored server-side on the account next to `profile` and `starters`, so
a user's choices follow them across browsers. The remote surface:

- `accountsUpdateNotifications(token, input)` — full-replace, matching
  the existing profile write at `QaAccountsController.ts:378`.
- The value reaches the browser inside the `accountsWhoami` snapshot
  and the login/register return, alongside `user.profile` and
  `user.starters`. No separate round-trip.
- Client fallback when accounts are disabled
  (`config.accounts.enabled === false`): a `localStorage` copy under
  the same namespace as `qaStorageNamespace` (see
  `QaAccountsController.ts:708-710`). The single-user deployment
  still gets a mute switch.

Host-wide defaults, in `config.notifications`:

- `enabled: boolean` — a deployment kill switch. When false, no
  account preference can raise a notification (the setting becomes
  read-only in the user dialog). This is the admin answer to a stand
  where a user's laptop is shared.
- `defaultOs: "allow" | "deny"` — the value the first login starts
  with.
- `defaultSound: "allow" | "deny"` — same.
- `allowAdminCrossUser: boolean` — see §3.2; default false.

The plugin's existing config validator (`src/config.ts:279-296`, the
`accounts` block) is the shape to follow.

### 3.6 Where the code lives

- `src/client/notifications/` (new): a small module set —
  - `turn-completion-source.ts` — observes the bound chat's
    `phase: running → ready` edge; owns the "saw running" gate; emits
    an event carrying `{ sessionId, phase, at }`.
  - `background-completion-source.ts` — observes
    `chatIds() × summary.running` and emits the same event shape when
    a non-bound owned chat flips.
  - `notification-dispatcher.ts` — consumes events, applies the
    preference and channel selection, calls the toast and the Web
    Notification API.
  - `preferences.ts` — resolves account preference and host config
    into the effective boolean set.
- `src/client/components/QaTurnNotice.tsx` — the toast, styled with
  the plugin's existing `--dsw-alias-*` tokens (AGENTS.md §Plugin
  configuration card UI — the same BEM shell does not apply here; the
  toast is not a settings card, but it must not hard-code colours).
- `src/client/user-settings/NotificationSettingsPage.tsx` — the
  per-account form, mounted into `UserSettingsDialog` and promoted
  from «Скоро здесь» in `GeneralSettingsPage.tsx:41-46`.
- Server side: `accounts/store.ts` and `accounts/file.ts` gain a
  `notifications` field on the stored user, alongside `profile` and
  `starters`; `index.ts` gains one `@Remote` method; the whoami
  result and the login/register return carry it.

## 4. Non-goals

- This spec does not implement, remove or configure `dsh-notification`.
  Deployment-side removal is a separate operational change and is not
  a code change here.
- No mobile push, no e-mail, no webhook. If Bob is offline, Bob does
  not get a notice; this is a "you were watching" affordance, not an
  inbox.
- No message-level routing ("notify only when the model needs input",
  "notify on cost overrun"). These need a completion classification
  that does not exist yet; the phase-edge primitive this spec ships
  is compatible with them later.
- No notification for another account's activity, including for
  admins, without an explicit opt-in (both sides: a preference on the
  admin and a config allowance on the deployment).
- No keyboard shortcut, no system tray, no OS-level badge beyond the
  Web Notification API.

## 5. Rollout plan

The design fits the plugin's existing feature-gating pattern.

**Phase 1 — In-app, own chat only.** Ship
`turn-completion-source.ts` and the in-app toast; no Web
Notification, no sound. Default on; no per-account preference yet.
Test: `QaSessionController` already has the edge; the new tests
observe the toast on the transition and its absence on reconnect,
error, and admin-visible foreign chats.

**Phase 2 — Background chats.** Ship
`background-completion-source.ts`. The observable set is
`chatIds() \ { boundId }`. The diff must be debounced against the
`chatsRevision` and must not fire during the initial projection of an
already-running set. Test the cold-start case explicitly.

**Phase 3 — OS notifications + preference form.** Add
`NotificationSettingsPage`, the `QaAccountNotifications` block, the
`accountsUpdateNotifications` remote, and the `osWhenHidden` channel
in the dispatcher. Gate Web Notification permission requests on the
user pressing "Включить" in the settings page — never automatically
on load, and never per turn.

**Phase 4 — Sound and title badge.** Off by default. Sound is a small
local asset, not a URL fetch, and is loaded lazily so an unused
preference does not cost bytes on first paint.

**Phase 5 — Host config.** Add `config.notifications` with
`enabled`, `defaultOs`, `defaultSound`, `allowAdminCrossUser`.
Document in `docs/CONFIGURATION.md`.

Each phase is a separate version plan (Nx independent versioning,
`SPEC.md §12`), so a stand can take Phase 1 without Phase 3. Each
user-visible phase also updates
`plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx` in the
same change (AGENTS.md §QA surface release notes).

## 6. Alternatives considered

### 6.1 Keep `dsh-notification` and filter downstream

Filter in a wrapper that hides notifications for chats I don't own.
Rejected: the payload of a Web Notification is already committed to
the OS by the time a wrapper would suppress it, and on mobile the OS
history is user-visible. Filtering after the fact does not fix the
leak. Also blocks us from per-account preferences, since the source
plugin has no account model.

### 6.2 New host push channel (SSE / WebSocket) targeted by user

The plugin owns an HTTP surface
(`src/host-route.ts:31-63`, `@yadsh/dsh-host-webserver`). A per-user
`/qa/notifications/stream` (or reuse of the connection generation)
would let the host emit `turn-complete` to only the owning account's
browsers, so a leak cannot be introduced by a bad client filter.

Rejected for the first pass:

- The plugin has no authenticated HTTP route to attach to today —
  the QA account token is a bearer string in `localStorage`, not a
  cookie, and event-stream auth over `fetch` would need a token
  handshake.
- The browser-side filter in §3.2 is a strict subset of what the
  server would do, so the same user-visible correctness holds;
  the marginal gain is defence-in-depth against a compromised
  client, which is not the threat this card is about.
- The existing sidebar already renders `running` per chat from the
  host's global list; the "the browser received more data than it
  shows" property is not new. Adding a channel that fixes only
  notifications does not change the underlying exposure.

Revisit after Phase 3 if the QA surface grows more host→client
signals (approvals, questions, subagent lifecycle) — at that point
one channel pays for itself.

### 6.3 Broadcast a filtered event over the existing typert

Add a typert `@Remote` returning only for the owner. Rejected:
typert is request/response, not server-push
(`docs/specs/accounts.md §Wire design`); this would be a polling
channel and worse than the client-side observation we already have.

### 6.4 Emit a cordis `qa-surface/turn-completed` event on the host bus

`src/provenance/host-store.ts:40-45` shows the extension pattern
(`subagent/start`, `subagent/end`). We could add a plugin event
carrying `{ sessionId, ownerId, phase }`.

Rejected: bus events are process-global
(`docs/specs/storage-retention.md` documents the whole-file rewrite
that a global `agent/turn-stopping` listener already causes); a new
global event on the same path would broadcast to every browser that
observes it, which is exactly the failure mode this card exists to
remove. Filter would be client-side anyway; simpler to keep the
derivation local.

## 7. Security and privacy analysis

- **Cross-account visibility.** Closed by §3.2: the client filters to
  `visibleChatIds()`; the server side already refuses foreign
  sessions.
- **Content leakage.** §3.4 restricts the payload to information the
  owner already sees in the sidebar. Body must never contain message
  text or file paths.
- **Permission prompts.** Requested once, only from an explicit user
  action in the settings page. Never on load, never per turn.
  Denied-forever is a valid state and the toast remains.
- **Multi-tab.** Two tabs of the same account on the same chat should
  not double-notify. `BroadcastChannel("dsh-qa-notify:v1")` (a small
  local election: the first tab to claim the chat for a given turn id
  fires, others suppress) is the cheap answer. Fallback when
  `BroadcastChannel` is unavailable: deduplicate by
  `sessionId + revision` via `localStorage`. This is scoped inside the
  same origin, same account, and adds no new exposure.
- **Anonymous deployment** (accounts off). The rule remains "notify
  for a chat this browser would render". Without accounts the browser
  index *is* the visible set, so the rule reduces to "notify for my
  browser's chats" and the leak class does not exist here.
- **Admin cross-user.** Off by default. When on, the payload still
  names the *owner*, not the content — so the same body rules apply
  and the sidebar's `ownerNames()`
  (`QaAccountsController.ts:644-659`) supplies the label.
- **Audit.** No new audit surface is required: this event is derived
  client-side from state the browser already has, and OS
  notifications are not persisted. If Phase 6 adds a host channel,
  audit that channel then.

## 8. Test plan

Existing precedent: `tests/session-chat-ownership.test.ts` (owner
filtering) and `tests/session-stream.test.ts` /
`tests/session-controller-*.test.ts` (session lifecycle). New files
under `plugins/dsh-qa-surface/tests/`:

- `turn-completion-source.test.ts` — edge fires on
  `running: true → false` for the bound chat; does not fire on
  reconnect, error, unmount, cold-start projection of an already
  running chat, or on the *first* frame of a session that started
  before the tab opened (mirrors `sawRunning` in
  `QaSessionController.ts:1440-1457`).
- `background-completion-source.test.ts` — non-bound owned chat
  running→idle fires once; non-owned chat running→idle does not fire;
  admin-visible foreign chat does not fire when
  `allowAdminCrossUser` is off; does not fire during a reconnect
  batch where several chats flip in one revision.
- `notification-dispatcher.test.ts` — preference matrix (each of the
  five booleans in §3.5) suppresses its channel; no permission →
  toast-only; hidden → OS channel; visible → toast only.
- `notification-preferences.test.ts` — server-side store round-trip
  through `accountsUpdateNotifications`, migration from an existing
  accounts file with no `notifications` field, per-user isolation
  (user A's change does not affect user B).
- `qa-notifications-owner-scope.test.tsx` — end-to-end: two
  bound-account scenarios in one browser, verify A's toast never
  fires on B's completion.
- Package-verification addition in `scripts/verify-package.mjs` —
  reject hard-coded colours in the new components per AGENTS.md; no
  external fonts, no non-`--dsw-alias-*` tokens on the toast shell.

Release-plan and QaChangelog coverage: every user-visible phase in §5
ships with an Nx version plan and a matching entry in
`plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx`, per
AGENTS.md §QA surface release notes.

## 9. Open questions

1. **Should the notification name the chat when the OS body is
   visible to shoulder-surfers on a shared laptop?** Option A: use a
   user-set alias per chat (a second field on the account). Option B:
   offer a "hide chat title" preference and fall back to "Готово".
   Current draft is B; A is more work.
2. **What counts as a completion when the agent parks a question for
   the user?** `agent/status = "idle"` while
   `interactions.pending` is nonempty
   (`src/client/questions.ts:143-148` shows the shape) is a
   "waiting for you" event and is arguably more useful than
   "finished". Should that be a separate channel and a separate
   preference? Current draft: yes, but deferred to a follow-up.
3. **Do subagent completions surface through the same event?** Today
   `settlement.ts:3-12` renders them inline in the transcript; a
   subagent finishing while the user is away may want its own toast.
   Deferred — likely needs the same source, different filter.
4. **What is the correct cold-start behaviour for the background
   source when several owned chats are already running when the page
   loads?** The initial projection must set the "was running" baseline
   without emitting completions. Call out in implementation.
5. **Should the sidebar `running` dot gain a "was completed since you
   last looked" dot with a click-to-clear?** UI only, no new
   plumbing; likely worth pairing with Phase 2.

## 10. Files this plan will touch when implemented

For scoping (not for this change):

- New: `src/client/notifications/{turn-completion-source,background-
  completion-source,notification-dispatcher,preferences}.ts`,
  `src/client/components/QaTurnNotice.tsx`,
  `src/client/user-settings/NotificationSettingsPage.tsx`.
- Edited: `src/client/user-settings/UserSettingsDialog.tsx` (mount
  the new page),
  `src/client/user-settings/GeneralSettingsPage.tsx:41-46` (promote
  the placeholder),
  `src/client/QaSessionController.ts` (subscribe the new source;
  retire the placeholder in §2.1 only if it becomes redundant),
  `src/client/index.tsx` (provide the new client service; register
  the settings page in the same slot as the profile page),
  `src/accounts/store.ts`, `src/accounts/file.ts` (persist
  `notifications` per user),
  `src/index.ts` (new `@Remote accountsUpdateNotifications`;
  whoami/login/register return carries it),
  `src/config.ts`, `src/types.ts` (deployment
  `config.notifications` block and the `QaAccountNotifications`
  type),
  `src/client/styles.ts` (tokens for the toast),
  `docs/CONFIGURATION.md` (deployment config),
  `README.md` and `CHANGELOG.md` per phase, and
  `src/client/components/QaChangelog.tsx` per AGENTS.md.
- Tests as in §8.

## 11. Summary

Everything needed to fix the broadcast is already inside the QA
surface: an owner-scoped chat list, a per-account identity, a
running→ready edge that only fires for chats this browser can render,
and a settings surface for user preferences. The design takes that
primitive, wraps it in one small dispatcher with five preferences and
three channels, and rolls out in five phases behind a host kill
switch. The external `dsh-notification` plugin becomes unnecessary
once Phase 3 ships; this repository never depends on it, so its
removal is a deployment action, not a code change.
