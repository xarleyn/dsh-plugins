# SPEC — Integration API (HTTP)

**Status:** implemented (first delivery)
**Date:** 2026-09-21
**Target:** `@yadsh/dsh-qa-surface`
**Input:** the endpoint specification of a service-desk bridge kept in another
repository, accepted as the contract to satisfy — this document records what was
implemented, which parts of it were reused as-is, and what was left out on
purpose.

---

## 1. The problem

The QA surface could only be driven by a person: the account credential is an
HMAC token minted in `login`/`register`, every action is a DSH Remote call from
the client bundle, and the surface itself is a browser overlay. Nothing about
that is reachable from another application — no long-lived credential, no HTTP
endpoint, no way to continue a conversation without a browser tab.

What the integration needs is small and specific: send a question, get a
Markdown answer and its sources back, continue the same conversation with the
next question, with its own account and its own credential.

## 2. Decisions

### 2.1 Both halves are served by this plugin, as an HTTP API

Two options were on the table: require the external application to speak the
DSH Remote transport, or serve HTTP ourselves. The bridge's own contract is
HTTP with a bearer token, and its fallback paths (`415`, retry on `5xx`) are
HTTP semantics; making it speak a DSH-specific transport would have moved the
whole integration cost onto the other team. The Host web server already exists
(`@deepseek-ai/dsh-host-webserver`), so the routes are three `register` calls
under one base path, each an exact match.

`basePath` defaults to `/qa/api`. The exact path is matched before the QA
navigation route's prefix (`/qa`), so the endpoints never fall into the page
route.

### 2.2 A second credential, not a longer-lived browser one

Integration tokens are a separate credential from the browser token
(`accounts/token.ts`):

| | browser token | integration token |
| --- | --- | --- |
| shape | `v1.<payload>.<hmac>` | `qsat.<uuid>.<secret>` |
| lifetime | `accounts.sessionTtlDays` | its own `expiresAt` |
| revoked by | `tokenVersion` bump (password change, `revoke`) | its own `revokedAt`, `revoke`, account disable |
| stored as | nothing (self-describing) | SHA-256 digest of the secret only |
| scopes | none (the whole account) | `ask`, `sessions:read` |

The separation is the point. A password change must not log out a running
integration; a leaked integration credential must not become a browser
session; and `qa-accounts revoke` must still stop both. The token carries no
`tokenVersion`, so browser-side invalidation does not reach it — which is why
`revokeTokens` and account disabling were extended to cover it explicitly.

### 2.3 The turn is the harness's own turn

