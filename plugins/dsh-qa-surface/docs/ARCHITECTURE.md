# Architecture

## QA panel extension boundary

The `/qa` overlay declares one root-scoped keyed child slot,
`qa.surface.panel`. Optional client plugins register static metadata through
the `qaSurfacePanels` Cordis service and register their React body in that slot
under the same implementation id. This keeps metadata serializable and keeps
React implementations on the UI composition path.

`dsh-qa-surface` owns only presentation: one active panel, launcher ordering,
side-width reservation and resizing, narrow-screen fullscreen behavior,
generic header/close actions, focus restoration, retained hidden-body
inertness, and an extension error boundary. Extensions own feature state,
controls, persistence and Host capabilities. Panel presentation is client
state and never writes Session events.

Registration lifetime is deterministic. Removing metadata closes an active
panel and aborts its owner signal; removing the keyed body makes the shell show
a controlled unavailable state. Neither path recreates or mutates the active
DSH Session.

The Host half validates the Loader configuration, registers the `qa-surface`
settings namespace and owns one narrow GET/HEAD route for the configured QA
path. Published DSH releases return 404 for unknown frontend paths, so the
route redirects navigation through the canonical `/` index with an encoded
same-origin path marker. It also exposes one typed
`secureSession(sessionId)` operation whose policy is read only from Host
settings. The entry delegates that operation to `QaPolicyAdmission`
(`secure-session.ts`), the Host-side admission boundary. It does not serve
HTML, create another server, replace the frontend fallback, or touch
API/plugin routes. The browser removes the
marker and restores the requested path with `history.replaceState` before
route matching. The Host creates no sessions itself.

The browser half registers `QaSurface` in the root-scoped `shell.overlay` list.
`QaRouteController` keeps that entry dormant outside the configured path and
reversibly observes `pushState`, `replaceState` and `popstate`.

`QaSessionController` is the only browser-side DSH session-coupled module. It uses
`connection.api.sessions.create/selectModel` for creation policy and the public
`SessionFace` for prompt, cancel and snapshots; the shared client contracts and
the idle state live in `client/types.ts`. Its supporting modules are pure
helpers: `client/wait-for.ts` waits on observable stores, `client/chat-index.ts`
(`QaChatIndex`) keeps the browser-local chat index and persisted active
session in storage, and `client/attestation.ts` parses Host reason markers and
validates proofs against the deployed lockdown config. `QaTranscriptAdapter`
projects session snapshots to plugin-local messages. "New chat" enters a
draft that materializes an attested session only when the first prompt is
sent, and the chat list orders by the host's `updatedAt`. The log is
append-only and there is no truncation seam, so regeneration prompts a
hidden instruction and projects the follow-up turns as variants of one
question; the same projection flattens tool activity into the sources
drawer (web targets, searches, files read). Subagent delegation, when the
deployment opts it in, renders launches and settlement notices inline, and
the agents drawer opens a child session as a read-only live transcript: the
binding skips attestation and every send path stays closed. By default it excludes
reasoning, tool arguments and tool results. When explicitly enabled, it
correlates assistant blocks, paired tool results, running calls and turn
timings into one plugin-local work group per turn; `QaWorkGroup` owns
disclosure state and collapses the group when the turn completes. System
context and raw failures remain excluded.

In locked mode the Host operation verifies immutable session composition,
refuses to adopt a non-QA session with user history, validates the named
permission preset, installs `ToolRestriction.allow`, installs an agent-scoped
monotonic execution guard, selects the permission preset, and returns only a
sanitized proof. The controller remains non-writable until every proof field
matches its Host-delivered config and repeats the check before prompt
admission. No private RPC handler, slash command, direct provider API, or DSH
core patch is used.

With accounts enabled, `QaAccessService` keeps authorization and agent
capabilities separate. `QaRoleRepository` atomically owns role definitions and
audit records, `QaCapabilityCatalog` adapts the live DSH tool/skill registries,
and the resolver computes `system + Common + one active subrole`. The selected
role and immutable effective policy are pinned to the account-owned session;
the browser cannot request an unassigned role. An administrator's management
role does not enter this calculation, except for an explicit, visibly marked
preview session.

Tool enforcement reuses the locked agent's scoped registry restriction and
pre-execution guard. Principal-bound integration tools must also occur in the
resolved role policy; their per-user principal checks remain an independent
boundary. Skill enforcement registers an agent-local `skill` consumer that
shadows the standard consumer, contributes a filtered `available_skills`
prompt section, and applies the same allow-list when content is loaded. Policy
IDs for temporarily absent plugins are preserved, but only capabilities found
in the live scoped registries enter an effective policy.

Skill routing adds one indirection on top of that allow-list. A role's tools
are split into `always` and `skillGrantable`; the second class is a ceiling,
and `QaAgentToolGrants` owns the agent's scoped restriction so that activating
a skill can widen it. The same object answers the admission guard, which is why
model visibility and execution authorization cannot drift apart. A grant is
applied by attempting the restriction swap: a tool the registry refuses is
dropped from the grant and reported, instead of breaking the session.

Skill metadata is read from `metadata['qa-surface']` through `ctx.skills.get()`
— the summaries in a catalog snapshot do not carry it — and normalized into a
fail-closed descriptor whose complaints (`unknown subrole`, unsupported
version) travel to the administration surface. Audience resolution unions
declared and administrator-managed assignments, then subtracts explicit
withdrawals, so a contradictory pair of edits can only narrow access. The
`available_skills` section lists the resolved model-facing set.

Activation happens on both entry points: the shadow `skill` tool activates
before it returns instructions, and a prepended agent-scoped `agent/pre-step`
listener activates for a typed `/name` after the standard consumer appended its
injection — and can still withdraw it. Loading instructions and granting tools
is one operation, so a skill is never handed instructions it has no tools to
follow. Attempts are recorded on the session ownership record for review; no
custom session event is emitted, because an unknown event type would make the
whole session log unreadable.

An indexed historical chat whose immutable preset, workspace or model no
longer matches may keep its already-open transcript binding in compatibility
read-only mode. It never receives a successful proof, and the projection and
controller both suppress prompts, cancellation, approvals and questions. New
chats are always created and preflighted against the current deployment pins.

This narrows a QA agent's effective session/tool policy, but a route overlay on
a shared privileged Host is not an authorization boundary for other DSH
clients. Strong isolation requires a dedicated process/profile, restricted
identity and network boundary.

All interaction colors come from the company interaction palette
("Цвета взаимодействия"), defined once as the `QA_BRAND_PALETTE` object at the
top of `styles.ts` and emitted as `--dsh-qa-*` custom properties on the
overlay root; surfaces and typography keep using the themed `--dsw-alias-*`
tokens so light and dark hosts stay coherent.

The overlay locks document scrolling and contains keyboard focus while active.
It does not locate AppFrame through generated CSS classes and does not dispose
global DSH runtime services when the route changes.
