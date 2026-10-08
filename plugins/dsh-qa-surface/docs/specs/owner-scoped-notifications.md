# SPEC / PLAN — Owner-scoped turn-completion notifications

**Status:** partly implemented — Phases 1 to 3 shipped, the rest is
open (§12).
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
  `running === true` **and** the client saw the turn start. The
  controller's `pendingSubmission?.sawRunning` was the precedent for
  that gate; the flag is gone from `QaSessionController` and the
  shipped source keeps its own per-chat reading of it instead (§12).
  A chat that never ran in this browser is not a
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
  before the tab opened (the shipped gate is the per-chat reading in
  `turn-completion-source.ts`; §3.1, §12). The cases drawn across a
  gap enter with the reading the paused frame is asked to re-project
  — a still-running row for the `unwatched` half, a trusted idle for
  the `stale` half — and §12 names, by mutation, what removing either
  half costs.
- `session-controller-reconnecting-frame.test.ts` — the two edges a
  reconnect hands the page are set by hand in both orders (#479):
  the link's return is published on the strength of the link alone,
  while the rows still say what the gap left them saying, and a
  refreshed list that arrives over a down link does not retire the
  frame that names the gap.
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
   loads?** Answered (#483): the initial projection sets a baseline of
   *running, and this page did not see it start* — not plain *running*,
   which the next frame would report as a finished turn. §3.1 asks for
   the start to be watched and `docs/CONFIGURATION.md` promises that a
   chat already running when the page opened is not attributed to the
   reader, so the run a page merely found under way ends in silence,
   and the first turn this page watches begin is reported once. What
   the same rule does to the frames around a reconnect is §12.
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

## 12. Implementation status

**Shipped (0.14.0): Phases 1, 2 and 3, plus the desktop channel.** One
differ over the sidebar's own rows
(`src/client/notifications/turn-completion-source.ts`) covers both
scopes §3.1 separated, because `buildChatRows` is already the
projection §3.2 asks for — `chatIds()` (the account's owned list with
accounts on, this browser's own index without them) intersected with
the host list. The bound chat is in it. `notification-dispatcher.ts`
applies §3.1's channel rules (nothing for the chat on screen while the
window is active; the desktop only for a page that is hidden or behind
another window); `QaTurnNotice.tsx` is the in-app line, `use-turn-
notifications.ts` the wiring. `config.notifications`
(`enabled`, `allowOs`) is §3.5's host block.

**§3.2, as the admin case was wrong until #477.** The claim above that the
admin's read never widens the rows it was based on is false: `chatIds()` answers
the account's `ownedIds`, and that list is the union of the account's own chats
and the whole ownership map as soon as `showOtherUsersChats` is on — so one
operator switch decided both what an admin may read and whose activity this
browser announces, and the desktop channel carried a foreign chat's title into
the operating system's own log. §3.2 asks for a *read* permission and no more,
and that is what the code now does: the account keeps `ownIds` (its own chats
alone, claim included) beside `ownedIds` (the sidebar's list, unmoved), and the
notifier is bounded by `ownIds` — `scopeNoticesToOwnChats` in
`turn-completion-source.ts`, fed by `use-turn-notifications.ts`. A chat the
reader does not own never reaches the differ, so it is not even in the baseline.
The opt-in §3.5 named `allowAdminCrossUser` is still not implemented, and still
has nothing to consume: with delivery decoupled from the read there is no
cross-user notice to allow, and §4 keeps the requirement for its two sides if
one is ever built.

**Where this departs from the design above.**

- **§3.1's observed start is the gate, and it holds for the whole run
  (#483).** The differ keeps a per-chat reading with four states —
  `idle`, `watched`, `unwatched`, `stale` — and reports a turn only
  where a `watched` run is seen ending in a frame the browser could
  vouch for. Before this, the first frame that found a chat running was
  re-projected in silence and the frame after it reported that run's
  end: the promise of §3.1 and `docs/CONFIGURATION.md` held for one
  frame and was broken by the next, so a turn that began before the tab
  opened was still attributed to the reader who opened it.
  What the link going down does to that evidence is the same rule
  rather than a new one, and it is why the fourth state exists. A frame
  read through a gap vouches for neither fact a reading is made of, but
  which way `running` pointed in it still decides what the page is short
  of: the start of a run it cannot account for (`unwatched`), or an idle
  reading it cannot yet trust (`stale`). These are not the same hole,
  because only one of them closes by itself — the unaccounted run ends,
  its row moves, and the page reads the chat idle over a live link.
  `stale` is the missing half of that evidence named. What the flag covers and
  what the readings carry are deliberately kept apart: `paused` goes back off
  with the connection — `QaSessionController.publish` derives it from the
  connection snapshot and emits it synchronously with the link going down —
  while the rows are the host list store's, which `QaSurface` reads through
  `useSyncExternalStore`. That store's re-pull on a returned link is measured
  below: it is fire-and-forget and its answer lands in a frame of its own, later
  than the edge that cleared the flag, so the frames between the two carry the
  list the drop left. Reading one of those as a live idle armed the baseline
  and credited the run after it: measured on the built differ, `idle` →
  `paused+idle` → `live+idle` → `live+running` → `idle` raised a notice
  for a turn that might have begun anywhere inside the gap, against the
  promise `docs/CONFIGURATION.md` makes. A row that has not moved since the gap
  is the reading the gap left behind, so it now arms nothing — and the move that
  arms it back is a run of that chat ending, which therefore passes silently even
  where this page watched that run begin over the recovered link. So the silence
  is bounded by the gap rather than by the turns it falls inside, and what a gap
  the page was shown costs a chat is one turn, or two where a turn finished inside
  the gap: the sequence above raises nothing while the full live turn after it
  raises one
  notice (`does not arm a baseline from an idle the gap left behind`), and
  `idle` → `running` → `paused+running` → `paused+idle` → `live+idle` → a full
  live turn leaves two turns silent before the notices come back
  (`spends the turn that rebuilds the baseline after a gap on that gap`). One
  untrusted frame is enough to drop a `watched` run to `unwatched` — `idle` →
  `running` → `paused+running` → `live+running` → `live+idle` raises nothing on
  the built differ — which is what
  `stays silent on a stand whose link drops inside every turn` measures: three
  turns begun on the live link and interrupted each by their own gap raise
  nothing between them. So `docs/CONFIGURATION.md`, the version plan and the
  0.14.0 changelog entry say so, of the gaps the screen reflected: a stand whose
  link drops inside long turns pays for every one of those drops and gets no
  notice there at all. That every gap reaches the screen is no proof, though:
  `paused` arrives at the differ as the page's committed
  `state.phase === "reconnecting"`, and the effect that raises notices lists it
  in its dependencies (`src/client/notifications/use-turn-notifications.ts:145`)
  — and an effect runs on committed values only, so a link that went and came
  back inside one batch hands it no frame with the flag set at all. The next
  bullet
  names that case as the boundary of the rule rather than letting the absolute
  swallow it.
  Whether the host list lets a browser vouch for anything across a gap at
  all is measured below, and the answer is that it does not; the silence is
  written into `docs/CONFIGURATION.md` as the shipped promise, so a stand that
  needs the notice through a gap is a change of the rule rather than an
  undocumented difference from the docs. The same
  reading also covers a chat whose row leaves the sidebar and comes back:
  while the row is away the differ holds no reading for that chat at all,
  so its run is found rather than watched, and it ends silently too —
  which is written into `docs/CONFIGURATION.md` beside the link case. One
  corner of that case belongs to this page rather than to #479: a row that
  leaves the list for a local reason (this browser's own index, not the host)
  and returns idle inside an unvouched window arms its baseline the way a cold
  start does, because the differ drops the reading as soon as the row is gone
  (`src/client/notifications/turn-completion-source.ts:111-114`) and so has
  nothing left to compare that idle against — and the run that follows is then
  reported although it may have begun back inside the gap.
  No host signal closes it: holding the reading across the absence, as `stale`,
  is a decision inside this page, and #479 measured the host side only. The
  decision is left unmade on purpose — dropping is the rule the differ was built
  on, it bounds the map to the rows on screen, and it is what makes a chat that
  comes back running a run found rather than watched — while keeping the reading
  would cost that chat a silent turn on every return.
  That leak is pinned as measured, not as intended, by
  `tests/client/notifications/turn-completion-source.test.ts`
  (“arms a row that comes back idle inside an unvouched window, and pays for
  it”), which asserts the notice it raises so the rule above is not mistaken
  for a closed one.
  What #479 does not need to build again: the invalidation itself —
  `readSighting` leaving a paused frame `unwatched` or `stale` according
  to what it read, the refusal to arm a baseline on a row that has not
  moved since, and the dropping of a reading whose chat left the list.
  All three are covered by the cold-start and reconnect cases under
  `tests/client/notifications/`, and measured rather than asserted. Their price
  was read off a full-suite run of the tree this ships on — 249 files,
  1907 tests green — with each half of the `stale` transition taken
  out in turn, and the two halves cost the same: taking out the paused idle that
  leaves it, and taking out the live frame whose row has not moved keeping it,
  each fail the same nine cases — five in the differ, four at page level — and
  nothing else in the suite. That is not a coincidence of the tests but of the
  guarantee, which holds only where both halves hold: with either half gone the
  idle row the gap left behind arms the baseline, and the nine are the cases that
  read that arming. Two of the differ cases and three of the page cases in each
  set are #479's ordering scenarios, the rest are #483's, and
  `spends the turn that rebuilds the baseline after a gap on that gap` fails
  under both, which is the case that pays for the gap. The ordering half is
  settled by hand rather than assumed: `tests/session/session-controller-reconnecting-frame.test.ts`
  draws both orders at the seam where the page picks the two edges up — the
  link's return published on the strength of the link alone, with the rows
  still the ones the gap left, and the refreshed list arriving while the page
  still reports itself reconnecting without retiring that frame. What the stand
  still owes is narrower than the ordering: whether a live Host can fit a drop
  and its return into the space between two renders, which is the next bullet.
- **The silence covers a gap the page was shown (#479).** Every sentence above
  is about frames the differ was handed, and one frame carries the whole gap:
  the differ's `paused` input is the page's own
  `state.phase === "reconnecting"` (`QaSurface`, where it builds
  `useQaTurnNotifications`), and the controller reaches that phase only where a
  connection was once established and then went (`connectedOnce`, read in
  `QaSessionController.publish`). So the rule as shipped reads: every frame
  taken while the page reports itself reconnecting is worth nothing, and what
  the restored link delivers is adopted only as its rows move. Turn that round
  and it is the boundary: a gap that produced no such frame produces no silence
  either. If a drop and its return fit between two renders, the reading the page
  held before the gap crosses it untouched, and each reading fares differently:
  a chat that was `idle` is credited with a start it never saw, so a turn that
  began inside the blink is reported as one the reader had been waiting for,
  while a chat that was `watched` keeps the evidence it had and is reported late
  rather than never. No case in this package can rule that out, because the differ
  only ever receives what the page rendered, and the seam cases above draw two
  publishes, not one merged render. The primitive that would close the boundary
  without measuring is already in the component: `QaSurface` holds
  `props.connection`, a `ConnectionGenerationState` whose `getSnapshot()` names
  the active generation and reads `undefined` before readiness and while
  reconnecting, and that generation moves at connect — independently of React's
  batching and of the identity of a foreign store. Two consecutive frames whose
  generations differ are then known to straddle a gap the page never displayed,
  which is what no rendered `reconnecting` frame can tell the differ. Re-aiming
  the rule from the rendered phase onto that counter would cost more than it
  buys: a generation can be replaced while the screen keeps showing the same
  rows, so every run that began just before one would go uncredited even where
  the page did see it start. It is named here, and the live pass decides whether
  the merged render it protects against is a thing the stand produces.
- **What a browser may vouch for across a gap is measured, not assumed (#479).**
  The option this section left open — clearing `stale` on the fact that the list
  was re-read rather than on a row moving — has no signal to stand on. The
  installed host client publishes the list as
  `{ ids, byId, phase, projectionsBySession }`
  (`@deepseek-ai/dsh-api-session-controller`, the dependency
  `docs/COMPATIBILITY.md` names): `phase` is `pending | ready` and monotone, so
  a re-pull after a reconnect does not take it back to `pending`; the client's
  own in-flight flag is dropped by the projection that builds the store the page
  subscribes to; and `ids`/`byId` are rebuilt as fresh objects on every publish,
  including the one that happens before the answer arrives, so a changed
  reference says only that something was published, not that the Host answered.
  A reconnect's re-pull is fire-and-forget, unawaited, which is what makes the
  live-then-stale-rows window normal rather than exceptional. So arming a
  baseline on the chat's own row moving is not a stand-in for a better signal
  this page has not been given yet: on this contract the row is the signal, and
  the one-turn silence it costs is the price of the promise §3.1 makes.
  The same reading narrows the boundary above without a stand: the rows the
  re-pull brings back reach the page only when the Remote call resolves, which is
  a frame of its own, later than the connection edge that cleared `paused` — and
  the publish the client makes in that same turn still carries the rows the gap
  left. So a render cannot merge the link's return with an answer that has not
  arrived; what it can merge is the pair of *connection* notifications, a link
  that went and came back before the page was drawn once. That, and only that, is
  the case the boundary names, and it is the one number the live pass still has
  to produce.
- §3.5's five booleans are two: `inApp` and `desktop`. A preference is only
  worth storing if a channel exists to honor it, and the shipped dispatcher has
  two — the line in the page and the notice the page hands to the operating
  system. `boundChat`/`backgroundChats` collapsed into one when the sidebar's
  own rows became the single source (§3.1 asked for two), and `sound` and
  `titleBadge` stay unshipped, so §3.5's `QaAccountNotifications` carries what
  the code can act on rather than what the draft imagined.
- §3.5's `defaultOs`/`defaultSound`/`allowAdminCrossUser` are not in
  `config.notifications`. Nothing consumes them yet: no channel falls back to a
  deployment default for a reader who never answered, and cross-user notices (§4)
  were never in scope.
- The desktop answer also stays in `localStorage`, as the choice of a stand
  without accounts — no account to write to there — and as the record of whether
  this browser has been asked at all. The second is deliberately browser-local: a
  permission prompt belongs to the browser that shows it, so an account signing in
  on a fresh browser is asked once again rather than silently denied the channel
  it already wants.
- The permission prompt is raised from a button on the notice itself and from the
  settings page, both on a click — the "explicit user action" §3.3 asks for, and
  never on load or once per turn.
- §3.4's reason is always "готово": the host list carries no outcome
  classification, and inventing "остановлено"/"ошибка" from a phase the
  browser cannot read would be a guess.
- No sound, no title badge (Phase 4), no cross-tab election (R9): two
  tabs of one account can both report the same settled chat.
- R2 stays unmeasured. The background source reads the same
  `summary.running` the sidebar's spinner already reads, so it cannot
  see less than the page shows; whether the host bumps the list in the
  moment a *non-bound* chat settles is still a live-stand question.

**Left.** Phase 4 (sound, title badge), the cross-tab election, the operator
toggle for `config.notifications`, the "the agent is waiting for your answer"
signal (§9.2), subagent settlement notices (§9.3), and Phase 6 —
taking `dsh-notification` off the stand, which is a deployment action
and not a change in this repository.