`ask` does not talk to a model. It opens (or resumes) a DSH Session and sends
one prompt through `sessionController.prompt`, then waits for
`agent.whenIdle()` and reads the answer out of the durable session log
(`answerAfter`, exported from the review projection's flattening rule). The
consequences are the ones the package already promises for the browser path:
the deployment's preset, workspace, model, tool policy, skills, MCP, subagents
and provenance all apply, because it is the same session machinery.

Admission is the same call too (`QaPolicyAdmission.secureSessionForUser`), which
is a thin owner-resolving wrapper over `secureSession`: deployment pins, the
tool allow-list, the QA tool attachment and the attestation record are one code
path, not two. The only thing the integration path does differently is how the
caller's identity is established — ownership record instead of browser token.

### 2.4 The chat belongs to the account, and only to it

A conversation opened over the API is owned by the account its token belongs
to, recorded exactly like a browser chat (`reserveSessionForUser`). Continuing
requires the same account: `ownerIdOf(sessionId)` is the authority, and a
foreign chat is refused with the same status as a foreign token. A token can
therefore never reach a chat it did not create or that its account does not own
— including chats created in that account's browser, which is deliberate: the
answer to "why can this service see my chat" is "it is your account's token".

### 2.5 A timeout is an answer, not an error

The bridge's contract is a 90-second answer. When the turn is still running at
`requestTimeoutMs`, the endpoint answers `200` with `escalate: true`, an empty
`answer` and the `chat_id`, instead of a `504`: the bridge escalates the ticket
to a specialist, and a later retry continues the same chat. A `5xx` there would
send the bridge into retries against a turn that is still going to finish, and
each retry would return the same nothing.

A hard failure (the Host could not open a chat, the provider refused) is still
`503`, because that is a transient condition a retry can fix.

### 2.6 Unattended failure is escalated, never guessed

`escalate: true` covers three cases with the same meaning — "do not publish
this": an interrupted turn (a partially committed answer), an empty answer,
and the timeout above. `confidence` is `medium` for a published answer and
`low` for an escalated one; `high` is never produced, because nothing in the
deployment judges an answer and a field that always said `high` would be worse
than no field at all.

### 2.7 The account issues its own credential, from the profile page

A token is minted, read once and revoked in the `Настройки` dialog, next to the
profile and the starter buttons — the same self-service shape as everything else
that belongs to an account. Two details carry the weight:

- **The owner is never on the wire.** The remote takes a label, scopes and a
  lifetime; the account is the one that authenticated. The administrative path
  that mints for somebody else (`mintServiceToken` with a `userId`) already
existed for the CLI and stays there, so a page can never name another account.
- **Minting requires something to mint for.** With `integration.enabled` false
the section explains the off state instead of offering a button that only ever
refuses, while listing and revoking keep working: an endpoint that is switched
off must not make an existing credential irrevocable. The refusal is enforced
in the Host (`integration-disabled`), not only by hiding the form.

The secret is shown once, in the answer that minted it, and the list that
follows carries no token field in any state — a list that could repeat a
credential would be a list that leaks it. Revocation asks twice, because it is
not undoable and a live integration may be depending on the token.

### 2.8 An attachment is read on the Host, and nothing is stored

The ticket's attachments are the part of the request that cannot simply be
forwarded. Images ride the prompt inline, because that is what the harness
carries; a file does not — `PromptContentPart` names one by an opaque receipt
minted by the harness's own upload service, and that service is what stores the
copy the model later reads through its file tools. An external caller has no
browser session, so it cannot mint one.

So the plugin reads the attachment itself and sends text:

| What arrived | What the prompt gets |
| --- | --- |
| `image/png`, `image/jpeg`, `image/webp`, `image/gif` | the image, inline, unchanged |
| `text/plain`, `text/csv`, `text/markdown` | the decoded content under a heading naming the file |
| `application/pdf` and the OOXML family | the deployment's document pipeline extracts Markdown (`DocumentsFace.toMarkdown`), and that text is inlined |
| anything else | `415`, which is the caller's own fallback: it repeats the question without attachments |

Three consequences are deliberate. **Nothing is written into a path the
deployment shares:** the pipeline takes a path, so the bytes go to a temporary
directory created for that one extraction, which is also the workspace root the
conversion is scoped to, and the directory is removed in `finally`, whatever the
outcome. A deployment that configured its own artifact root for the document
pipeline keeps the conversion's artifacts under it, where its existing retention
sweep governs them. **A file that cannot be read refuses the request** with the same
`415` rather than being skipped: publishing an answer to a question whose
material never reached the model is worse than asking again without it, and
that is exactly what the status means in this contract. **The pipeline is the
deployment's own** — the same runtime, providers and limits the `document_*`
tools use, reached through the face the documents plugin publishes — so a
deployment without it answers `415` for PDF and Office rather than growing a
second converter here, and no new dependency appears in this package.

The text is bounded: 60 000 characters per attachment and 120 000 per question,
cut at a line or word boundary and marked when cut. Attachments past the budget
are named in a closing note, so the model knows something was left out instead
of assuming it saw everything.

### 2.9 The answer is cut here, where a cut can be read

The caller publishes the answer into a ticket comment, and the specification
names a size for it. The comment is the one place where an over-long answer
fails silently: the ticket system cuts it, mid-sentence and mid-code-block,
and nobody is told. `maxAnswerCharacters` (4096 by default) therefore bounds
the published answer in the plugin, at the last paragraph break — then the last
line, then the last sentence, then a word — with an ellipsis appended, and a
boundary that would keep less than half the budget is refused so that one early
paragraph break cannot shrink a full answer to a line. The cut is a warning log
with the chat id and the published length, never the text; the response is a
normal answer, not an escalation, because the assistant did answer.

The alternative — publishing the whole answer and letting the caller decide —
was rejected because the caller has no signal to decide with: it receives
Markdown and posts it.

### 2.10 `sessions:read` is a real scope, and reading is not asking

The scope table promised `ask` and `sessions:read` from the first delivery, and
the second had no endpoint behind it: a caller could be granted the right to
read a conversation it had no way to read. `GET {basePath}/session?chat_id=…`
closes that, and the shape of the read is the decision worth recording.

**The alternative was to widen `ask`.** A bridge that escalates a ticket wants
the specialist to see what was already said, and the cheap version of that is to
re-ask the question and take the answer as "history". That is not the same
thing: it spends a model turn to reproduce text that is already stored, it
answers from the current state of the deployment rather than from what was said
at the time, and a conversation with three exchanges costs three turns to read
back. A second scope also lets a deployment hand a reporting integration the
right to read without the right to spend inference, which one scope cannot
express.

**What is published is narrower than the log.** Only `user/message` events the
person actually sent (`source.kind === "user"`) and `assistant/message` events
with prose are returned. Injected context — identity notes, skill payloads, an
expanded slash command — is recorded as a user message and is model input the
caller never wrote; tool calls and results are plumbing whose outcome is already
in the answer; reasoning is not the caller's to read. The text is flattened with
the same rule the answer path uses (`messageContentText`), so one message never
has two versions depending on how it was read.

**The read is cursor-based, not "the transcript".** `after` is the caller's own
position (the `last_seq` of its previous read) and the window is the newest
`limit` messages, with `truncated` reporting that older ones were left below.
The alternative — return the whole log — makes one call cost whatever the
conversation has accumulated, and a caller showing a ticket summary does not
need the first fifty exchanges to render the last two. `last_seq` is the newest
seq in the page rather than the newest in the log, so a truncated page still
moves the caller forward without skipping a message it never saw.

**Ownership is the same rule `ask` applies.** `ownerIdOf(chatId)` must name the
token's account, and an unknown chat and another account's chat are one `404`:
an id alone must not confirm that somebody else's conversation exists. The
refusal vocabulary reuses `unauthorized`/`forbidden`/`not-found`, and a token
without `sessions:read` is refused before the log is opened at all.

**An unreadable log is a failure, not an empty chat.** The one exception is a
`not-found` log for a chat whose ownership record exists: the record is written
before the first message, so a chat that has not been asked anything yet is an
honest empty conversation. Any other read failure is a `503`, because "the log
could not be read" is a transient condition and answering it with `messages: []`
would tell the caller the conversation is empty.

## 3. Contract

See the README's "Integration API (HTTP)" section for the request/response
shapes, the status table and the curl examples — that is the operator-facing
copy, and it is the contract this implementation is tested against.

## 4. Deliberately not in this delivery

- **Async ask.** The specification marks `202` + polling as optional and says
  not to implement it preemptively. The synchronous endpoint with an escalation
  path satisfies the stated budget.
- **Idempotency keys.** Every question opens exactly one turn. A retried
  request after a `503` asks again rather than reconciling with the earlier
  attempt; the contract has no client-side request id to reconcile on.
- **Per-token concurrency.** `maxConcurrent` is deployment-wide and
  `requestsPerMinute` is per token; a fair-share scheduler across tokens is not
  needed while one bridge is the only integration.

## 5. Verification

- `tests/integration-tokens.test.ts` — minting stores only a digest; a forged,
  unknown, revoked or expired credential is one refusal; a disabled account and
  `revokeTokens` stop it; scopes are granted as requested and no more; one
  account's tokens are unreachable from another's; TTL and label are bounded.
- `tests/integration-token-remotes.test.ts` — the browser seam: minting is
  refused with `integration-disabled` while the API is off (while the read path
  keeps answering), a list never carries the secret, an account can only revoke
  its own token, and an absent session is refused as one reason.
- `tests/qa-integration-tokens.test.tsx` — the page: the secret is shown once
  and dropped when acknowledged, copied on request, a revoke asks twice and
  leaves a record, an expired token offers no revoke, and the off state explains
  itself instead of offering a form.
- `tests/accounts-controller-actions.test.ts` — the controller binds the account
  token to the three calls and turns each refusal into the copy a person reads.
- `tests/integration-http.test.ts` — the JSON and multipart encodings (text
  fields, the JSON-string `context`, an inline image), the refusals (`400`,
  `413`, `415`), the body ceiling, `405` with `Allow`, the health payload's
  field names, the read route's query handling (an escaped chat id, the default
  and clamped page size, a refused cursor that never reaches the service), its
  wire shape and the `404` a foreign chat becomes, and disposal of every route.
- `tests/integration-runner.test.ts` — the Host seam behind the read: the page
  projected from the durable log, the caller's cursor and window honoured, a
  chat that has written nothing yet read as empty (and its cursor left where
  the caller had it), a log that cannot be read refused instead of answered
  empty, and the model catalog flattened to its routable ids.
- `tests/integration-transcript.test.ts` — the projection a caller reads: order,
  the log's timestamps as ISO instants (and none invented when the log had
  none), injected context, tool traffic and reasoning left out, the same
  flattening the answer uses, `after` as an exclusive cursor, the newest page
  with `truncated` for what it left below, a cursor preserved when nothing new
  was written, events returned out of order, and the empty chat's shape.
- `tests/integration-service.test.ts` — credential and scope refusals, the
  disabled/deployment-off states, the answer shape, citation bounding, the
  publication budget cutting an over-long answer to a readable head, the
  escalation paths (empty, interrupted, timed out — the last one keeping the
  chat), a host failure as `503`, the rate and concurrency budgets, health with
  and without a model catalog, a dropped connection, and the read path: the
  `sessions:read` scope, an unknown and another account's chat refused as one
  `404`, and an unreadable log reported rather than answered empty.
- `tests/integration-attachments.test.ts` — the media-type families the parser
  accepts; a caller's name reduced to a label (traversal, control characters and
  length); a text file decoded; bytes labelled as text refused; a document
  extracted through a fake pipeline that asserts the file exists while it reads
  it; the temporary directory gone after both a success and a failure; a
  missing pipeline and a failing one refused with the reason in the log; and
  every attachment inside the per-file and total text budgets.
- `tests/integration-answer.test.ts` — the answer is the last prose of *this*
  turn: an intermediate tool-only step is skipped, an earlier turn's answer is
  not republished, an injected context message does not become the prompt, and
  malformed events are tolerated. Plus the publication budget: an answer that
  fits is untouched, an over-long one is cut at a paragraph or line boundary
  and marked, a hard cut keeps an unbroken answer inside the budget, and one
  early paragraph break does not shrink a full answer to a line.
- `tests/integration-config.test.ts` — off by default, base path normalization
  and refusals, the accounts cross-check, and every numeric bound.
- `tests/cli.test.ts` — `token create|list|revoke`, the secret printed once, a
  second process verifying the token, and the revocation.
- `tests/accounts-admission.test.ts`, `tests/subagent-ceiling.test.ts`,
  `tests/user-workspace-admission.test.ts` — the admission gate's new
  `ownerIdOf` seam.

Full suite: `pnpm --filter @yadsh/dsh-qa-surface test` (194 files, 1350 tests at
the time of writing — the pre-existing 184 files stay green, which is the
regression signal that matters most for the admission refactor).
